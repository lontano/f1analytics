"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useInterval } from "@/hooks/useInterval";
import clsx from "clsx";

import type { Driver, Sector, TimingData, TimingDataDriver, TimingStats } from "@/types/state.type";

import { sortPos } from "@/lib/sorting";
import { asArray } from "@/lib/merge";

import { useDataStore } from "@/stores/useDataStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useReferenceModel } from "@/hooks/useReferenceModel";
import { classifyEstimatedLap, estimateCurrentLap, formatLapTimeMs } from "@/lib/lapModel";
import type { SectorQuality } from "@/lib/lapModel";
import { useSegmentWeightStore } from "@/stores/useSegmentWeightStore";
import TrackOverview from "@/components/dashboard/TrackOverview";
import type { SmoothPositionsResult } from "@/hooks/useSmoothPositions";

const INTERVAL_DRIVER_SIZE_KEY = "trackmap.intervalDriverSize";
const INTERVAL_LINE_COVERAGE_KEY = "trackmap.intervalLineCoverage";
const INTERVAL_HEIGHT_KEY = "trackmap.intervalHeight";
const TRACK_ANALYSIS_HEIGHT_KEY = "trackmap.trackAnalysisHeight";
const INTERVAL_HEIGHT_MIN = 80;
const INTERVAL_HEIGHT_MAX = 400;
const INTERVAL_HEIGHT_DEFAULT = 140;
const TRACK_ANALYSIS_HEIGHT_MIN = 80;
const TRACK_ANALYSIS_HEIGHT_MAX = 400;
const TRACK_ANALYSIS_HEIGHT_DEFAULT = 140;
const DRIVER_SIZE_MIN = 1;
const DRIVER_SIZE_MAX = 8;
const DRIVER_SIZE_DEFAULT = 2;
const LINE_COVERAGE_MIN = 0.1;
const LINE_COVERAGE_MAX = 1;
const LINE_COVERAGE_DEFAULT = 1;

type Props = {
	selectedNr: string | null;
	driverLabel?: string;
	sectors: Sector[];
	onSelectDriver?: (nr: string | null) => void;
	smooth?: SmoothPositionsResult | null;
};

type Point = { x: number; y: number };

const TAU = 2 * Math.PI;

const polar = (cx: number, cy: number, r: number, a: number): Point => ({
	x: cx + r * Math.cos(a),
	y: cy + r * Math.sin(a),
});

const arcPath = (cx: number, cy: number, r: number, start: number, end: number, clockwise: boolean) => {
	const s = polar(cx, cy, r, start);
	const e = polar(cx, cy, r, end);

	const len = clockwise ? ((end - start) % TAU + TAU) % TAU : ((start - end) % TAU + TAU) % TAU;
	const largeArcFlag = len > Math.PI ? 1 : 0;
	const sweepFlag = clockwise ? 1 : 0;

	return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${e.x} ${e.y}`;
};

const sectorTimeLabel = (s: Sector) => (s.Value ? s.Value : s.PreviousValue ? s.PreviousValue : "-- ---");

const miniSectorStroke = (status: number | undefined) =>
	clsx({
		"stroke-amber-400": status === 2048 || status === 2052,
		"stroke-emerald-500": status === 2049,
		"stroke-violet-600": status === 2051,
		"stroke-blue-500": status === 2064,
		"stroke-zinc-700": status === 0 || status === undefined,
	});

const estimatedLapFill = (tone: ReturnType<typeof classifyEstimatedLap>) =>
	clsx({
		"fill-zinc-500": tone === "none",
		"fill-amber-400": tone === "normal",
		"fill-emerald-500": tone === "personal",
		"fill-violet-600": tone === "session",
	});

const parseGapToSeconds = (value: string | undefined | null): number | null => {
	if (!value) return null;
	const v = value.trim().replace(/^\+/, "");
	if (!v || v === "-- ---" || v === "-- -- ---" || v === "---") return null;
	const s = Number.parseFloat(v);
	return Number.isFinite(s) ? s : null;
};

const parseTimeMs = (value: string | undefined | null): number | null => {
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
};

const countSegments = (sectors: Sector[]) => sectors.reduce((acc, s) => acc + (asArray(s.Segments).length), 0);

const currentSegmentIndex = (sectors: Sector[]) => {
	const all = sectors.flatMap((s) => asArray(s.Segments));
	if (all.length === 0) return 0;

	for (let i = all.length - 1; i >= 0; i--) {
		const st = all[i]?.Status ?? 0;
		if (st !== 0) return i;
	}

	return 0;
};

const mapIndex = (idx: number, fromTotal: number, toTotal: number) => {
	if (toTotal <= 1 || fromTotal <= 1) return 0;
	const ratio = idx / (fromTotal - 1);
	return Math.min(toTotal - 1, Math.max(0, Math.floor(ratio * (toTotal - 1))));
};

const mapIndexFloat = (idx: number, fromTotal: number, toTotal: number) => {
	if (toTotal <= 1 || fromTotal <= 1) return 0;
	const ratio = idx / (fromTotal - 1);
	return Math.min(toTotal - 1, Math.max(0, ratio * (toTotal - 1)));
};

const mapSmoothedToBase = (smoothedIdx: number, knownDriverTotal: number, baseTotal: number) => {
	const inferredFromTotal = Math.max(knownDriverTotal, baseTotal, Math.floor(smoothedIdx) + 1, 1);
	return mapIndexFloat(smoothedIdx, inferredFromTotal, baseTotal);
};

const buildSectorRanges = (sectors: Sector[]) => {
	let segIdx = 0;
	return sectors.map((s, i) => {
		const start = segIdx;
		const len = asArray(s.Segments).length;
		segIdx += len;
		return { sectorIndex: i, start, end: segIdx, len };
	});
};

const findSectorForIdx = (
	ranges: { sectorIndex: number; start: number; end: number; len: number }[],
	idx: number,
) => {
	for (const r of ranges) {
		if (idx >= r.start && idx < r.end) return r;
	}
	return ranges[ranges.length - 1];
};

const estimateMiniTimeMs = (timingDriver: TimingDataDriver, baseIdx: number, baseTotal: number) => {
	const sectors = timingDriver.Sectors ?? [];
	const total = countSegments(sectors);
	if (sectors.length === 0 || total <= 0) return 900;

	const idx = mapIndex(baseIdx, baseTotal, total);
	const ranges = buildSectorRanges(sectors);
	const r = findSectorForIdx(ranges, idx);
	const sector = sectors[r.sectorIndex];

	const secMs = parseTimeMs(sector.Value) ?? parseTimeMs(sector.PreviousValue);
	if (secMs !== null && r.len > 0) return secMs / r.len;

	const lapMs = parseTimeMs(timingDriver.LastLapTime?.Value) ?? parseTimeMs(timingDriver.BestLapTime?.Value);
	if (lapMs !== null && total > 0) return lapMs / total;

	return 900;
};

const compareColor = (
	selected: TimingDataDriver | null,
	selectedIdxBase: number,
	other: TimingDataDriver,
	otherIdxBase: number,
	baseTotal: number,
) => {
	if (!selected) return "fill-zinc-500";

	const delta = ((otherIdxBase - selectedIdxBase) % baseTotal + baseTotal) % baseTotal;
	const otherAhead = delta !== 0 && delta <= baseTotal / 2;
	const idxToCompare = otherAhead ? selectedIdxBase : otherIdxBase;

	const selMs = estimateMiniTimeMs(selected, idxToCompare, baseTotal);
	const othMs = estimateMiniTimeMs(other, idxToCompare, baseTotal);

	if (!Number.isFinite(selMs) || !Number.isFinite(othMs)) return "fill-zinc-500";
	return selMs < othMs ? "fill-emerald-500" : "fill-red-500";
};

const fillToStroke = (fill: string) =>
	fill.includes("emerald") ? "stroke-emerald-500" : fill.includes("red") ? "stroke-red-500" : "stroke-zinc-600";

/** Signed delta for linear layout: negative = behind, positive = ahead. */
const signedSegmentDelta = (otherIdx: number, selectedIdx: number, total: number): number => {
	let d = otherIdx - selectedIdx;
	if (d > total / 2) d -= total;
	if (d < -total / 2) d += total;
	return d;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const qualityStroke = (q: SectorQuality): string => {
	switch (q) {
		case "live":
			return "stroke-emerald-500";
		case "paced":
			return "stroke-sky-500";
		case "prev":
			return "stroke-amber-400";
		case "ref":
			return "stroke-zinc-600";
		default:
			return "stroke-zinc-800";
	}
};

export default function TrackCircle({ selectedNr, driverLabel, sectors, onSelectDriver, smooth }: Props) {
	const ranges = useMemo(() => buildSectorRanges(sectors), [sectors]);
	const totalSegments = useMemo(() => countSegments(sectors), [sectors]);

	if (!sectors || sectors.length === 0 || totalSegments <= 0) {
		return (
			<div className="flex h-64 w-full items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-sm text-zinc-500">
				No minisector data yet.
			</div>
		);
	}

	const timingData = useDataStore((s) => s.state?.TimingData) as TimingData | undefined;
	const drivers = useDataStore((s) => s.state?.DriverList) as Record<string, Driver> | undefined;
	const sessionInfo = useDataStore((s) => s.state?.SessionInfo);
	const timingStats = useDataStore((s) => s.state?.TimingStats) as TimingStats | undefined;
	const selectedTeamColor = selectedNr ? drivers?.[selectedNr]?.TeamColour : undefined;
	const favoriteDrivers = useSettingsStore((state) => state.favoriteDrivers);
	const showEstimatedLap = useSettingsStore((state) => state.showEstimatedLap);

	const refModel = useReferenceModel();
	const segWeights = useSegmentWeightStore(
		(s) => (selectedNr ? (s.drivers[selectedNr]?.sectorWeights ?? null) : null),
	);
	const crossingWallMs = useSegmentWeightStore(
		(s) => (selectedNr ? (s.drivers[selectedNr]?.crossingWallMs ?? null) : null),
	);

	const selectedTiming = useMemo(() => {
		if (!timingData || !selectedNr) return null;
		return timingData.Lines[selectedNr] ?? null;
	}, [timingData, selectedNr]);

	// Tick every 200 ms so the intra-mini-sector elapsed time continuously updates.
	const [nowMs, setNowMs] = useState(() => Date.now());
	useInterval(() => setNowMs(Date.now()), 200);

	const lapEstimate = estimateCurrentLap(selectedTiming, refModel, segWeights, crossingWallMs, nowMs);
	const selectedBestLap = selectedTiming?.BestLapTime?.Value ?? null;
	const selectedBestPosition = selectedNr ? timingStats?.Lines?.[selectedNr]?.PersonalBestLapTime?.Position : undefined;

	const sectorQuality = lapEstimate.sectorQuality;

	const rawSelectedIdx = useMemo(() => currentSegmentIndex(sectors), [sectors]);
	const smoothedSelectedIdx = smooth?.enabled && selectedNr ? smooth.getSmoothedIndex(selectedNr) : null;
	const selectedIdxBase =
		smoothedSelectedIdx !== null
			? mapSmoothedToBase(smoothedSelectedIdx, totalSegments, totalSegments)
			: rawSelectedIdx;

	const [dynamicSize, setDynamicSize] = useState<boolean>(false);
	const [pitstopSec, setPitstopSec] = useState<number>(22.0);
	const [pitstopAnalysis, setPitstopAnalysis] = useState<boolean>(false);

	const [intervalDriverSize, setIntervalDriverSize] = useState<number>(() => {
		try {
			const raw = window.localStorage.getItem(INTERVAL_DRIVER_SIZE_KEY);
			const parsed = raw ? Number.parseFloat(raw) : DRIVER_SIZE_DEFAULT;
			return Number.isFinite(parsed)
				? Math.min(DRIVER_SIZE_MAX, Math.max(DRIVER_SIZE_MIN, parsed))
				: DRIVER_SIZE_DEFAULT;
		} catch {
			return DRIVER_SIZE_DEFAULT;
		}
	});
	const [intervalLineCoverage, setIntervalLineCoverage] = useState<number>(() => {
		try {
			const raw = window.localStorage.getItem(INTERVAL_LINE_COVERAGE_KEY);
			const parsed = raw ? Number.parseFloat(raw) : LINE_COVERAGE_DEFAULT;
			return Number.isFinite(parsed)
				? Math.min(LINE_COVERAGE_MAX, Math.max(LINE_COVERAGE_MIN, parsed))
				: LINE_COVERAGE_DEFAULT;
		} catch {
			return LINE_COVERAGE_DEFAULT;
		}
	});

	const [intervalHeight, setIntervalHeight] = useState<number>(() => {
		try {
			const raw = window.localStorage.getItem(INTERVAL_HEIGHT_KEY);
			const parsed = raw ? Number.parseInt(raw, 10) : INTERVAL_HEIGHT_DEFAULT;
			return Number.isFinite(parsed)
				? Math.min(INTERVAL_HEIGHT_MAX, Math.max(INTERVAL_HEIGHT_MIN, parsed))
				: INTERVAL_HEIGHT_DEFAULT;
		} catch {
			return INTERVAL_HEIGHT_DEFAULT;
		}
	});
	const [trackAnalysisHeight, setTrackAnalysisHeight] = useState<number>(() => {
		try {
			const raw = window.localStorage.getItem(TRACK_ANALYSIS_HEIGHT_KEY);
			const parsed = raw ? Number.parseInt(raw, 10) : TRACK_ANALYSIS_HEIGHT_DEFAULT;
			return Number.isFinite(parsed)
				? Math.min(TRACK_ANALYSIS_HEIGHT_MAX, Math.max(TRACK_ANALYSIS_HEIGHT_MIN, parsed))
				: TRACK_ANALYSIS_HEIGHT_DEFAULT;
		} catch {
			return TRACK_ANALYSIS_HEIGHT_DEFAULT;
		}
	});

	const intervalHeightRef = useRef<number>(intervalHeight);
	useEffect(() => {
		intervalHeightRef.current = intervalHeight;
	}, [intervalHeight]);
	const trackAnalysisHeightRef = useRef<number>(trackAnalysisHeight);
	useEffect(() => {
		trackAnalysisHeightRef.current = trackAnalysisHeight;
	}, [trackAnalysisHeight]);
	const intervalViewportRef = useRef<HTMLDivElement | null>(null);
	const [intervalViewportWidth, setIntervalViewportWidth] = useState<number>(0);
	useEffect(() => {
		const el = intervalViewportRef.current;
		if (!el) return;

		const updateWidth = () => {
			const next = Math.max(0, Math.floor(el.clientWidth));
			setIntervalViewportWidth((prev) => (prev === next ? prev : next));
		};

		updateWidth();

		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => updateWidth());
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const startResizeInterval = (e: React.PointerEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		const startY = e.clientY;
		const startH = intervalHeightRef.current;
		const onMove = (ev: PointerEvent) => {
			const next = Math.min(
				INTERVAL_HEIGHT_MAX,
				Math.max(INTERVAL_HEIGHT_MIN, startH - (ev.clientY - startY)),
			);
			intervalHeightRef.current = next;
			setIntervalHeight(next);
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			try {
				window.localStorage.setItem(INTERVAL_HEIGHT_KEY, String(intervalHeightRef.current));
			} catch {
				// ignore
			}
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp, { once: true });
	};
	const startResizeTrackAnalysis = (e: React.PointerEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		const startY = e.clientY;
		const startH = trackAnalysisHeightRef.current;
		const onMove = (ev: PointerEvent) => {
			const next = Math.min(
				TRACK_ANALYSIS_HEIGHT_MAX,
				Math.max(TRACK_ANALYSIS_HEIGHT_MIN, startH - (ev.clientY - startY)),
			);
			trackAnalysisHeightRef.current = next;
			setTrackAnalysisHeight(next);
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			try {
				window.localStorage.setItem(TRACK_ANALYSIS_HEIGHT_KEY, String(trackAnalysisHeightRef.current));
			} catch {
				// ignore
			}
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp, { once: true });
	};

	useEffect(() => {
		try {
			window.localStorage.setItem(INTERVAL_DRIVER_SIZE_KEY, String(intervalDriverSize));
		} catch {
			// ignore
		}
	}, [intervalDriverSize]);
	useEffect(() => {
		try {
			window.localStorage.setItem(INTERVAL_LINE_COVERAGE_KEY, String(intervalLineCoverage));
		} catch {
			// ignore
		}
	}, [intervalLineCoverage]);

	const size = 320;
	const cx = size / 2;
	const cy = size / 2;
	const r = 112;
	const startAngle = -Math.PI / 2;
	const fallbackSegAngle = TAU / totalSegments;

	const fastestLapProfile = useMemo(() => {
		if (!timingStats?.Lines) return null;

		const statsLines = timingStats.Lines;

		let fastestNr: string | null = null;
		let fastestLapMs: number | null = null;

		// Prefer the driver marked position 1 for lap, else fallback to min lap time.
		for (const [nr, st] of Object.entries(statsLines)) {
			const pos = st.PersonalBestLapTime?.Position;
			const lapMs = parseTimeMs(st.PersonalBestLapTime?.Value);
			if (pos === 1 && lapMs !== null) {
				fastestNr = nr;
				fastestLapMs = lapMs;
				break;
			}
		}

		if (!fastestNr || fastestLapMs === null) {
			for (const [nr, st] of Object.entries(statsLines)) {
				const lapMs = parseTimeMs(st.PersonalBestLapTime?.Value);
				if (lapMs === null) continue;
				if (fastestLapMs === null || lapMs < fastestLapMs) {
					fastestLapMs = lapMs;
					fastestNr = nr;
				}
			}
		}

		if (!fastestNr || fastestLapMs === null) return null;

		const st = statsLines[fastestNr];
		const sectorMs: Array<number | null> = [null, null, null];

		for (let i = 0; i < 3; i++) {
			sectorMs[i] = parseTimeMs(st?.BestSectors?.[i]?.Value);
		}

		// Fallback to TimingData sector values if needed.
		if (timingData?.Lines?.[fastestNr]) {
			const td = timingData.Lines[fastestNr];
			for (let i = 0; i < 3; i++) {
				if (sectorMs[i] !== null) continue;
				sectorMs[i] = parseTimeMs(td.Sectors?.[i]?.Value) ?? parseTimeMs(td.Sectors?.[i]?.PreviousValue);
			}
		}

		if (sectorMs.some((v) => v === null)) return null;

		return {
			lapMs: fastestLapMs,
			sectorMs: sectorMs as [number, number, number],
		};
	}, [timingData, timingStats]);

	const dynamicApplied = dynamicSize && !!fastestLapProfile;
	const estimatedTone = classifyEstimatedLap(
		lapEstimate.ms,
		parseTimeMs(selectedBestLap),
		fastestLapProfile?.lapMs ?? null,
	);
	const centerSecondaryValue = showEstimatedLap
		? (lapEstimate.ms !== null ? formatLapTimeMs(lapEstimate.ms) : null)
		: selectedBestLap;
	const centerSecondaryClassName = showEstimatedLap
		? estimatedLapFill(estimatedTone)
		: clsx({
				"fill-violet-600": selectedBestPosition === 1,
				"fill-emerald-500": selectedBestPosition !== 1 && !!centerSecondaryValue,
				"fill-zinc-500": !centerSecondaryValue,
			});

	const segmentAngles = useMemo(() => {
		if (!dynamicApplied || !fastestLapProfile) {
			return new Array(totalSegments).fill(fallbackSegAngle) as number[];
		}

		const lapMs = fastestLapProfile.lapMs;
		const [s1, s2, s3] = fastestLapProfile.sectorMs;
		const sum = s1 + s2 + s3;
		if (!Number.isFinite(lapMs) || lapMs <= 0 || !Number.isFinite(sum) || sum <= 0) {
			return new Array(totalSegments).fill(fallbackSegAngle) as number[];
		}

		const scale = lapMs / sum;
		const sectorScaled = [s1 * scale, s2 * scale, s3 * scale];

		const out: number[] = [];
		for (let i = 0; i < sectors.length; i++) {
			const segCount = asArray(sectors[i]?.Segments).length;
			if (segCount <= 0) continue;

			const secMs = sectorScaled[i] ?? sectorScaled[sectorScaled.length - 1] ?? 0;
			const perSegMs = secMs / segCount;
			for (let j = 0; j < segCount; j++) {
				out.push((perSegMs / lapMs) * TAU);
			}
		}

		if (out.length !== totalSegments) {
			return new Array(totalSegments).fill(fallbackSegAngle) as number[];
		}

		const sumAngles = out.reduce((a, b) => a + b, 0);
		if (!Number.isFinite(sumAngles) || sumAngles <= 0) {
			return new Array(totalSegments).fill(fallbackSegAngle) as number[];
		}

		const k = TAU / sumAngles;
		return out.map((a) => a * k);
	}, [dynamicApplied, fallbackSegAngle, fastestLapProfile, sectors, totalSegments]);

	const segmentStartAngles = useMemo(() => {
		const starts = new Array(totalSegments) as number[];
		let a = startAngle;
		for (let i = 0; i < totalSegments; i++) {
			starts[i] = a;
			a += segmentAngles[i] ?? fallbackSegAngle;
		}
		return starts;
	}, [fallbackSegAngle, segmentAngles, startAngle, totalSegments]);

	const angleCenter = (idx: number) => {
		const s = segmentStartAngles[idx] ?? startAngle;
		const w = segmentAngles[idx] ?? fallbackSegAngle;
		return s + w / 2;
	};

	const lerpAngle = (fracIdx: number) => {
		const i0 = Math.floor(fracIdx) % totalSegments;
		const i1 = (Math.floor(fracIdx) + 1) % totalSegments;
		const t = fracIdx - Math.floor(fracIdx);
		const a0 = angleCenter(i0);
		const a1 = angleCenter(i1);
		let diff = a1 - a0;
		if (diff > Math.PI) diff -= TAU;
		if (diff < -Math.PI) diff += TAU;
		return a0 + diff * t;
	};

	const boundaryAngles = useMemo(() => {
		return ranges
			.slice(1)
			.map((sr) => segmentStartAngles[sr.start] ?? (startAngle + (sr.start / totalSegments) * TAU));
	}, [ranges, segmentStartAngles, startAngle, totalSegments]);

	const compareDrivers = useMemo(() => {
		if (!timingData?.Lines || !drivers || !selectedNr) return [];

		const list = Object.values(timingData.Lines)
			.filter((d) => d.RacingNumber !== selectedNr)
			.sort(sortPos)
			.map((d) => {
				const info = drivers[d.RacingNumber];
				if (!info) return null;

				const othTotal = countSegments(d.Sectors ?? []);
				const othIdx = currentSegmentIndex(d.Sectors ?? []);
				const smoothedOth = smooth?.enabled ? smooth.getSmoothedIndex(d.RacingNumber) : null;
				const othIdxBase =
					smoothedOth !== null
						? mapSmoothedToBase(smoothedOth, Math.max(othTotal, 1), totalSegments)
						: mapIndex(othIdx, Math.max(othTotal, 1), totalSegments);

				const fill = compareColor(selectedTiming, selectedIdxBase, d, othIdxBase, totalSegments);

				return {
					nr: d.RacingNumber,
					tla: info.Tla,
					teamColor: info.TeamColour,
					timing: d,
					idxBase: othIdxBase,
					fill,
					stroke: fillToStroke(fill),
				};
			})
			.filter(Boolean) as {
			nr: string;
			tla: string;
			teamColor: string;
			timing: TimingDataDriver;
			idxBase: number;
			fill: string;
			stroke: string;
		}[];

		return list;
	}, [drivers, selectedIdxBase, selectedNr, selectedTiming, smooth, timingData, totalSegments]);

	const pitMs = Math.max(0, pitstopSec) * 1000;

	const pitArc = (timingDriver: TimingDataDriver | null, startIdx: number) => {
		if (!timingDriver || pitMs <= 0) return null;
		let sum = 0;
		let idx = startIdx;
		let steps = 0;

		while (sum < pitMs && steps < totalSegments) {
			idx = (idx - 1 + totalSegments) % totalSegments;
			sum += estimateMiniTimeMs(timingDriver, idx, totalSegments);
			steps++;
		}

		if (steps <= 0) return null;
		return { startIdx, endIdx: idx };
	};

	const selectedPit = pitstopAnalysis ? pitArc(selectedTiming, Math.round(selectedIdxBase)) : null;
	// Pit position for interval line: always show gray line when we have pit data
	const selectedPitForInterval = pitArc(selectedTiming, Math.round(selectedIdxBase));

	const selectedPitArcColor = useMemo((): "green" | "orange" | "red" | null => {
		if (!pitstopAnalysis || !selectedPit || !timingData?.Lines || !selectedTiming) return null;
		const pos = Number.parseInt(selectedTiming.Position, 10);
		if (!Number.isFinite(pos)) return null;
		const driverBehind = Object.values(timingData.Lines).find(
			(d) => Number.parseInt(d.Position, 10) === pos + 1,
		);
		const gapSec = parseGapToSeconds(driverBehind?.IntervalToPositionAhead?.Value);
		if (gapSec === null) return null;
		const p = Math.max(0, pitstopSec);
		if (gapSec > p + 4) return "green";
		if (gapSec >= p - 4) return "orange";
		return "red";
	}, [pitstopAnalysis, selectedPit, timingData?.Lines, selectedTiming, pitstopSec]);

	const othersPit = pitstopAnalysis
		? compareDrivers.map((d) => ({
				nr: d.nr,
				teamColor: d.teamColor,
				arc: pitArc(d.timing, Math.round(d.idxBase)),
			}))
		: [];

	// In FP/Quali, hide drivers in pits (except selected, to keep a center)
	const hidePitDrivers = useMemo(() => {
		const t = sessionInfo?.Type ?? sessionInfo?.Name ?? "";
		const lower = String(t).toLowerCase();
		return lower.includes("practice") || lower.includes("qualifying");
	}, [sessionInfo]);

	// Interval analysis: all drivers on a line, selected at center
	const intervalLineDrivers = useMemo(() => {
		if (!timingData?.Lines || !drivers || !selectedNr) return [];

		const all = Object.values(timingData.Lines)
			.filter((d) => {
				if (!hidePitDrivers) return true;
				if (d.RacingNumber === selectedNr) return true; // always show selected
				return !d.InPit;
			})
			.map((d) => {
				const info = drivers[d.RacingNumber];
				if (!info) return null;

				const othTotal = countSegments(d.Sectors ?? []);
				const othIdx = currentSegmentIndex(d.Sectors ?? []);
				const smoothedOth =
					d.RacingNumber === selectedNr || !smooth?.enabled ? null : smooth.getSmoothedIndex(d.RacingNumber);
				const othIdxBase =
					d.RacingNumber === selectedNr
						? selectedIdxBase
						: smoothedOth !== null
							? mapSmoothedToBase(smoothedOth, Math.max(othTotal, 1), totalSegments)
							: mapIndex(othIdx, Math.max(othTotal, 1), totalSegments);
				const delta = signedSegmentDelta(othIdxBase, selectedIdxBase, totalSegments);
				const fill =
					d.RacingNumber === selectedNr
						? "selected"
						: compareColor(selectedTiming, selectedIdxBase, d, othIdxBase, totalSegments);

				return {
					nr: d.RacingNumber,
					tla: info.Tla,
					teamColor: info.TeamColour,
					delta,
					fill,
					stroke: d.RacingNumber === selectedNr ? "stroke-white" : fillToStroke(fill),
					arc: pitstopAnalysis ? pitArc(d, Math.round(othIdxBase)) : null,
				};
			})
			.filter(Boolean) as {
			nr: string;
			tla: string;
			teamColor: string;
			delta: number;
			fill: string;
			stroke: string;
			arc: { startIdx: number; endIdx: number } | null;
		}[];

		return all;
	}, [
		compareDrivers,
		drivers,
		hidePitDrivers,
		pitstopAnalysis,
		selectedIdxBase,
		selectedNr,
		selectedTiming,
		timingData,
		totalSegments,
	]);

	// Pit line position (selected driver's pit entry) in segment-delta space - always show when we have pit data
	const pitLineDelta = useMemo(() => {
		if (!selectedPitForInterval || !Number.isFinite(selectedIdxBase)) return null;
		return signedSegmentDelta(selectedPitForInterval.endIdx, selectedIdxBase, totalSegments);
	}, [selectedPitForInterval, selectedIdxBase, totalSegments]);

	return (
		<div className="flex h-full w-full min-h-0 flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
			<div className="flex items-center justify-between gap-3">
				<div className="text-sm font-medium text-white">Track circle</div>

				<div className="flex items-center gap-3">
					<label
						className={clsx(
							"flex items-center gap-2 text-xs text-zinc-400",
							dynamicSize && !fastestLapProfile && "opacity-60",
						)}
						title={!fastestLapProfile ? "No fastest lap recorded yet (falls back to fixed sizing)." : undefined}
					>
						<input type="checkbox" checked={dynamicSize} onChange={(e) => setDynamicSize(e.target.checked)} />
						<span>Dynamic size</span>
					</label>

					{driverLabel && <div className="text-xs text-zinc-400">{driverLabel}</div>}
				</div>
			</div>

			<div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
				{/* primary circle: minisectors + sector times */}
				<div className="flex min-h-0 flex-col rounded-lg border border-zinc-800 bg-zinc-950 p-2">
					<div className="mb-2 flex items-center justify-between gap-2">
						<div className="text-xs font-medium text-zinc-300">Sectors</div>
						{/* Data-coverage legend */}
						<div className="flex items-center gap-2 text-xs text-zinc-500">
							<span className="flex items-center gap-1">
								<span className="inline-block h-1.5 w-3 rounded-sm bg-emerald-500" />
								Live
							</span>
							<span className="flex items-center gap-1">
								<span className="inline-block h-1.5 w-3 rounded-sm bg-sky-500" />
								Paced
							</span>
							<span className="flex items-center gap-1">
								<span className="inline-block h-1.5 w-3 rounded-sm bg-amber-400" />
								Prev lap
							</span>
							<span className="flex items-center gap-1">
								<span className="inline-block h-1.5 w-3 rounded-sm bg-zinc-600" />
								Ref only
							</span>
							{lapEstimate.calibrated && (
								<span className="flex items-center gap-1 text-violet-400">
									✦ calibrated
								</span>
							)}
						</div>
					</div>

					<div className="min-h-0 flex-1">
						<svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full">
							<circle cx={cx} cy={cy} r={r} className="stroke-zinc-800" strokeWidth={18} fill="transparent" />

							{sectors.flatMap((sector, sectorIndex) =>
								asArray(sector.Segments).map((seg, j) => {
									const idx = ranges[sectorIndex].start + j;
									const segStart = segmentStartAngles[idx] ?? startAngle + idx * fallbackSegAngle;
									const segW = segmentAngles[idx] ?? fallbackSegAngle;
									const pad = segW * 0.06;
									const a0 = segStart + pad;
									const a1 = segStart + segW - pad;
									if (a1 <= a0) return null;

									return (
										<path
											key={`trackcircle.seg.${sectorIndex}.${j}`}
											d={arcPath(cx, cy, r, a0, a1, true)}
											className={miniSectorStroke(seg.Status)}
											strokeWidth={10}
											strokeLinecap="butt"
											fill="transparent"
										/>
									);
								}),
							)}

							{boundaryAngles.map((a, i) => {
								const p0 = polar(cx, cy, r - 14, a);
								const p1 = polar(cx, cy, r + 14, a);
								return (
									<line
										key={`trackcircle.boundary.${i}`}
										x1={p0.x}
										y1={p0.y}
										x2={p1.x}
										y2={p1.y}
										className="stroke-zinc-500"
										strokeWidth={2}
									/>
								);
							})}

							{/* Data-coverage ring — one arc per sector, coloured by quality source */}
							{ranges.map((sr) => {
								const segStart = segmentStartAngles[sr.start] ?? startAngle;
								const lastIdx = Math.max(sr.start, sr.end - 1);
								const segEnd =
									(segmentStartAngles[lastIdx] ?? startAngle) + (segmentAngles[lastIdx] ?? fallbackSegAngle);
								const pad = (segEnd - segStart) * 0.05;
								const a0 = segStart + pad;
								const a1 = segEnd - pad;
								if (a1 <= a0) return null;
								const q = sectorQuality[sr.sectorIndex] ?? "none";
								return (
									<path
										key={`coverage.${sr.sectorIndex}`}
										d={arcPath(cx, cy, r - 28, a0, a1, true)}
										className={qualityStroke(q)}
										strokeWidth={5}
										strokeLinecap="butt"
										fill="transparent"
									/>
								);
							})}

							{ranges.map((sr) => {
								const start = segmentStartAngles[sr.start] ?? startAngle;
								const lastIdx = Math.max(sr.start, sr.end - 1);
								const end = (segmentStartAngles[lastIdx] ?? startAngle) + (segmentAngles[lastIdx] ?? fallbackSegAngle);
								const a = (start + end) / 2;
								const labelR = r + 32;
								const p = polar(cx, cy, labelR, a);
								const n = sr.sectorIndex + 1;
								const t = sectorTimeLabel(sectors[sr.sectorIndex]);

								return (
									<g key={`trackcircle.label.${n}`}>
										<circle cx={p.x} cy={p.y} r={3} className="fill-zinc-500" />
										<text
											x={p.x}
											y={p.y - 8}
											textAnchor="middle"
											className="fill-zinc-400"
											fontSize={10}
											fontWeight={600}
										>
											{`S${n}`}
										</text>
										<text
											x={p.x}
											y={p.y + 12}
											textAnchor="middle"
											className="fill-white"
											fontSize={12}
											fontWeight={700}
										>
											{t}
										</text>
									</g>
								);
							})}

						{/* Center: driver TLA + last lap + estimated lap */}
						<text x={cx} y={cy - 14} textAnchor="middle" className="fill-white" fontSize={18} fontWeight={800}>
							{driverLabel ?? ""}
						</text>
						{selectedTiming?.LastLapTime?.Value && (
							<text x={cx} y={cy + 4} textAnchor="middle" className="fill-zinc-300" fontSize={11} fontWeight={600}>
								{selectedTiming.LastLapTime.Value}
							</text>
						)}
						{centerSecondaryValue && (
							<text
								x={cx}
								y={cy + 18}
								textAnchor="middle"
								className={centerSecondaryClassName}
								fontSize={11}
								fontWeight={600}
								fontStyle={showEstimatedLap ? "italic" : undefined}
							>
								{centerSecondaryValue}
							</text>
						)}
						</svg>
					</div>
				</div>

				{/* secondary circle: other drivers + pitstop analysis */}
				<div className="flex min-h-0 flex-col rounded-lg border border-zinc-800 bg-zinc-950 p-2">
					<div className="mb-2 flex items-center justify-between gap-2">
						<div className="text-xs font-medium text-zinc-300">Compare</div>

						<div className="flex items-center gap-3 text-xs text-zinc-400">
							<label className="flex items-center gap-1">
								<span>Pit (s)</span>
								<input
									className="w-16 rounded-md bg-zinc-900 px-2 py-1 text-xs text-white [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
									type="number"
									step={0.1}
									min={0}
									value={Number.isFinite(pitstopSec) ? pitstopSec : 0}
									onChange={(e) => setPitstopSec(Number.parseFloat(e.target.value))}
								/>
							</label>

							<label className="flex items-center gap-2">
								<input
									type="checkbox"
									checked={pitstopAnalysis}
									onChange={(e) => setPitstopAnalysis(e.target.checked)}
								/>
								<span>Pitstop analysis</span>
							</label>
						</div>
					</div>

					<div className="min-h-0 flex-1">
						<svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full">
							<circle cx={cx} cy={cy} r={r} className="stroke-zinc-800" strokeWidth={18} fill="transparent" />

							{/* selected driver minisectors */}
							{sectors.flatMap((sector, sectorIndex) =>
								asArray(sector.Segments).map((seg, j) => {
									const idx = ranges[sectorIndex].start + j;
									const segStart = segmentStartAngles[idx] ?? startAngle + idx * fallbackSegAngle;
									const segW = segmentAngles[idx] ?? fallbackSegAngle;
									const pad = segW * 0.06;
									const a0 = segStart + pad;
									const a1 = segStart + segW - pad;
									if (a1 <= a0) return null;

									return (
										<path
											key={`trackcircle.compare.seg.${sectorIndex}.${j}`}
											d={arcPath(cx, cy, r, a0, a1, true)}
											className={miniSectorStroke(seg.Status)}
											strokeWidth={10}
											strokeLinecap="butt"
											fill="transparent"
											style={{ opacity: 0.7 }}
										/>
									);
								}),
							)}

							{/* selected driver position marker */}
							{Number.isFinite(selectedIdxBase) && (() => {
								const angle = lerpAngle(selectedIdxBase);
								const sp = polar(cx, cy, r, angle);
								return (
									<g
										style={{
											transform: `translate(${sp.x}px, ${sp.y}px)`,
											...(smooth?.enabled ? {} : { transition: "transform 400ms ease-out" }),
										}}
									>
										<circle cx={0} cy={0} r={7} fill="transparent" stroke="white" strokeWidth={2} />
										<circle cx={0} cy={0} r={3} className="fill-white" />
									</g>
								);
							})()}

							{/* pitstop arcs */}
							{selectedPit && (
								<path
									d={arcPath(
										cx,
										cy,
										r - 26,
										angleCenter(selectedPit.startIdx),
										angleCenter(selectedPit.endIdx),
										false,
									)}
									className={clsx(
										selectedPitArcColor === "green" && "stroke-emerald-500",
										selectedPitArcColor === "orange" && "stroke-amber-400",
										selectedPitArcColor === "red" && "stroke-red-500",
										!selectedPitArcColor && "stroke-sky-400",
									)}
									strokeWidth={10}
									strokeLinecap="round"
									fill="transparent"
									style={{
										opacity: 0.7,
										...(selectedPitArcColor ? {} : selectedTeamColor ? { stroke: `#${selectedTeamColor}` } : {}),
									}}
								/>
							)}

							{othersPit
								.filter((p) => p.arc)
								.map((p) => (
									<path
										key={`trackcircle.pit.${p.nr}`}
										d={arcPath(
											cx,
											cy,
											r + 22,
											angleCenter(p.arc!.startIdx),
											angleCenter(p.arc!.endIdx),
											false,
										)}
										className="stroke-zinc-600"
										strokeWidth={6}
										strokeLinecap="round"
										fill="transparent"
										style={{
											opacity: 0.35,
											...(p.teamColor ? { stroke: `#${p.teamColor}` } : {}),
										}}
									/>
								))}

							{/* sector boundary tick marks */}
							{boundaryAngles.map((a, i) => {
								const p0 = polar(cx, cy, r - 14, a);
								const p1 = polar(cx, cy, r + 14, a);
								return (
									<line
										key={`compare.boundary.${i}`}
										x1={p0.x}
										y1={p0.y}
										x2={p1.x}
										y2={p1.y}
										className="stroke-zinc-500"
										strokeWidth={2}
									/>
								);
							})}

							{/* sector labels (inside ring to avoid driver dot collision) */}
							{ranges.map((sr) => {
								const start = segmentStartAngles[sr.start] ?? startAngle;
								const lastIdx = Math.max(sr.start, sr.end - 1);
								const end = (segmentStartAngles[lastIdx] ?? startAngle) + (segmentAngles[lastIdx] ?? fallbackSegAngle);
								const a = (start + end) / 2;
								const labelR = r - 45;
								const p = polar(cx, cy, labelR, a);
								const n = sr.sectorIndex + 1;
								const t = sectorTimeLabel(sectors[sr.sectorIndex]);
								return (
									<g key={`compare.label.${n}`}>
										<circle cx={p.x} cy={p.y} r={3} className="fill-zinc-500" />
										<text
											x={p.x}
											y={p.y - 8}
											textAnchor="middle"
											className="fill-zinc-400"
											fontSize={10}
											fontWeight={600}
										>
											{`S${n}`}
										</text>
										<text
											x={p.x}
											y={p.y + 12}
											textAnchor="middle"
											className="fill-white"
											fontSize={12}
											fontWeight={700}
										>
											{t}
										</text>
									</g>
								);
							})}

							{/* other drivers markers */}
							{compareDrivers.map((d) => {
								const a = lerpAngle(d.idxBase);
								const p = polar(cx, cy, r + 38, a);
								const fillStyle = d.teamColor ? { fill: `#${d.teamColor}` } : undefined;
								const isFavorite = favoriteDrivers.includes(d.nr);
								return (
									<g
										key={`trackcircle.driver.${d.nr}`}
										style={{
											transform: `translate(${p.x}px, ${p.y}px)`,
											...(smooth?.enabled ? {} : { transition: "transform 400ms ease-out" }),
										}}
									>
										{isFavorite && (
											<circle cx={0} cy={0} r={16} className="stroke-sky-400" strokeWidth={3} fill="transparent" />
										)}
										<circle
											cx={0}
											cy={0}
											r={10}
											className={clsx(!d.teamColor && "fill-zinc-600")}
											style={fillStyle}
											stroke="#0a0a0a"
											strokeWidth={2}
										/>
										<circle cx={0} cy={0} r={13} className={d.stroke} strokeWidth={3} fill="transparent" />
										<text x={0} y={3} textAnchor="middle" className="fill-white" fontSize={9} fontWeight={800}>
											{d.tla}
										</text>
									</g>
								);
							})}

							<text x={cx} y={cy} textAnchor="middle" className="fill-white" fontSize={18} fontWeight={800}>
								{driverLabel ?? ""}
							</text>
						</svg>
					</div>
				</div>
			</div>

			<div
				onPointerDown={startResizeInterval}
				className="group flex h-3 shrink-0 cursor-row-resize items-center justify-center hover:bg-white/5"
				title="Drag to resize interval analysis"
			>
				<div className="h-1 w-12 rounded-full bg-zinc-800 group-hover:bg-zinc-600" />
			</div>

			{/* Interval analysis: straight line with drivers, selected centered */}
			<div className="flex shrink-0 flex-col rounded-lg border border-zinc-800 bg-zinc-950 p-2" style={{ height: intervalHeight }}>
				<div className="mb-2 flex flex-wrap items-center justify-between gap-3">
					<div className="flex items-center gap-2">
						<span className="text-xs font-medium text-zinc-300">Interval analysis</span>
						{selectedNr && onSelectDriver && (
							<button
								type="button"
								onClick={() => onSelectDriver(null)}
								className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
							>
								Unselect driver
							</button>
						)}
					</div>
					<div className="flex flex-wrap items-center gap-4 text-xs text-zinc-400">
						<label className="flex items-center gap-2">
							<span className="min-w-[4rem]">Driver size</span>
							<input
								type="range"
								min={DRIVER_SIZE_MIN}
								max={DRIVER_SIZE_MAX}
								value={intervalDriverSize}
								onChange={(e) => setIntervalDriverSize(Number.parseFloat(e.target.value))}
								className="h-1.5 w-20 cursor-pointer appearance-none rounded-lg bg-zinc-700 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-zinc-400"
							/>
							<span className="w-6 text-right tabular-nums">{intervalDriverSize}</span>
						</label>
						<label className="flex items-center gap-2">
							<span className="min-w-[4rem]">Line coverage</span>
							<input
								type="range"
								min={LINE_COVERAGE_MIN}
								max={LINE_COVERAGE_MAX}
								step={0.05}
								value={intervalLineCoverage}
								onChange={(e) => setIntervalLineCoverage(Number.parseFloat(e.target.value))}
								className="h-1.5 w-20 cursor-pointer appearance-none rounded-lg bg-zinc-700 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-zinc-400"
							/>
							<span className="w-8 text-right tabular-nums">{intervalLineCoverage.toFixed(1)}×</span>
						</label>
					</div>
				</div>
				<div
					ref={intervalViewportRef}
					className="relative flex h-[72px] w-full shrink-0 items-center overflow-hidden"
				>
					<IntervalAnalysisLine
						drivers={intervalLineDrivers}
						selectedNr={selectedNr}
						favoriteDrivers={favoriteDrivers}
						smoothEnabled={smooth?.enabled ?? false}
						pitLineDelta={pitLineDelta}
						pitstopAnalysis={pitstopAnalysis}
						selectedPitArcColor={selectedPitArcColor}
						totalSegments={totalSegments}
						selectedIdxBase={selectedIdxBase}
						driverSize={intervalDriverSize}
						lineCoverage={intervalLineCoverage}
						viewportWidth={intervalViewportWidth}
						onSelectDriver={onSelectDriver}
					/>
				</div>
			</div>

			<div
				onPointerDown={startResizeTrackAnalysis}
				className="group flex h-3 shrink-0 cursor-row-resize items-center justify-center hover:bg-white/5"
				title="Drag to resize track analysis"
			>
				<div className="h-1 w-12 rounded-full bg-zinc-800 group-hover:bg-zinc-600" />
			</div>

			<div className="min-h-0 shrink-0" style={{ height: trackAnalysisHeight }}>
				<TrackOverview
					selectedNr={selectedNr}
					totalSegments={totalSegments}
					sectorEndSegments={[ranges[0]?.end ?? 0, ranges[1]?.end ?? 0]}
					getSmoothedIndex={smooth?.enabled ? smooth.getSmoothedIndex : null}
					smoothEnabled={smooth?.enabled ?? false}
					driverSize={intervalDriverSize}
					onSelectDriver={onSelectDriver}
				/>
			</div>
		</div>
	);
}

type IntervalAnalysisLineProps = {
	drivers: {
		nr: string;
		tla: string;
		teamColor: string;
		delta: number;
		fill: string;
		stroke: string;
		arc: { startIdx: number; endIdx: number } | null;
	}[];
	selectedNr: string | null;
	favoriteDrivers: string[];
	smoothEnabled?: boolean;
	pitLineDelta: number | null;
	pitstopAnalysis: boolean;
	selectedPitArcColor: "green" | "orange" | "red" | null;
	totalSegments: number;
	selectedIdxBase: number;
	driverSize: number;
	lineCoverage: number;
	viewportWidth: number;
	onSelectDriver?: (nr: string | null) => void;
};

function IntervalAnalysisLine({
	drivers,
	selectedNr,
	favoriteDrivers,
	smoothEnabled = false,
	pitLineDelta,
	pitstopAnalysis,
	selectedPitArcColor,
	totalSegments,
	selectedIdxBase,
	driverSize,
	lineCoverage,
	viewportWidth,
	onSelectDriver,
}: IntervalAnalysisLineProps) {
	const lineHeight = 36;
	const centerY = lineHeight / 2;
	const driverDotR = driverSize;
	const pad = Math.max(4, driverDotR + 4);
	const width = Math.max(320, Math.floor(viewportWidth) || 0);

	const maxDelta = Math.max(1, (totalSegments / 2) * lineCoverage);
	const halfUsable = Math.max(1, (width - pad * 2) / 2);
	const scale = halfUsable / maxDelta; // px per segment delta
	const centerX = width / 2;
	const toX = (delta: number) => clamp(centerX + delta * scale, pad, width - pad);

	return (
		<svg
			viewBox={`0 0 ${width} ${lineHeight + 24}`}
			className="h-full w-full"
			preserveAspectRatio="xMidYMid meet"
		>
			{/* Main track line */}
			<line
				x1={pad}
				y1={centerY}
				x2={width - pad}
				y2={centerY}
				className="stroke-zinc-700"
				strokeWidth={3}
				strokeLinecap="round"
			/>

			{/* Pit line (gray or colored when pitstop analysis) */}
			{pitLineDelta !== null && (
				<line
					x1={toX(pitLineDelta)}
					y1={0}
					x2={toX(pitLineDelta)}
					y2={lineHeight}
					className={clsx(
						pitstopAnalysis && selectedPitArcColor === "green" && "stroke-emerald-500",
						pitstopAnalysis && selectedPitArcColor === "orange" && "stroke-amber-400",
						pitstopAnalysis && selectedPitArcColor === "red" && "stroke-red-500",
						(!pitstopAnalysis || !selectedPitArcColor) && "stroke-zinc-500",
					)}
					strokeWidth={3}
					strokeDasharray="4 3"
					opacity={pitstopAnalysis ? 0.9 : 0.6}
				/>
			)}

			{/* Pitstop analysis: small ticks for other drivers' pit positions */}
			{pitstopAnalysis &&
				drivers
					.filter((d) => d.arc && d.nr !== selectedNr)
					.map((d) => {
						const pitDelta = signedSegmentDelta(d.arc!.endIdx, selectedIdxBase, totalSegments);
						const x = toX(pitDelta);
						return (
							<line
								key={`interval.pit.${d.nr}`}
								x1={x}
								y1={centerY - 8}
								x2={x}
								y2={centerY + 8}
								className="stroke-zinc-600"
								strokeWidth={1.5}
								opacity={0.5}
								style={d.teamColor ? { stroke: `#${d.teamColor}` } : undefined}
							/>
						);
					})}

			{/* Driver markers: team-color inner dot, compare-color outer ring, smooth CSS lerp */}
			{drivers.map((d) => {
				const x = toX(d.delta);
				const isSelected = d.nr === selectedNr;
				const isFavorite = favoriteDrivers.includes(d.nr);
				const fillStyle = d.teamColor ? { fill: `#${d.teamColor}` } : { fill: "#71717a" };
				const hitR = Math.max(driverDotR + 6, 18);
				const outerRingR = driverDotR + 3;
				const outerStroke = isSelected ? "stroke-white" : d.stroke;
				const textSize = Math.max(7, Math.round(driverDotR * 1.4));
				const handleClick = () => {
					if (onSelectDriver) onSelectDriver(isSelected ? null : d.nr);
				};
				return (
					<g
						key={`interval.${d.nr}`}
						onClick={handleClick}
						onKeyDown={(e) => e.key === "Enter" && handleClick()}
						role="button"
						tabIndex={0}
						className="cursor-pointer"
						style={{
							outline: "none",
							transform: `translateX(${x}px)`,
							...(smoothEnabled ? {} : { transition: "transform 400ms ease-out" }),
						}}
					>
						<circle cx={0} cy={centerY} r={hitR} fill="transparent" />
						{isFavorite && !isSelected && (
							<circle
								cx={0}
								cy={centerY}
								r={outerRingR + 4}
								className="stroke-sky-400"
								strokeWidth={2}
								fill="transparent"
							/>
						)}
						{/* Inner: team color */}
						<circle
							cx={0}
							cy={centerY}
							r={driverDotR}
							style={fillStyle}
							stroke="#0a0a0a"
							strokeWidth={1}
						/>
						{/* Outer ring: compare color (green/red) or white when selected */}
						<circle
							cx={0}
							cy={centerY}
							r={outerRingR}
							className={outerStroke}
							strokeWidth={isSelected ? 3 : 2}
							fill="transparent"
						/>
						<text
							x={0}
							y={centerY + outerRingR + 12}
							textAnchor="middle"
							className={clsx("fill-white", isSelected && "font-bold")}
							fontSize={textSize}
							fontWeight={isSelected ? 800 : 600}
						>
							{d.tla}
						</text>
					</g>
				);
			})}
		</svg>
	);
}

