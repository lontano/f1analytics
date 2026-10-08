import type { Sector, TimingDataDriver, TimingStats } from "@/types/state.type";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function parseTimeMs(value: string | undefined | null): number | null {
	if (!value) return null;
	const v = value.trim();
	if (!v || v === "-- ---" || v === "-- -- ---") return null;
	const parts = v.split(":").map((p) => p.trim());
	if (parts.length === 1) {
		const s = Number.parseFloat(parts[0]);
		return Number.isFinite(s) ? Math.round(s * 1000) : null;
	}
	if (parts.length === 2) {
		const m = Number.parseInt(parts[0], 10);
		const s = Number.parseFloat(parts[1]);
		if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
		return Math.round((m * 60 + s) * 1000);
	}
	if (parts.length === 3) {
		const h = Number.parseInt(parts[0], 10);
		const m = Number.parseInt(parts[1], 10);
		const s = Number.parseFloat(parts[2]);
		if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
		return Math.round((h * 3600 + m * 60 + s) * 1000);
	}
	return null;
}

export function formatLapTimeMs(ms: number): string {
	const sec = Math.floor(ms / 1000);
	const frac = Math.round(ms % 1000);
	const m = Math.floor(sec / 60);
	const s = sec % 60;
	if (m > 0) return `${m}:${s.toString().padStart(2, "0")}.${frac.toString().padStart(3, "0")}`;
	return `${s}.${frac.toString().padStart(3, "0")}`;
}

export type EstimatedLapTone = "none" | "normal" | "personal" | "session";

export function classifyEstimatedLap(
	estimatedMs: number | null,
	personalBestMs: number | null,
	sessionBestMs: number | null,
): EstimatedLapTone {
	if (estimatedMs === null) return "none";
	if (sessionBestMs !== null && estimatedMs <= sessionBestMs) return "session";
	if (personalBestMs !== null && estimatedMs <= personalBestMs) return "personal";
	return "normal";
}

// ---------------------------------------------------------------------------
// Reference model
// ---------------------------------------------------------------------------

/**
 * A "template lap" built from all drivers' personal-best sector times.
 * Captures the proportional weight of each sector on this circuit.
 * Recomputed whenever TimingStats updates (i.e. a driver posts a new best).
 */
export type ReferenceModel = {
	/** Median of all drivers' best sector times [S1, S2, S3] in ms. */
	sectorMs: [number | null, number | null, number | null];
	/** Sum of the three reference sectors (null if any sector is missing). */
	lapMs: number | null;
};

function median(arr: number[]): number | null {
	if (arr.length === 0) return null;
	const sorted = [...arr].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function buildReferenceModel(timingStats: TimingStats | null | undefined): ReferenceModel {
	const samples: [number[], number[], number[]] = [[], [], []];

	for (const line of Object.values(timingStats?.Lines ?? {})) {
		for (let i = 0; i < 3; i++) {
			const ms = parseTimeMs(line.BestSectors?.[i]?.Value);
			if (ms !== null && ms > 0) samples[i].push(ms);
		}
	}

	const s0 = median(samples[0]);
	const s1 = median(samples[1]);
	const s2 = median(samples[2]);
	const lapMs = s0 !== null && s1 !== null && s2 !== null ? s0 + s1 + s2 : null;

	return { sectorMs: [s0, s1, s2], lapMs };
}

// ---------------------------------------------------------------------------
// Estimate types
// ---------------------------------------------------------------------------

/**
 * How each sector's time was obtained.
 *
 * - "live"  → actual measured time (sector.Value set this lap)
 * - "paced" → reference × pace-factor derived from THIS lap's completed sectors
 * - "prev"  → reference × pace-factor from driver's PREVIOUS lap time
 * - "ref"   → raw reference sector with no driver-specific scaling
 * - "none"  → no data available
 */
export type SectorQuality = "live" | "paced" | "prev" | "ref" | "none";

export type LapConfidence =
	| "high" // ≥2 sectors complete this lap → pace factor is well-calibrated
	| "medium" // 1 sector complete or pace from previous lap
	| "low" // pure reference, no current-lap or previous-lap pace data
	| "none"; // estimate not computable

export type LapEstimate = {
	ms: number | null;
	confidence: LapConfidence;
	sectorQuality: [SectorQuality, SectorQuality, SectorQuality];
	/** The pace multiplier applied to reference sectors (1.0 = at reference pace). */
	paceFactor: number | null;
	/** Where the pace factor came from. */
	paceSource: "current-lap" | "prev-lap" | "none";
	/**
	 * Whether calibrated mini-sector weights (from wall-clock crossing times)
	 * were used for at least one sector instead of uniform distribution.
	 */
	calibrated: boolean;
};

// ---------------------------------------------------------------------------
// Segment helpers
// ---------------------------------------------------------------------------

export function countSegments(sectors: Sector[]): number {
	return sectors.reduce((acc, s) => acc + (s.Segments?.length ?? 0), 0);
}

function buildSectorRanges(sectors: Sector[]) {
	let segIdx = 0;
	return sectors.map((s) => {
		const start = segIdx;
		const len = s.Segments?.length ?? 0;
		segIdx += len;
		return { start, end: segIdx, len };
	});
}

function currentSegmentIndex(sectors: Sector[]): number {
	const all = sectors.flatMap((s) => s.Segments ?? []);
	for (let i = all.length - 1; i >= 0; i--) {
		if ((all[i]?.Status ?? 0) !== 0) return i;
	}
	return 0;
}

// ---------------------------------------------------------------------------
// Pace-factor estimator
// ---------------------------------------------------------------------------

/**
 * Compute a pace factor: how fast is this driver relative to the reference?
 *
 * Priority:
 *   1. Ratio of completed sectors this lap vs their reference counterparts.
 *   2. Ratio of the driver's previous lap time vs the reference lap time.
 *   3. null (caller should default to 1.0).
 *
 * Exported so the Map component can use it for dead-reckoning position lerp.
 */
export function computePaceFactor(
	timingDriver: TimingDataDriver,
	refModel: ReferenceModel,
): { factor: number | null; source: "current-lap" | "prev-lap" | "none"; completedSectors: number } {
	const sectors = timingDriver.Sectors ?? [];

	// --- 1. Use this lap's completed sectors ---
	let sumActual = 0;
	let sumRef = 0;
	let completedSectors = 0;

	for (let i = 0; i < Math.min(sectors.length, 3); i++) {
		const actual = parseTimeMs(sectors[i]?.Value);
		const ref = refModel.sectorMs[i];
		if (actual !== null && actual > 0 && ref !== null && ref > 0) {
			sumActual += actual;
			sumRef += ref;
			completedSectors++;
		}
	}

	if (completedSectors > 0 && sumRef > 0) {
		return { factor: sumActual / sumRef, source: "current-lap", completedSectors };
	}

	// --- 2. Fall back to previous lap vs reference lap ---
	const lastLapMs = parseTimeMs(timingDriver.LastLapTime?.Value);
	if (lastLapMs !== null && lastLapMs > 0 && refModel.lapMs !== null && refModel.lapMs > 0) {
		return { factor: lastLapMs / refModel.lapMs, source: "prev-lap", completedSectors: 0 };
	}

	return { factor: null, source: "none", completedSectors: 0 };
}

// ---------------------------------------------------------------------------
// Main estimation function
// ---------------------------------------------------------------------------

/**
 * Estimate the projected final lap time for a driver currently on-track.
 *
 * Algorithm:
 *   - Completed sectors: use their actual measured time (sector.Value).
 *   - Current (in-progress) sector: split into elapsed + remaining using the
 *     fraction of mini-sectors crossed; both parts scaled by the pace factor.
 *     This gives a true per-mini-sector update.
 *   - Future sectors: reference time × pace factor.
 *
 * The pace factor is derived from this lap's completed sectors vs the
 * field-median reference (most accurate), or from the previous lap time
 * (cold-start), or defaults to 1.0 (reference pace).
 */
/**
 * Normalised per-mini-sector weight fractions for all three sectors.
 * Each inner array sums to 1; multiply by estimated sector ms to get per-seg ms.
 * null = not yet calibrated (use uniform distribution).
 */
export type MiniSectorWeights = [number[] | null, number[] | null, number[] | null];

export function estimateCurrentLap(
	timingDriver: TimingDataDriver | null,
	refModel: ReferenceModel,
	miniSectorWeights?: MiniSectorWeights | null,
	/**
	 * Wall-clock timestamps (Date.now()) for when each global mini-sector index
	 * first became active. When provided together with nowMs, the elapsed time
	 * within the current (in-progress) mini-sector is interpolated continuously
	 * rather than counting that segment as fully elapsed.
	 */
	crossingWallMs?: Record<number, number> | null,
	/** Current wall-clock time (Date.now()). Required for continuous interpolation. */
	nowMs?: number,
): LapEstimate {
	const none: LapEstimate = {
		ms: null,
		confidence: "none",
		sectorQuality: ["none", "none", "none"],
		paceFactor: null,
		paceSource: "none",
		calibrated: false,
	};

	if (!timingDriver) return none;

	const sectors = timingDriver.Sectors ?? [];
	const total = countSegments(sectors);
	if (total <= 0 || sectors.length === 0) return none;

	const currentIdx = currentSegmentIndex(sectors);
	const ranges = buildSectorRanges(sectors);

	const { factor, source, completedSectors } = computePaceFactor(timingDriver, refModel);
	const paceFactor = factor ?? 1.0;
	const hasReference = refModel.lapMs !== null;

	const sectorQuality: [SectorQuality, SectorQuality, SectorQuality] = ["none", "none", "none"];
	let elapsedMs = 0;
	let remainingMs = 0;
	let hasAnyData = false;
	let calibrated = false;

	for (let si = 0; si < Math.min(sectors.length, 3); si++) {
		const sector = sectors[si];
		const r = ranges[si];
		if (!r || r.len <= 0) continue;

		const isFuture = currentIdx < r.start;
		const isCurrent = currentIdx >= r.start && currentIdx < r.end;

		const liveMs = parseTimeMs(sector?.Value);

		// Completed sector: use actual time.
		if (liveMs !== null) {
			sectorQuality[si] = "live";
			elapsedMs += liveMs;
			hasAnyData = true;
			continue;
		}

		// For uncompleted sectors, determine estimated sector duration.
		// Prefer reference × pace-factor; fall back to sector.PreviousValue.
		const refMs = refModel.sectorMs[si];
		let sectorEstMs: number | null = null;
		let quality: SectorQuality = "none";

		if (refMs !== null) {
			sectorEstMs = refMs * paceFactor;
			quality = source === "current-lap" ? "paced" : source === "prev-lap" ? "prev" : "ref";
		} else {
			// No reference: fall back to previous value for this sector.
			const prevMs = parseTimeMs(sector?.PreviousValue);
			if (prevMs !== null) {
				sectorEstMs = prevMs;
				quality = "prev";
			}
		}

		if (sectorEstMs === null) continue;

		sectorQuality[si] = quality;
		hasAnyData = true;

		if (isFuture) {
			remainingMs += sectorEstMs;
		} else if (isCurrent) {
			// Split elapsed vs remaining within the current sector.
			// Use calibrated mini-sector weight fractions when available;
			// fall back to uniform distribution.
			//
			// For the in-progress mini-sector itself: when crossingWallMs+nowMs are
			// provided we interpolate the partial elapsed time continuously instead
			// of counting the segment as fully complete.  This makes the estimate
			// tick up in real-time between server confirmations.
			const weights = miniSectorWeights?.[si];
			if (weights && weights.length === r.len) {
				// Calibrated path: each mini-sector has a unique time fraction.
				for (let seg = 0; seg < r.len; seg++) {
					const globalSeg = r.start + seg;
					const segMs = (weights[seg] ?? 1 / r.len) * sectorEstMs;
					if (globalSeg < currentIdx) {
						elapsedMs += segMs;
					} else if (globalSeg === currentIdx) {
						// Intra-segment interpolation when we have wall-clock data.
						const tEnter = crossingWallMs?.[currentIdx];
						if (tEnter !== undefined && nowMs !== undefined) {
							const intra = Math.max(0, Math.min(nowMs - tEnter, segMs));
							elapsedMs += intra;
							remainingMs += segMs - intra;
						} else {
							elapsedMs += segMs; // fallback: count as fully elapsed
						}
						calibrated = true;
					} else {
						remainingMs += segMs;
					}
				}
			} else {
				// Uniform fallback.
				const perSeg = sectorEstMs / r.len;
				// Fully confirmed mini-sectors before the current one.
				elapsedMs += perSeg * (currentIdx - r.start);
				// Intra-segment interpolation for the current mini-sector.
				const tEnter = crossingWallMs?.[currentIdx];
				if (tEnter !== undefined && nowMs !== undefined) {
					const intra = Math.max(0, Math.min(nowMs - tEnter, perSeg));
					elapsedMs += intra;
					remainingMs += perSeg - intra;
				} else {
					elapsedMs += perSeg; // fallback: count as fully elapsed
				}
				// Remaining mini-sectors after the current one.
				remainingMs += perSeg * (r.len - (currentIdx - r.start) - 1);
			}
		} else {
			// Past sector with no Value yet (edge case in the feed).
			// Use previous value if available, otherwise reference estimate.
			const prevMs = parseTimeMs(sector?.PreviousValue);
			elapsedMs += prevMs !== null ? prevMs : sectorEstMs;
		}
	}

	if (!hasAnyData || !hasReference) return none;

	const totalMs = elapsedMs + remainingMs;
	if (!Number.isFinite(totalMs) || totalMs <= 0) return none;

	// Confidence based on how well-calibrated the pace factor is.
	let confidence: LapConfidence;
	if (completedSectors >= 2) confidence = "high";
	else if (completedSectors === 1 || source === "prev-lap") confidence = "medium";
	else if (hasReference) confidence = "low";
	else confidence = "none";

	return {
		ms: Math.round(totalMs),
		confidence,
		sectorQuality,
		paceFactor: factor,
		paceSource: source,
		calibrated,
	};
}
