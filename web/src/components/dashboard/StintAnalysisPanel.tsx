"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import type { DetectedStint, ReviewLap } from "@/types/review.type";
import { useDataStore } from "@/stores/useDataStore";

const MIN_STINT_LAPS = 3;
const DEFAULT_PIT_THRESHOLD_SEC = 60;

function formatLapTimeMs(ms: number): string {
	const s = ms / 1000;
	if (s >= 60) {
		const m = Math.floor(s / 60);
		const sec = (s % 60).toFixed(3);
		return `${m}:${sec.padStart(6, "0")}`;
	}
	return `${s.toFixed(3)}s`;
}

function median(arr: number[]): number {
	if (arr.length === 0) return 0;
	const sorted = [...arr].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function mean(arr: number[]): number {
	if (arr.length === 0) return 0;
	return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Tyre compound styling: same codes as elsewhere — Soft red, Medium yellow, Hard white, Rain blue, Intermediate light blue, unknown gray */
function compoundToTyreStyle(compound: string | null | undefined): { label: string; className: string } {
	const c = (compound ?? "").toUpperCase();
	switch (c) {
		case "SOFT":
			return { label: c, className: "border-red-500/40 bg-red-500/15 text-red-300" };
		case "MEDIUM":
			return { label: c, className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-200" };
		case "HARD":
			return { label: c, className: "border-zinc-200/40 bg-zinc-200/10 text-zinc-200" };
		case "WET":
			return { label: c, className: "border-blue-500/40 bg-blue-500/15 text-blue-300" };
		case "INTERMEDIATE":
			return { label: c, className: "border-sky-400/40 bg-sky-400/15 text-sky-300" };
		default:
			return { label: c || "—", className: "border-zinc-600 bg-zinc-700/30 text-zinc-400" };
	}
}

type StintSeries = {
	driverNr: number;
	stintIndex: number;
	stint: DetectedStint;
	label: string;
	color: string;
	dataKey: string;
	points: { lapIndex: number; lapNumber: number; lapTimeMs: number }[];
};

type StintSummary = {
	driverNr: number;
	stintIndex: number;
	label: string;
	color: string;
	teamName: string;
	compound: string;
	lapCount: number;
	totalStintTimeMs: number;
	bestLapMs: number;
	worstLapMs: number;
	meanLapMs: number;
};

type StintSortKey = "driver" | "team" | "tyre" | "laps" | "total" | "best" | "worst" | "mean";

type Props = {
	laps: ReviewLap[];
	stintsMap: Map<number, DetectedStint[]>;
	height?: number;
	selectedStintKeys: Set<string>;
	onToggleStint: (driverNr: number, stintIndex: number) => void;
	/** When true, session has ended so all stints are "completed" for discard-last-lap. */
	sessionEnded?: boolean;
};

export default function StintAnalysisPanel({
	laps: _laps,
	stintsMap,
	height = 400,
	selectedStintKeys,
	onToggleStint,
	sessionEnded = false,
}: Props) {
	const driversFromState = useDataStore((s) => s.state?.DriverList);

	const [minLaps, setMinLaps] = useState(MIN_STINT_LAPS);
	const [maxLaps, setMaxLaps] = useState<number | "">("");
	const [pitThresholdSec, setPitThresholdSec] = useState(DEFAULT_PIT_THRESHOLD_SEC);
	const [selectedDriverNrs, setSelectedDriverNrs] = useState<Set<number>>(new Set());
	const [stintSortKey, setStintSortKey] = useState<StintSortKey>("driver");
	const [stintSortAsc, setStintSortAsc] = useState(true);
	const [discardSlowerThanMedian, setDiscardSlowerThanMedian] = useState(false);
	const [discardSlowerThanMedianPct, setDiscardSlowerThanMedianPct] = useState(107);
	const [discardLastLapOfCompletedStints, setDiscardLastLapOfCompletedStints] = useState(false);
	const [driverPanelOpen, setDriverPanelOpen] = useState(false);
	const [legendPanelOpen, setLegendPanelOpen] = useState(false);
	const [onlyBestStintPerDriver, setOnlyBestStintPerDriver] = useState(false);
	const [benchmarkStintKey, setBenchmarkStintKey] = useState<string | null>(null);
	/** Graph Y-axis: absolute (lap time per lap) or aggregated (cumulative time) */
	const [graphTimeMode, setGraphTimeMode] = useState<"absolute" | "aggregated">("absolute");

	// Auto-select all drivers when stintsMap changes
	useEffect(() => {
		setSelectedDriverNrs(new Set(Array.from(stintsMap.keys()).map(Number)));
	}, [stintsMap]);

	const driverInfo = useCallback(
		(driverNr: number) => {
			const d = driversFromState?.[String(driverNr)];
			return {
				label: d?.Tla ?? `#${driverNr}`,
				color: d?.TeamColour ? `#${d.TeamColour}` : `hsl(${(driverNr * 37) % 360}, 70%, 50%)`,
				teamName: d?.TeamName ?? "—",
			};
		},
		[driversFromState],
	);

	const filteredStints = useMemo(() => {
		const max = typeof maxLaps === "number" && maxLaps > 0 ? maxLaps : undefined;
		const result: { driverNr: number; stint: DetectedStint; stintIndex: number }[] = [];
		stintsMap.forEach((list, key) => {
			const driverNr = Number(key);
			list.forEach((stint, stintIndex) => {
				const n = stint.lapCount;
				if (n >= minLaps && (max === undefined || n <= max)) {
					result.push({ driverNr, stint, stintIndex });
				}
			});
		});
		return result;
	}, [stintsMap, minLaps, maxLaps]);

	const selectedStints = useMemo(
		() => filteredStints.filter((s) => selectedDriverNrs.has(s.driverNr)),
		[filteredStints, selectedDriverNrs],
	);

	// When "only best stint per driver" is on, keep only the stint with the fastest best lap per driver
	const displayStints = useMemo(() => {
		if (!onlyBestStintPerDriver) return selectedStints;
		const byDriver = new Map<number, (typeof selectedStints)[number][]>();
		for (const s of selectedStints) {
			const list = byDriver.get(s.driverNr) ?? [];
			list.push(s);
			byDriver.set(s.driverNr, list);
		}
		const result: typeof selectedStints = [];
		byDriver.forEach((stints) => {
			let bestStint = stints[0];
			let bestMs = Infinity;
			for (const s of stints) {
				const laps = s.stint.countedLaps ?? s.stint.laps;
				const ms = laps
					.map((l) => l.lastLaptimeMs)
					.filter((m): m is number => m != null && m > 0);
				const minMs = ms.length > 0 ? Math.min(...ms) : Infinity;
				if (minMs < bestMs) {
					bestMs = minMs;
					bestStint = s;
				}
			}
			if (bestStint) result.push(bestStint);
		});
		return result;
	}, [selectedStints, onlyBestStintPerDriver]);

	// Which stints to paint in the chart (controlled by checklist in the stint list)
	const paintedStints = useMemo(
		() =>
			displayStints.filter((s) => selectedStintKeys.has(`${s.driverNr}-${s.stintIndex}`)),
		[displayStints, selectedStintKeys],
	);

	// For "discard last lap of completed stints": completed = not the driver's last stint, or last stint and session ended
	const lapsForStint = useCallback(
		(stint: DetectedStint, driverNr: number, stintIndex: number) => {
			let laps = stint.countedLaps ?? stint.laps;
			if (discardLastLapOfCompletedStints && laps.length > 1) {
				const list = stintsMap.get(driverNr) ?? [];
				const isLastStint = stintIndex === list.length - 1;
				const completed = !isLastStint || sessionEnded;
				if (completed) laps = laps.slice(0, -1);
			}
			return laps;
		},
		[discardLastLapOfCompletedStints, sessionEnded, stintsMap],
	);

	const chartSeries = useMemo((): StintSeries[] => {
		const rawSeries: StintSeries[] = paintedStints.map((s, i) => {
			const { label, color } = driverInfo(s.driverNr);
			const laps = lapsForStint(s.stint, s.driverNr, s.stintIndex);
			const lapsMs = laps
				.map((l) => l.lastLaptimeMs)
				.filter((ms): ms is number => ms != null && ms > 0);
			const med = lapsMs.length > 0 ? median(lapsMs) : 0;
			const thresholdMs =
				discardSlowerThanMedian && discardSlowerThanMedianPct > 0 ? med * (discardSlowerThanMedianPct / 100) : Infinity;
			const rawPoints = laps
				.filter(
					(lap) =>
						lap.lastLaptimeMs != null &&
						lap.lastLaptimeMs > 0 &&
						lap.lastLaptimeMs <= thresholdMs,
				)
				.map((lap, idx) => ({
					lapIndex: idx + 1,
					lapNumber: lap.lap,
					lapTimeMs: lap.lastLaptimeMs!,
				}));
			const points =
				graphTimeMode === "aggregated"
					? rawPoints.map((p, idx) => ({
							...p,
							lapTimeMs: rawPoints
								.slice(0, idx + 1)
								.reduce((sum, x) => sum + x.lapTimeMs, 0),
						}))
					: rawPoints.map((p) => ({ ...p }));
			return {
				driverNr: s.driverNr,
				stintIndex: s.stintIndex,
				stint: s.stint,
				label: `${label} S${s.stintIndex + 1}`,
				color,
				dataKey: `series_${i}`,
				points,
			};
		});
		if (benchmarkStintKey == null || rawSeries.length === 0) return rawSeries;
		const benchmarkIdx = paintedStints.findIndex(
			(s) => `${s.driverNr}-${s.stintIndex}` === benchmarkStintKey,
		);
		if (benchmarkIdx < 0) return rawSeries;
		const benchmarkMap = new Map(
			rawSeries[benchmarkIdx]!.points.map((p) => [p.lapIndex, p.lapTimeMs]),
		);
		return rawSeries.map((series) => ({
			...series,
			points: series.points.map((p) => ({
				...p,
				lapTimeMs: p.lapTimeMs - (benchmarkMap.get(p.lapIndex) ?? 0),
			})),
		}));
	}, [paintedStints, driverInfo, discardSlowerThanMedian, discardSlowerThanMedianPct, graphTimeMode, benchmarkStintKey, lapsForStint]);

	const chartData = useMemo(() => {
		const byLapIndex = new Map<number, Record<string, number | string>>();
		chartSeries.forEach((series, i) => {
			series.points.forEach((p) => {
				let row = byLapIndex.get(p.lapIndex);
				if (!row) {
					row = { lapIndex: p.lapIndex };
					byLapIndex.set(p.lapIndex, row);
				}
				(row as Record<string, number>)[`series_${i}`] = p.lapTimeMs / 1000;
			});
		});
		return Array.from(byLapIndex.entries())
			.sort((a, b) => a[0] - b[0])
			.map(([, row]) => row);
	}, [chartSeries]);

	// One row per stint (matches the graph lines); includes lap count. Apply discard-slower-than-median and discard-last-lap when enabled.
	const stintSummaries = useMemo((): StintSummary[] => {
		return displayStints.map(({ driverNr, stint, stintIndex }) => {
			const { label, color, teamName } = driverInfo(driverNr);
			const lapsUsed = lapsForStint(stint, driverNr, stintIndex);
			let lapsMs = lapsUsed
				.map((l) => l.lastLaptimeMs)
				.filter((ms): ms is number => ms != null && ms > 0);
			if (discardSlowerThanMedian && discardSlowerThanMedianPct > 0 && lapsMs.length > 0) {
				const med = median(lapsMs);
				const thresholdMs = med * (discardSlowerThanMedianPct / 100);
				lapsMs = lapsMs.filter((ms) => ms <= thresholdMs);
			}
			const totalStintTimeMs = lapsMs.reduce((a, b) => a + b, 0);
			const bestLapMs = lapsMs.length > 0 ? Math.min(...lapsMs) : 0;
			const worstLapMs = lapsMs.length > 0 ? Math.max(...lapsMs) : 0;
			const meanLapMs = mean(lapsMs);
			return {
				driverNr,
				stintIndex,
				label,
				color,
				teamName,
				compound: stint.compound ?? "—",
				lapCount: lapsMs.length,
				totalStintTimeMs,
				bestLapMs,
				worstLapMs,
				meanLapMs,
			};
		});
	}, [displayStints, driverInfo, discardSlowerThanMedian, discardSlowerThanMedianPct, lapsForStint]);

	const benchmarkRow = useMemo(
		() =>
			benchmarkStintKey != null
				? stintSummaries.find((r) => `${r.driverNr}-${r.stintIndex}` === benchmarkStintKey) ?? null
				: null,
		[stintSummaries, benchmarkStintKey],
	);

	const sortedStintSummaries = useMemo(() => {
		const sorted = [...stintSummaries];
		const mult = stintSortAsc ? 1 : -1;
		sorted.sort((a, b) => {
			switch (stintSortKey) {
				case "driver":
					return mult * (a.label.localeCompare(b.label) || a.stintIndex - b.stintIndex);
			case "team":
				return mult * (a.teamName.localeCompare(b.teamName) || a.label.localeCompare(b.label) || a.stintIndex - b.stintIndex);
				case "tyre":
					return mult * (a.compound.localeCompare(b.compound) || a.driverNr - b.driverNr || a.stintIndex - b.stintIndex);
				case "laps":
					return mult * (a.lapCount - b.lapCount || a.driverNr - b.driverNr || a.stintIndex - b.stintIndex);
				case "total":
					return mult * (a.totalStintTimeMs - b.totalStintTimeMs);
				case "best":
					return mult * (a.bestLapMs - b.bestLapMs);
				case "worst":
					return mult * (a.worstLapMs - b.worstLapMs);
				case "mean":
					return mult * (a.meanLapMs - b.meanLapMs);
				default:
					return 0;
			}
		});
		return sorted;
	}, [stintSummaries, stintSortKey, stintSortAsc]);

	const toggleStintSort = useCallback((key: StintSortKey) => {
		setStintSortKey((prev) => {
			if (prev === key) {
				setStintSortAsc((a) => !a);
				return prev;
			}
			setStintSortAsc(true);
			return key;
		});
	}, []);

	const allDriverNrs = useMemo(
		() =>
			Array.from(stintsMap.keys())
				.map((k) => Number(k))
				.sort((a, b) => a - b),
		[stintsMap],
	);

	const hasData = stintsMap.size > 0;

	const toggleDriver = (driverNr: number) => {
		setSelectedDriverNrs((prev) => {
			const next = new Set(prev);
			if (next.has(driverNr)) next.delete(driverNr);
			else next.add(driverNr);
			return next;
		});
	};

	const selectAll = () => setSelectedDriverNrs(new Set(allDriverNrs));
	const selectNone = () => setSelectedDriverNrs(new Set());

	if (!hasData) {
		return (
			<div className="flex h-full items-center justify-center text-xs text-zinc-500">
				No stint data — select a session above.
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col gap-3 overflow-hidden">
			{/* Config */}
			<div className="flex flex-wrap items-center gap-4 text-xs">
				<label className="flex items-center gap-2">
					<span className="text-zinc-500">Min laps</span>
					<input
						type="number"
						min={1}
						value={minLaps}
						onChange={(e) => setMinLaps(Number(e.target.value) || MIN_STINT_LAPS)}
						className="w-14 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-white"
					/>
				</label>
				<label className="flex items-center gap-2">
					<span className="text-zinc-500">Max laps</span>
					<input
						type="number"
						min={1}
						placeholder="All"
						value={maxLaps === "" ? "" : maxLaps}
						onChange={(e) =>
							setMaxLaps(e.target.value === "" ? "" : Number(e.target.value) || 0)
						}
						className="w-14 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-white"
					/>
				</label>
				<label className="flex items-center gap-2">
					<span className="text-zinc-500">Pit threshold (s)</span>
					<input
						type="number"
						min={0}
						step={5}
						value={pitThresholdSec}
						onChange={(e) => setPitThresholdSec(Number(e.target.value) || 0)}
						className="w-14 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-white"
					/>
				</label>
				<label className="flex cursor-pointer items-center gap-2">
					<input
						type="checkbox"
						checked={discardSlowerThanMedian}
						onChange={(e) => setDiscardSlowerThanMedian(e.target.checked)}
						className="rounded border-zinc-600"
					/>
					<span className="text-zinc-500">Discard laps &gt;</span>
					<input
						type="number"
						min={100}
						max={200}
						step={1}
						value={discardSlowerThanMedianPct}
						onChange={(e) => setDiscardSlowerThanMedianPct(Number(e.target.value) || 100)}
						className="w-12 rounded border border-zinc-700 bg-zinc-900 px-1 py-1 text-white"
						disabled={!discardSlowerThanMedian}
					/>
					<span className="text-zinc-500">% of median</span>
				</label>
				<label className="flex cursor-pointer items-center gap-2">
					<input
						type="checkbox"
						checked={onlyBestStintPerDriver}
						onChange={(e) => setOnlyBestStintPerDriver(e.target.checked)}
						className="rounded border-zinc-600"
					/>
					<span className="text-zinc-500">Only best stint per driver</span>
				</label>
				<label className="flex cursor-pointer items-center gap-2" title="Exclude the last lap of each completed stint (not the current/live stint) from graph and stats">
					<input
						type="checkbox"
						checked={discardLastLapOfCompletedStints}
						onChange={(e) => setDiscardLastLapOfCompletedStints(e.target.checked)}
						className="rounded border-zinc-600"
					/>
					<span className="text-zinc-500">Exclude last lap of completed stints</span>
				</label>
				<span className="text-zinc-500">Graph:</span>
				<label className="flex cursor-pointer items-center gap-1.5">
					<input
						type="radio"
						name="graph-time-mode"
						checked={graphTimeMode === "absolute"}
						onChange={() => setGraphTimeMode("absolute")}
						className="rounded-full border-zinc-600"
					/>
					<span className="text-zinc-400">Absolute times</span>
				</label>
				<label className="flex cursor-pointer items-center gap-1.5">
					<input
						type="radio"
						name="graph-time-mode"
						checked={graphTimeMode === "aggregated"}
						onChange={() => setGraphTimeMode("aggregated")}
						className="rounded-full border-zinc-600"
					/>
					<span className="text-zinc-400">Aggregated time</span>
				</label>
			</div>

			{/* Driver selection: foldable panel (default folded) */}
			<div className="shrink-0">
				<button
					type="button"
					onClick={() => setDriverPanelOpen((o) => !o)}
					className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200"
				>
					<span className="inline-block transition-transform" style={{ transform: driverPanelOpen ? "rotate(90deg)" : "none" }}>
						▶
					</span>
					<span>Drivers ({selectedDriverNrs.size}/{allDriverNrs.length})</span>
				</button>
				{driverPanelOpen && (
					<div className="mt-1.5 flex flex-wrap items-center gap-2 rounded border border-zinc-800 bg-zinc-900/50 p-2">
						<button
							type="button"
							onClick={selectAll}
							className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-white"
						>
							All
						</button>
						<button
							type="button"
							onClick={selectNone}
							className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-white"
						>
							None
						</button>
						{allDriverNrs.map((nr) => {
							const { label, color } = driverInfo(nr);
							const checked = selectedDriverNrs.has(nr);
							return (
								<label
									key={nr}
									className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-zinc-800"
								>
									<input
										type="checkbox"
										checked={checked}
										onChange={() => toggleDriver(nr)}
										className="rounded border-zinc-600"
									/>
									<span
										className="inline-block h-2 w-2 shrink-0 rounded-full"
										style={{ backgroundColor: color }}
									/>
									<span className="text-xs text-zinc-300">{label}</span>
								</label>
							);
						})}
					</div>
				)}
			</div>

			{/* Line chart: fixed min height; "?" opens floating legend */}
			<div style={{ height: Math.max(180, Math.min(320, height - 260)) }} className="relative min-h-[180px] w-full shrink-0">
				{chartData.length > 0 && chartSeries.length > 0 ? (
					<>
						<button
							type="button"
							onClick={() => setLegendPanelOpen((o) => !o)}
							className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-zinc-600 bg-zinc-800/90 text-xs font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white"
							title="Which line is who"
						>
							?
						</button>
						{legendPanelOpen && (
							<>
								<div
									className="absolute inset-0 z-10"
									aria-hidden
									onClick={() => setLegendPanelOpen(false)}
								/>
								<div className="absolute right-2 top-10 z-20 max-h-48 min-w-[140px] overflow-y-auto rounded border border-zinc-700 bg-zinc-900 py-2 shadow-lg">
									<p className="mb-1.5 px-2 text-[10px] font-medium text-zinc-500">Line = driver stint</p>
									{chartSeries.map((series) => (
										<div
											key={series.dataKey}
											className="flex items-center gap-2 px-2 py-0.5 text-xs text-zinc-200"
										>
											<span
												className="h-2 w-2 shrink-0 rounded-full"
												style={{ backgroundColor: series.color }}
											/>
											<span className="truncate">{series.label}</span>
										</div>
									))}
								</div>
							</>
						)}
						<ResponsiveContainer width="100%" height="100%">
							<LineChart data={chartData} margin={{ top: 8, right: 40, left: 8, bottom: 20 }}>
								<CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
								<XAxis
									dataKey="lapIndex"
									type="number"
									domain={["dataMin", "dataMax"]}
									tick={{ fill: "#a1a1aa", fontSize: 10 }}
									label={{ value: "Stint lap", position: "insideBottom", offset: -12, fill: "#71717a", fontSize: 10 }}
								/>
								<YAxis
									tickFormatter={(v) =>
										typeof v === "number" ? formatLapTimeMs(v * 1000) : ""
									}
									tick={{ fill: "#a1a1aa", fontSize: 10 }}
									domain={["auto", "auto"]}
									width={60}
									label={{
										value:
											benchmarkStintKey != null
												? graphTimeMode === "aggregated"
													? "Δ cumulative time"
													: "Δ lap time"
												: graphTimeMode === "aggregated"
													? "Cumulative time"
													: "Lap time",
										angle: -90,
										position: "insideLeft",
										fill: "#71717a",
										fontSize: 10,
										offset: 10,
									}}
								/>
								<Tooltip
									contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", fontSize: 11 }}
									labelFormatter={(_, payload) => {
										const p = payload?.[0]?.payload;
										return p
											? graphTimeMode === "aggregated"
												? `Stint lap ${Number(p.lapIndex)} (cumulative)`
												: `Stint lap ${Number(p.lapIndex)}`
											: "";
									}}
									formatter={(value: number, name: string) =>
										[formatLapTimeMs(value * 1000), name]
									}
								/>
								{chartSeries.map((series) => (
									<Line
										key={series.dataKey}
										type="monotone"
										dataKey={series.dataKey}
										name={series.label}
										stroke={series.color}
										strokeWidth={2}
										dot={false}
										connectNulls
									/>
								))}
							</LineChart>
						</ResponsiveContainer>
					</>
				) : (
					<div className="flex h-full items-center justify-center text-xs text-zinc-500">
						{paintedStints.length === 0 ? "No stints selected to paint." : "No stints match the filter or no drivers selected."}
					</div>
				)}
			</div>

			{/* Stint list: one row per stint; uses all remaining vertical space; headers are sortable */}
			<div className="min-h-0 flex-1 overflow-auto">
				<table className="w-full border-collapse text-xs tabular-nums">
					<thead className="sticky top-0 z-10 bg-zinc-900">
						<tr className="border-b border-zinc-700 text-left text-zinc-500">
							<th className="py-1.5 pr-2 pl-1 text-center" title="Paint in graph">
								Paint
							</th>
							<th className="py-1.5 pr-2 pl-1 text-center" title="Benchmark for relative times">
								Bench
							</th>
							{[
								{ key: "driver" as const, label: "Driver", align: "left" },
								{ key: "team" as const, label: "Team", align: "left" },
								{ key: "tyre" as const, label: "Tyre", align: "left" },
								{ key: "laps" as const, label: "Laps", align: "right" },
								{ key: "total" as const, label: "Total", align: "right" },
								{ key: "best" as const, label: "Best", align: "right" },
								{ key: "worst" as const, label: "Worst", align: "right" },
								{ key: "mean" as const, label: "Mean", align: "right" },
							].map(({ key, label, align }) => (
								<th
									key={key}
									className={`py-1.5 pr-2 cursor-pointer select-none hover:text-zinc-300 hover:bg-zinc-800/50 ${
										align === "right" ? "text-right" : ""
									} ${stintSortKey === key ? "text-zinc-300" : ""}`}
									onClick={() => toggleStintSort(key)}
									title={`Sort by ${label}`}
								>
									{label}
									{stintSortKey === key ? (
										<span className="ml-0.5 inline-block text-[10px]">
											{stintSortAsc ? "↑" : "↓"}
										</span>
									) : null}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{sortedStintSummaries.map((row, rowIndex) => {
							const key = `${row.driverNr}-${row.stintIndex}`;
							const checked = selectedStintKeys.has(key);
							const isBenchmark = benchmarkStintKey === key;
							const useRelative = benchmarkRow != null;
							const firstBestMs = sortedStintSummaries.length > 0 ? sortedStintSummaries[0]!.bestLapMs : 0;
							const firstWorstMs = sortedStintSummaries.length > 0 ? sortedStintSummaries[0]!.worstLapMs : 0;
							const firstMeanMs = sortedStintSummaries.length > 0 ? sortedStintSummaries[0]!.meanLapMs : 0;
							const formatBest = () => {
								if (row.bestLapMs <= 0) return "—";
								if (useRelative) {
									if (isBenchmark) return formatLapTimeMs(row.bestLapMs);
									return benchmarkRow && benchmarkRow.bestLapMs > 0 ? `+${((row.bestLapMs - benchmarkRow.bestLapMs) / 1000).toFixed(3)}s` : formatLapTimeMs(row.bestLapMs);
								}
								if (stintSortKey === "best") {
									if (rowIndex === 0) return formatLapTimeMs(row.bestLapMs);
									return firstBestMs > 0 ? `+${((row.bestLapMs - firstBestMs) / 1000).toFixed(3)}s` : formatLapTimeMs(row.bestLapMs);
								}
								return formatLapTimeMs(row.bestLapMs);
							};
							const formatWorst = () => {
								if (row.worstLapMs <= 0) return "—";
								if (useRelative) {
									if (isBenchmark) return formatLapTimeMs(row.worstLapMs);
									return benchmarkRow && benchmarkRow.worstLapMs > 0 ? `+${((row.worstLapMs - benchmarkRow.worstLapMs) / 1000).toFixed(3)}s` : formatLapTimeMs(row.worstLapMs);
								}
								if (stintSortKey === "worst") {
									if (rowIndex === 0) return formatLapTimeMs(row.worstLapMs);
									return firstWorstMs > 0 ? `+${((row.worstLapMs - firstWorstMs) / 1000).toFixed(3)}s` : formatLapTimeMs(row.worstLapMs);
								}
								return formatLapTimeMs(row.worstLapMs);
							};
							const formatMean = () => {
								if (row.meanLapMs <= 0) return "—";
								if (useRelative) {
									if (isBenchmark) return formatLapTimeMs(row.meanLapMs);
									return benchmarkRow && benchmarkRow.meanLapMs > 0 ? `+${((row.meanLapMs - benchmarkRow.meanLapMs) / 1000).toFixed(3)}s` : formatLapTimeMs(row.meanLapMs);
								}
								if (stintSortKey === "mean") {
									if (rowIndex === 0) return formatLapTimeMs(row.meanLapMs);
									return firstMeanMs > 0 ? `+${((row.meanLapMs - firstMeanMs) / 1000).toFixed(3)}s` : formatLapTimeMs(row.meanLapMs);
								}
								return formatLapTimeMs(row.meanLapMs);
							};
							const formatTotal = () => {
								if (useRelative) {
									if (isBenchmark) return formatLapTimeMs(row.totalStintTimeMs);
									return benchmarkRow ? `+${((row.totalStintTimeMs - benchmarkRow.totalStintTimeMs) / 1000).toFixed(3)}s` : formatLapTimeMs(row.totalStintTimeMs);
								}
								return formatLapTimeMs(row.totalStintTimeMs);
							};
							return (
							<tr
								key={key}
								className={clsx(
									"border-b border-zinc-800 hover:bg-white/[0.03]",
									checked ? "bg-cyan-500/10" : "",
									isBenchmark ? "bg-amber-500/10" : "",
								)}
							>
								<td className="py-1 pr-2 pl-1 text-center">
									<input
										type="checkbox"
										checked={checked}
										onChange={() => onToggleStint(row.driverNr, row.stintIndex)}
										className="rounded border-zinc-600"
										aria-label={`Paint ${row.label} S${row.stintIndex + 1}`}
									/>
								</td>
								<td className="py-1 pr-2 pl-1 text-center">
									<input
										type="radio"
										name="stint-benchmark"
										checked={isBenchmark}
										onChange={() => setBenchmarkStintKey(key)}
										onClick={() => {
											if (isBenchmark) setBenchmarkStintKey(null);
										}}
										className="rounded-full border-zinc-600"
										aria-label={`Benchmark ${row.label} S${row.stintIndex + 1}`}
									/>
								</td>
								<td className="py-1 pr-2">
									<span
										className="inline-block h-2 w-2 shrink-0 rounded-full align-middle"
										style={{ backgroundColor: row.color }}
									/>
									<span className="ml-1.5 font-medium text-zinc-200">{row.label}</span>
									<span className="ml-1.5 inline-flex items-center rounded border border-zinc-700 bg-zinc-900/60 px-1 py-0.5 text-[10px] font-semibold text-zinc-400">
										S{row.stintIndex + 1}
									</span>
									{(() => {
										const list = stintsMap.get(row.driverNr) ?? [];
										const isLastStint = row.stintIndex === list.length - 1;
										const stintIsLive = isLastStint && !sessionEnded;
										if (stintIsLive) return <span className="ml-1 text-[10px] text-emerald-400" title="Stint ongoing">Live</span>;
										if (isLastStint && sessionEnded) return <span className="ml-1 text-[10px] text-zinc-500" title="Stint finished">Finished</span>;
										return <span className="ml-1 text-[10px] text-zinc-500" title="Stint finished">Finished</span>;
									})()}
								</td>
								<td className="py-1 pr-2 text-zinc-400">{row.teamName}</td>
								<td className="py-1 pr-2">
									{(() => {
										const { label, className } = compoundToTyreStyle(row.compound);
										return (
											<span
												className={clsx(
													"inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
													className,
												)}
											>
												{label}
											</span>
										);
									})()}
								</td>
								<td className="py-1 pr-2 text-right text-zinc-300">{row.lapCount}</td>
								<td className="py-1 pr-2 text-right text-zinc-300">
									{formatTotal()}
								</td>
								<td className="py-1 pr-2 text-right text-emerald-400">
									{formatBest()}
								</td>
								<td className="py-1 pr-2 text-right text-red-400">
									{formatWorst()}
								</td>
								<td className="py-1 pr-2 text-right text-zinc-400">
									{formatMean()}
								</td>
							</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}
