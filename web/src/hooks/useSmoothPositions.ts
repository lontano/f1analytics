"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useReferenceModel } from "@/hooks/useReferenceModel";
import { computePaceFactor, countSegments, parseTimeMs } from "@/lib/lapModel";
import { useDataStore } from "@/stores/useDataStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useSegmentWeightStore } from "@/stores/useSegmentWeightStore";
import type { Sector, TimingDataDriver } from "@/types/state.type";
import type { ReferenceModel } from "@/lib/lapModel";

export type SmoothPositionsResult = {
	getSmoothedIndex: (driverNr: string) => number | null;
	delayMs: number;
	extraDelayMs: number;
	pageDelayMs: number;
	enabled: boolean;
};

const MIN_SEG_MS = 80;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function currentSegmentIndex(sectors: Sector[]): number {
	const all = sectors.flatMap((s) => s.Segments ?? []);
	for (let i = all.length - 1; i >= 0; i--) {
		if ((all[i]?.Status ?? 0) !== 0) return i;
	}
	return 0;
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

function buildEstimatedSegmentDurationsMs(
	timingDriver: TimingDataDriver,
	refModel: ReferenceModel,
	sectorWeights: [number[] | null, number[] | null, number[] | null] | null | undefined,
) {
	const sectors = timingDriver.Sectors ?? [];
	const ranges = buildSectorRanges(sectors);
	const { factor } = computePaceFactor(timingDriver, refModel);
	const paceFactor = factor ?? 1;
	const fallbackPerSeg =
		refModel.lapMs !== null && countSegments(sectors) > 0
			? refModel.lapMs / Math.max(countSegments(sectors), 1)
			: 4000;

	const durations: number[] = [];

	for (let si = 0; si < Math.min(sectors.length, 3); si++) {
		const sector = sectors[si];
		const range = ranges[si];
		if (!range || range.len <= 0) continue;

		const liveMs = parseTimeMs(sector?.Value);
		const prevMs = parseTimeMs(sector?.PreviousValue);
		const refSectorMs = refModel.sectorMs[si];
		const sectorTotalMs =
			liveMs ??
			(refSectorMs !== null
				? refSectorMs * paceFactor
				: prevMs !== null
					? prevMs
					: Math.max(MIN_SEG_MS * range.len, fallbackPerSeg * range.len));

		const weights = sectorWeights?.[si];
		if (weights && weights.length === range.len) {
			for (let seg = 0; seg < range.len; seg++) {
				durations.push(Math.max(MIN_SEG_MS, (weights[seg] ?? 1 / range.len) * sectorTotalMs));
			}
		} else {
			const perSegMs = Math.max(MIN_SEG_MS, sectorTotalMs / range.len);
			for (let seg = 0; seg < range.len; seg++) {
				durations.push(perSegMs);
			}
		}
	}

	return durations;
}

function buildSegmentEnterTimes(
	totalSegments: number,
	segmentDurationsMs: number[],
	crossingWallMs: Record<number, number>,
) {
	const knownEntries = Object.entries(crossingWallMs)
		.map(([idx, ms]) => ({ idx: Number.parseInt(idx, 10), ms }))
		.filter((v) => Number.isFinite(v.idx) && Number.isFinite(v.ms) && v.idx >= 0 && v.idx < totalSegments)
		.sort((a, b) => a.idx - b.idx);

	if (knownEntries.length === 0) return null;

	// Prefix sums for fast "expected gap" between indices.
	const durPrefix: number[] = new Array(totalSegments + 1);
	durPrefix[0] = 0;
	for (let i = 0; i < totalSegments; i++) {
		const d = Math.max(MIN_SEG_MS, segmentDurationsMs[i] ?? MIN_SEG_MS);
		durPrefix[i + 1] = durPrefix[i]! + d;
	}

	// Ensure wall-clock entries are monotonic without introducing lap-sized jumps.
	// Equal timestamps can happen when TimingData arrives in batches; spread them using estimated durations.
	const alignedEntries = knownEntries.map((e) => ({ ...e }));
	for (let i = 1; i < alignedEntries.length; i++) {
		const prev = alignedEntries[i - 1]!;
		const cur = alignedEntries[i]!;
		if (cur.ms <= prev.ms) {
			const expectedGap = (durPrefix[cur.idx] ?? 0) - (durPrefix[prev.idx] ?? 0);
			cur.ms = prev.ms + Math.max(MIN_SEG_MS, expectedGap);
		}
	}

	const enterTimes = new Array<number>(totalSegments).fill(Number.NaN);
	for (const entry of alignedEntries) {
		enterTimes[entry.idx] = entry.ms;
	}

	for (let k = 0; k < alignedEntries.length - 1; k++) {
		const start = alignedEntries[k]!;
		const end = alignedEntries[k + 1]!;
		if (end.idx <= start.idx) continue;

		const actualGapMs = end.ms - start.ms;
		let estimatedGapMs = 0;
		for (let i = start.idx; i < end.idx; i++) {
			estimatedGapMs += segmentDurationsMs[i] ?? MIN_SEG_MS;
		}
		const scale =
			actualGapMs > 0 && estimatedGapMs > 0 ? actualGapMs / estimatedGapMs : 1;

		let t = start.ms;
		for (let i = start.idx + 1; i < end.idx; i++) {
			t += (segmentDurationsMs[i - 1] ?? MIN_SEG_MS) * scale;
			enterTimes[i] = t;
		}
	}

	const firstKnown = alignedEntries[0]!;
	for (let i = firstKnown.idx - 1; i >= 0; i--) {
		enterTimes[i] = enterTimes[i + 1]! - (segmentDurationsMs[i] ?? MIN_SEG_MS);
	}

	const lastKnown = alignedEntries[alignedEntries.length - 1]!;
	for (let i = lastKnown.idx + 1; i < totalSegments; i++) {
		enterTimes[i] = enterTimes[i - 1]! + (segmentDurationsMs[i - 1] ?? MIN_SEG_MS);
	}

	return enterTimes;
}

/**
 * When enabled, returns a function that yields a fractional segment index per driver
 * by interpolating between wall-clock mini-sector crossing times, with a delay so
 * the "display" position lags real-time and can be smoothly lerped.
 */
export function useSmoothPositions(
	enabled: boolean,
	totalSegments: number,
): SmoothPositionsResult {
	const refModel = useReferenceModel();
	const timingData = useDataStore((s) => s.state?.TimingData);
	const pageDelaySeconds = useSettingsStore((s) => s.delay);
	const drivers = useSegmentWeightStore((s) => s.drivers);
	const lastSmoothedRef = useRef<Record<string, number>>({});
	const pageDelayMs = pageDelaySeconds * 1000;

	const delayMs = useMemo(() => {
		if (!enabled) return 0;
		if (refModel.lapMs != null && refModel.lapMs > 0 && totalSegments > 0) {
			return (refModel.lapMs / totalSegments) * 2;
		}
		return 6000;
	}, [enabled, refModel.lapMs, totalSegments]);
	const extraDelayMs = useMemo(() => Math.max(0, delayMs - pageDelayMs), [delayMs, pageDelayMs]);

	const [renderNowMs, setRenderNowMs] = useState(() => Date.now());

	useEffect(() => {
		if (!enabled) return;
		let rafId: number;
		let intervalId: ReturnType<typeof setInterval>;
		const tick = () => setRenderNowMs(Date.now());
		const loop = () => {
			tick();
			rafId = requestAnimationFrame(loop);
		};
		rafId = requestAnimationFrame(loop);
		intervalId = setInterval(tick, 100);
		return () => {
			cancelAnimationFrame(rafId);
			clearInterval(intervalId);
		};
	}, [enabled]);

	useEffect(() => {
		lastSmoothedRef.current = {};
	}, [enabled, extraDelayMs]);

	const getSmoothedIndex = useCallback(
		(driverNr: string): number | null => {
			if (totalSegments < 2) return null;

			const driverState = drivers[driverNr];
			const timingDriver = timingData?.Lines?.[driverNr];
			if (!driverState || !timingDriver) return null;

			const sectors = timingDriver.Sectors ?? [];
			const driverTotal = Math.max(countSegments(sectors), driverState.prevStatuses.length, totalSegments, 1);
			const displayTime = renderNowMs - extraDelayMs;
			const segmentDurationsMs = buildEstimatedSegmentDurationsMs(
				timingDriver,
				refModel,
				driverState.sectorWeights,
			);
			const enterTimes = buildSegmentEnterTimes(driverTotal, segmentDurationsMs, driverState.crossingWallMs);

			let candidate = Number.NaN;

			if (enterTimes && enterTimes.length > 0) {
				const firstEnterMs = enterTimes[0]!;
				if (displayTime < firstEnterMs) {
					candidate = currentSegmentIndex(sectors);
				} else {
					let idx = 0;
					for (let i = 0; i < enterTimes.length; i++) {
						if (enterTimes[i]! <= displayTime) idx = i;
						else break;
					}

					const startMs = enterTimes[idx]!;
					const nextMs =
						idx < enterTimes.length - 1
							? enterTimes[idx + 1]!
							: startMs + (segmentDurationsMs[idx] ?? MIN_SEG_MS);
					const segDurationMs = Math.max(MIN_SEG_MS, nextMs - startMs);
					const intra = clamp((displayTime - startMs) / segDurationMs, 0, 1);
					candidate = Math.min(idx + intra, driverTotal - 1);
				}
			}

			if (!Number.isFinite(candidate)) {
				candidate = currentSegmentIndex(sectors);
			}

			lastSmoothedRef.current[driverNr] = candidate;
			return candidate;
		},
		[drivers, extraDelayMs, refModel, renderNowMs, timingData?.Lines, totalSegments],
	);

	return {
		getSmoothedIndex,
		delayMs,
		extraDelayMs,
		pageDelayMs,
		enabled,
	};
}
