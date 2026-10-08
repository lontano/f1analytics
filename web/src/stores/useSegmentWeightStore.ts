import { create } from "zustand";

import type { TimingData } from "@/types/state.type";
import { parseTimeMs } from "@/lib/lapModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Normalised per-mini-sector weights for one sector.
 * Each entry is a fraction in (0, 1); all entries sum to 1.
 * Multiply by the estimated sector total (ms) to get each mini-sector's ms.
 */
export type SectorWeights = number[];

/**
 * Calibrated mini-sector weights for all three sectors of one driver.
 * null = not yet calibrated (fall back to uniform distribution).
 */
export type DriverSectorWeights = [SectorWeights | null, SectorWeights | null, SectorWeights | null];

type DriverState = {
	/** Flat list of the last-seen Status value for each global mini-sector index. */
	prevStatuses: number[];
	/** Wall-clock ms (Date.now()) recorded when each mini-sector first became active. */
	crossingWallMs: Record<number, number>;
	/** Smoothed normalised weights per sector (EWMA over laps). */
	sectorWeights: DriverSectorWeights;
	/** Last ingested sector.Value strings for change-detection. */
	prevSectorValues: [string | null, string | null, string | null];
};

type SegmentWeightStore = {
	drivers: Record<string, DriverState>;
	/**
	 * Feed a TimingData snapshot into the store.
	 * nowMs defaults to Date.now() and is exposed only for testing.
	 */
	ingest: (timingData: TimingData, nowMs?: number) => void;
};

function currentActiveIndex(statuses: number[]): number {
	for (let i = statuses.length - 1; i >= 0; i--) {
		if ((statuses[i] ?? 0) !== 0) return i;
	}
	return 0;
}

// ---------------------------------------------------------------------------
// Weight calibration helpers
// ---------------------------------------------------------------------------

const WEIGHT_ALPHA = 0.35; // EWMA smoothing on the fraction weights
const MIN_SEG_MS = 80; // floor for any single mini-sector duration (ms)

/**
 * Given wall-clock crossing times for mini-sectors [rangeStart .. rangeStart+rangeLen)
 * and the official sector total time, produce normalised weight fractions.
 *
 * Relative latency cancels because we only use *differences* between crossing times.
 * The last mini-sector's share = sectorMs − sum(all others), which is accurate because
 * sectorMs is the official F1 timing value for the sector.
 */
function calibrateWeights(
	crossings: Record<number, number>,
	rangeStart: number,
	rangeLen: number,
	sectorMs: number,
): SectorWeights | null {
	if (rangeLen <= 0 || sectorMs <= 0) return null;

	if (rangeLen === 1) return [1]; // single mini-sector: trivial

	// Compute raw durations for mini-sectors 0..len-2 from consecutive wall-clock times.
	const raw: number[] = new Array(rangeLen).fill(sectorMs / rangeLen);

	let hasAnyRealData = false;
	for (let j = 0; j < rangeLen - 1; j++) {
		const t0 = crossings[rangeStart + j];
		const t1 = crossings[rangeStart + j + 1];
		if (t0 !== undefined && t1 !== undefined && t1 > t0) {
			raw[j] = t1 - t0;
			hasAnyRealData = true;
		}
		// If same timestamp (batch arrival) keep uniform fallback for that slot.
	}

	if (!hasAnyRealData) return null; // no crossing data — don't calibrate

	// Last mini-sector: sector total minus sum of the others.
	const sumOthers = raw.slice(0, -1).reduce((a, b) => a + b, 0);
	raw[rangeLen - 1] = Math.max(MIN_SEG_MS, sectorMs - sumOthers);

	// Clamp all to a minimum to prevent zero-weight segments from batch arrivals.
	for (let j = 0; j < rangeLen; j++) {
		raw[j] = Math.max(MIN_SEG_MS, raw[j]);
	}

	// Normalise to fractions that sum to 1.
	const total = raw.reduce((a, b) => a + b, 0);
	if (total <= 0) return null;
	return raw.map((d) => d / total);
}

/**
 * EWMA blend of two weight arrays of the same length.
 * alpha: weight on the new observation (0 = ignore new, 1 = replace old).
 */
function blendWeights(prev: SectorWeights, next: SectorWeights, alpha: number): SectorWeights {
	if (prev.length !== next.length) return next;
	const blended = prev.map((w, i) => alpha * (next[i] ?? w) + (1 - alpha) * w);
	const sum = blended.reduce((a, b) => a + b, 0);
	return sum > 0 ? blended.map((w) => w / sum) : next;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSegmentWeightStore = create<SegmentWeightStore>((set, get) => ({
	drivers: {},

	ingest(timingData: TimingData, nowMs: number = Date.now()) {
		const state = get();
		const nextDrivers: Record<string, DriverState> = { ...state.drivers };
		let anyChanged = false;

		for (const [nr, d] of Object.entries(timingData.Lines)) {
			const sectors = d.Sectors ?? [];
			const allSegs = sectors.flatMap((s) => s.Segments ?? []);

			// --- Initialise first time we see this driver ---
			if (!nextDrivers[nr]) {
				nextDrivers[nr] = {
					prevStatuses: new Array(allSegs.length).fill(0),
					crossingWallMs: {},
					sectorWeights: [null, null, null],
					prevSectorValues: [null, null, null],
				};
				anyChanged = true;
			}

			const prev = nextDrivers[nr]!;
			let driverChanged = false;

			// --- Detect new mini-sector crossings ---
			const currentStatuses = allSegs.map((seg) => seg?.Status ?? 0);
			const prevActiveIdx = currentActiveIndex(prev.prevStatuses);
			const currentActiveIdx = currentActiveIndex(currentStatuses);
			const totalSegs = Math.max(currentStatuses.length, 1);
			const lapWrapped =
				prev.prevStatuses.length === currentStatuses.length &&
				prevActiveIdx > totalSegs * 0.7 &&
				currentActiveIdx < totalSegs * 0.3 &&
				currentActiveIdx < prevActiveIdx;

			const newCrossings = lapWrapped ? {} : { ...prev.crossingWallMs };
			const newPrevStatuses = lapWrapped
				? new Array(currentStatuses.length).fill(0)
				: [...prev.prevStatuses];

			if (lapWrapped) {
				driverChanged = true;
			}

			for (let i = 0; i < allSegs.length; i++) {
				const status = allSegs[i]?.Status ?? 0;
				// Compare against the mutable snapshot so lapWrapped resets are effective immediately.
				const wasPreviouslyActive = (newPrevStatuses[i] ?? 0) !== 0;
				if (status !== 0 && !wasPreviouslyActive) {
					newCrossings[i] = nowMs;
					driverChanged = true;
				}
				newPrevStatuses[i] = status;
			}

			// --- Detect sector completions and calibrate weights ---
			const newSectorWeights = [...prev.sectorWeights] as DriverSectorWeights;
			const newPrevSectorValues = [...prev.prevSectorValues] as [
				string | null,
				string | null,
				string | null,
			];

			let segOffset = 0;
			for (let si = 0; si < Math.min(sectors.length, 3); si++) {
				const sector = sectors[si];
				const segCount = sector?.Segments?.length ?? 0;
				const rangeStart = segOffset;
				segOffset += segCount;

				const sv = sector?.Value;
				if (sv && sv !== prev.prevSectorValues[si]) {
					// New sector completion — try to calibrate mini-sector weights.
					const sectorMs = parseTimeMs(sv);
					if (sectorMs !== null && sectorMs > 0 && segCount > 1) {
						const fresh = calibrateWeights(newCrossings, rangeStart, segCount, sectorMs);
						if (fresh !== null) {
							const existing = newSectorWeights[si];
							newSectorWeights[si] = existing
								? blendWeights(existing, fresh, WEIGHT_ALPHA)
								: fresh;
							driverChanged = true;
						}
					}
					newPrevSectorValues[si] = sv;
					driverChanged = true;
				}
			}

			if (driverChanged) {
				nextDrivers[nr] = {
					prevStatuses: newPrevStatuses,
					crossingWallMs: newCrossings,
					sectorWeights: newSectorWeights,
					prevSectorValues: newPrevSectorValues,
				};
				anyChanged = true;
			}
		}

		if (anyChanged) set({ drivers: nextDrivers });
	},
}));
