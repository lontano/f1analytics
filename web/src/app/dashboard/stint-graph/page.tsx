"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";

import StintAnalysisPanel from "@/components/dashboard/StintAnalysisPanel";
import DriverTag from "@/components/driver/DriverTag";
import DriverDRS from "@/components/driver/DriverDRS";
import DriverInfo from "@/components/driver/DriverInfo";
import DriverGap from "@/components/driver/DriverGap";
import DriverLapTime from "@/components/driver/DriverLapTime";

import { sortPos } from "@/lib/sorting";
import { fetchRawSessions, formatSessionLabel } from "@/lib/rawApi";
import { fetchReviewLaps, fetchReviewStints, fetchReviewPitWindows, buildStints } from "@/lib/reviewApi";
import { darkenTeamColor } from "@/lib/teamColor";

import { useDataStore } from "@/stores/useDataStore";
import DataAvailability from "@/components/DataAvailability";
import Slider from "@/components/ui/Slider";
import type { Driver, TimingDataDriver } from "@/types/state.type";
import type { RawSession } from "@/types/raw.type";
import type { DetectedStint, PitWindow, ReviewLap, ReviewStintRow } from "@/types/review.type";
import { useSettingsStore } from "@/stores/useSettingsStore";

// ── colour helpers ────────────────────────────────────────────────────────────

/** Maps a ratio [0..1] (position in session) to a colour: teal → amber */
function sessionRatioToColor(ratio: number): string {
	const r = Math.max(0, Math.min(1, ratio));
	// Hue: 190 (teal) at start → 35 (amber) at end
	const hue = Math.round(190 - r * 155);
	const sat = 72 + r * 10;
	const lit = 48 + r * 10;
	return `hsl(${hue}, ${sat}%, ${lit}%)`;
}

function formatMs(ms: number): string {
	const s = ms / 1000;
	if (s >= 60) {
		const m = Math.floor(s / 60);
		const sec = (s % 60).toFixed(3).padStart(6, "0");
		return `${m}:${sec}`;
	}
	return `${s.toFixed(3)}s`;
}

/** Format ISO/time string as local time of day HH:mm:ss.SSS */
function formatTimeOfDay(timeStr: string): string {
	const d = new Date(timeStr);
	if (Number.isNaN(d.getTime())) return "—";
	const h = d.getHours();
	const m = d.getMinutes();
	const s = d.getSeconds();
	const ms = d.getMilliseconds();
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/** Format Date as HH:mm for timeline axis */
function formatTimeAxis(d: Date): string {
	if (Number.isNaN(d.getTime())) return "—";
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Format Date as HH:mm:ss for navigation readout */
function formatTimeAxisWithSeconds(d: Date): string {
	if (Number.isNaN(d.getTime())) return "—";
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

type TimelineScale = "auto" | "1h" | "2h" | "4h" | "8h" | "12h";
const TIMELINE_SCALE_MS: Record<Exclude<TimelineScale, "auto">, number> = {
	"1h": 60 * 60 * 1000,
	"2h": 2 * 60 * 60 * 1000,
	"4h": 4 * 60 * 60 * 1000,
	"8h": 8 * 60 * 60 * 1000,
	"12h": 12 * 60 * 60 * 1000,
};

type LapPaintMode = "global" | "stint";
type LapPaint = "yellow" | "green" | "purple";

const LAP_PAINT_COLORS: Record<LapPaint, string> = {
	yellow: "#facc15", // amber-400
	green: "#22c55e", // green-500
	purple: "#a855f7", // violet-500
};

/** In-lap and out-lap bar color */
const IN_OUT_LAP_COLOR = "#3b82f6"; // blue-500

function compoundToBadge(compound: string | null | undefined): { label: string; className: string; title: string } {
	const c = (compound ?? "").toUpperCase();
	switch (c) {
		case "SOFT":
			return { label: "S", className: "border-red-500/40 bg-red-500/15 text-red-300", title: "SOFT" };
		case "MEDIUM":
			return {
				label: "M",
				className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-200",
				title: "MEDIUM",
			};
		case "HARD":
			return {
				label: "H",
				className: "border-zinc-200/40 bg-zinc-200/10 text-zinc-200",
				title: "HARD",
			};
		case "INTERMEDIATE":
			return {
				label: "I",
				className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
				title: "INTERMEDIATE",
			};
		case "WET":
			return { label: "W", className: "border-sky-500/40 bg-sky-500/15 text-sky-300", title: "WET" };
		default:
			return { label: "—", className: "border-zinc-700 bg-zinc-800/30 text-zinc-400", title: c || "UNKNOWN" };
	}
}

// ── DriverTimeline ─────────────────────────────────────────────────────────────

type TooltipState = {
	x: number;
	y: number;
	lapNr: number;
	stintIdx: number;
	stintLapNr: number;
	stintTotalLaps: number;
	lapTimeMs: number;
	color: string;
	hasStint: boolean;
};

type DriverTimelineProps = {
	driverNr: number;
	driverLaps: ReviewLap[];
	stintsMap: Map<number, DetectedStint[]>;
	timelineStart: Date | null;
	timelineEnd: Date | null;
	shiftDown: boolean;
	lapPaintMode: LapPaintMode;
	globalLapPaint: Map<string, LapPaint>;
	selectedStintKeys: Set<string>;
	onToggleStint: (driverNr: number, stintIndex: number) => void;
};

function DriverTimeline({
	driverNr,
	driverLaps,
	stintsMap,
	timelineStart,
	timelineEnd,
	shiftDown,
	lapPaintMode,
	globalLapPaint,
	selectedStintKeys,
	onToggleStint,
}: DriverTimelineProps) {
	const [tooltip, setTooltip] = useState<TooltipState | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	const driverStintsCount = stintsMap.get(driverNr)?.length ?? 0;
	const selectedStintsCountForDriver = useMemo(() => {
		if (driverStintsCount === 0) return 0;
		let n = 0;
		for (let i = 0; i < driverStintsCount; i++) {
			if (selectedStintKeys.has(`${driverNr}-${i}`)) n++;
		}
		return n;
	}, [driverNr, driverStintsCount, selectedStintKeys]);
	const isFilteringStints = selectedStintsCountForDriver > 0 && selectedStintsCountForDriver < driverStintsCount;

	const rects = useMemo(() => {
		if (!timelineStart || !timelineEnd) return [];
		const windowStartMs = timelineStart.getTime();
		const windowEndMs = timelineEnd.getTime();
		const duration = windowEndMs - windowStartMs;
		if (duration <= 0) return [];

		// Build lap → stint lookup
		const stints = stintsMap.get(driverNr) ?? [];
		const lapToStint = new Map<number, { stintIdx: number; stintLapNr: number }>();
		stints.forEach((stint, si) => {
			stint.laps.forEach((l, li) => lapToStint.set(l.lap, { stintIdx: si, stintLapNr: li + 1 }));
		});

		// Stint-based painting: purple = fastest lap in stint, green = faster than previous lap in stint, yellow otherwise
		const stintLapPaint = new Map<number, LapPaint>();
		if (lapPaintMode === "stint") {
			for (const stint of stints) {
				const lapsInStint = stint.laps ?? [];
				let fastestMs = Infinity;
				for (const l of lapsInStint) {
					const ms = l.lastLaptimeMs ?? null;
					if (ms != null && ms > 0 && ms < fastestMs) fastestMs = ms;
				}
				for (let i = 0; i < lapsInStint.length; i++) {
					const l = lapsInStint[i]!;
					const ms = l.lastLaptimeMs ?? null;
					const prevMs = i > 0 ? (lapsInStint[i - 1]?.lastLaptimeMs ?? null) : null;
					let paint: LapPaint = "yellow";
					if (ms != null && ms > 0 && ms === fastestMs) paint = "purple";
					else if (i > 0 && ms != null && ms > 0 && prevMs != null && prevMs > 0 && ms < prevMs) paint = "green";
					stintLapPaint.set(l.lap, paint);
				}
			}
		}

		// Include real laps (30s–5min) and in-laps/out-laps (first/last of stint) which we paint blue
		const MIN_LAP_MS = 30_000;
		const MAX_LAP_MS = 300_000;
		return driverLaps
			.filter((l) => {
				if (l.lastLaptimeMs == null || !l.time) return false;
				const stintInfo = lapToStint.get(l.lap);
				const isInOrOut =
					stintInfo &&
					stints[stintInfo.stintIdx] &&
					(stintInfo.stintLapNr === 1 ||
						stintInfo.stintLapNr === (stints[stintInfo.stintIdx]?.laps?.length ?? 0));
				if (isInOrOut) return true;
				return (
					l.lastLaptimeMs > MIN_LAP_MS &&
					l.lastLaptimeMs < MAX_LAP_MS
				);
			})
			.map((lap) => {
				const lapEndMs = new Date(lap.time).getTime();
				if (Number.isNaN(lapEndMs)) return null;
				const lapStartMs = lapEndMs - (lap.lastLaptimeMs ?? 0);

				// Only paint the visible portion inside the current window
				const visibleStartMs = Math.max(lapStartMs, windowStartMs);
				const visibleEndMs = Math.min(lapEndMs, windowEndMs);
				if (visibleEndMs <= visibleStartMs) return null;

				const stintInfo = lapToStint.get(lap.lap);
				const stintTotalLaps = stintInfo ? stints[stintInfo.stintIdx]?.laps?.length ?? 0 : 0;
				// Out-lap: first lap of every stint (driver just exited the pit)
				const isOutLap = !!stintInfo && stintInfo.stintLapNr === 1;
				// In-lap: last lap of a non-last closed stint (driver heading back to pit / cool-down lap)
				const isInLap =
					!!stintInfo &&
					stintTotalLaps > 1 &&
					stintInfo.stintLapNr === stintTotalLaps &&
					stintInfo.stintIdx < stints.length - 1;

				const leftPct = ((visibleStartMs - windowStartMs) / duration) * 100;
				const widthPct = Math.max(0.25, ((visibleEndMs - visibleStartMs) / duration) * 100);
				const ratio = Math.max(0, Math.min(1, (lapEndMs - windowStartMs) / duration));
				const neutralColor = sessionRatioToColor(ratio);
				let color = isOutLap || isInLap ? IN_OUT_LAP_COLOR : neutralColor;
				if (!isOutLap && !isInLap) {
					if (lapPaintMode === "global") {
						const paint = globalLapPaint.get(`${driverNr}-${lap.lap}`);
						if (paint) color = LAP_PAINT_COLORS[paint];
					} else if (lapPaintMode === "stint") {
						const paint = stintLapPaint.get(lap.lap);
						if (paint) color = LAP_PAINT_COLORS[paint];
					}
				}
				return {
					key: `${lap.lap}-${lap.time}`,
					lapNr: lap.lap,
					leftPct,
					widthPct,
					color,
					lapTimeMs: lap.lastLaptimeMs!,
					stintIdx: stintInfo?.stintIdx ?? 0,
					stintLapNr: stintInfo?.stintLapNr ?? lap.lap,
					stintTotalLaps,
					hasStint: !!stintInfo,
				};
			})
			.filter((r): r is NonNullable<typeof r> => r !== null);
	}, [driverNr, driverLaps, stintsMap, timelineStart, timelineEnd, lapPaintMode, globalLapPaint]);

	const showTooltip = useCallback(
		(e: React.MouseEvent, rect: (typeof rects)[number]) => {
			setTooltip({
				x: e.clientX,
				y: e.clientY,
				lapNr: rect.lapNr,
				stintIdx: rect.stintIdx,
				stintLapNr: rect.stintLapNr,
				stintTotalLaps: rect.stintTotalLaps,
				lapTimeMs: rect.lapTimeMs,
				color: rect.color,
				hasStint: rect.hasStint,
			});
		},
		[],
	);

	const moveTooltip = useCallback((e: React.MouseEvent) => {
		setTooltip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null));
	}, []);

	if (!timelineStart || !timelineEnd) {
		return <div className="h-4 w-full rounded bg-zinc-800/50" />;
	}

	return (
		<div ref={containerRef} className="relative h-4 w-full">
			{/* Track background */}
			<div className="absolute inset-0 rounded bg-zinc-800/60" />

			{rects.map((rect) => (
				(() => {
					const key = rect.hasStint ? `${driverNr}-${rect.stintIdx}` : null;
					const isSelected = key != null && selectedStintKeys.has(key);
					const dim = isFilteringStints && rect.hasStint && !isSelected;
					return (
				<div
					key={rect.key}
					className={clsx(
						"absolute top-0.5 bottom-0.5 rounded-sm",
						rect.hasStint ? "cursor-pointer" : "cursor-default",
						isFilteringStints && isSelected ? "ring-1 ring-white/70" : "",
					)}
					style={{
						left: `${rect.leftPct}%`,
						width: `${rect.widthPct}%`,
						backgroundColor: rect.color,
						borderLeft: "1px solid rgba(0,0,0,0.3)",
						opacity: dim ? 0.22 : 1,
					}}
					onMouseEnter={(e) => showTooltip(e, rect)}
					onMouseLeave={() => setTooltip(null)}
					onMouseMove={moveTooltip}
					onClick={() => {
						if (!rect.hasStint) return;
						onToggleStint(driverNr, rect.stintIdx);
					}}
				/>
					);
				})()
			))}

			{tooltip &&
				createPortal(
					<div
						className="pointer-events-none fixed z-[9999] max-w-[320px] rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white shadow-lg"
						style={{ left: tooltip.x + 12, top: tooltip.y - 38 }}
					>
						<div className="flex items-center gap-1.5">
							<span className="font-medium" style={{ color: tooltip.color }}>
								{tooltip.hasStint ? `S${tooltip.stintIdx + 1}` : "—"}
							</span>
							{tooltip.hasStint && tooltip.stintTotalLaps > 0 && (
								<span className="text-zinc-300">
									L{tooltip.stintLapNr}/{tooltip.stintTotalLaps}
								</span>
							)}
							<span className="text-zinc-500">·</span>
							<span className="text-zinc-400">Lap {tooltip.lapNr}</span>
						</div>
						<div className="mt-0.5 flex items-center gap-1.5">
							<span className="text-zinc-500">Lap time</span>
							<span className="tabular-nums text-zinc-200">{formatMs(tooltip.lapTimeMs)}</span>
						</div>

						{shiftDown && tooltip.hasStint && (() => {
							const stints = stintsMap.get(driverNr) ?? [];
							const stint = stints[tooltip.stintIdx];
							const laps = stint?.laps ?? [];
							if (laps.length === 0) return null;

							let fastestIdx: number | null = null;
							let fastestMs = Infinity;
							for (let i = 0; i < laps.length; i++) {
								const ms = laps[i]?.lastLaptimeMs ?? null;
								if (ms != null && ms > 0 && ms < fastestMs) {
									fastestMs = ms;
									fastestIdx = i;
								}
							}

							return (
								<div className="mt-1 border-t border-zinc-700/60 pt-1">
									<div className="mb-0.5 text-[10px] text-zinc-500">Stint laps</div>
									<div className="flex flex-col gap-0.5">
										{laps.map((lap, idx) => {
											const ms = lap.lastLaptimeMs;
											const isCurrent = lap.lap === tooltip.lapNr;
											const isFastest = fastestIdx != null && idx === fastestIdx;
											return (
												<div
													key={`${lap.lap}-${lap.time}-${idx}`}
													className={clsx(
														"flex items-center justify-between gap-2 rounded px-1 py-0.5",
														isCurrent ? "bg-cyan-500/15" : "bg-transparent",
													)}
												>
													<span
														className={clsx(
															"text-[10px] tabular-nums",
															isFastest ? "text-emerald-300 font-medium" : "text-zinc-300",
														)}
													>
														L{idx + 1}
														<span className="ml-1 text-zinc-600">(Lap {lap.lap})</span>
													</span>
													<span
														className={clsx(
															"text-[10px] tabular-nums",
															isFastest ? "text-emerald-300 font-medium" : "text-zinc-200",
														)}
													>
														{ms != null && ms > 0 ? formatMs(ms) : "—"}
													</span>
												</div>
											);
										})}
									</div>
									<div className="mt-0.5 text-[10px] text-zinc-600">
										Fastest lap highlighted · Hovered lap highlighted
									</div>
								</div>
							);
						})()}
					</div>,
					document.body,
				)}
		</div>
	);
}

// ── Main page ──────────────────────────────────────────────────────────────────

const PANEL_WIDTH_DEFAULT = 500;
const LAPS_PANEL_WIDTH_DEFAULT = 420;
const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 900;

export default function StintGraph() {
	const drivers = useDataStore((state) => state.state?.DriverList);
	const driversTiming = useDataStore((state) => state.state?.TimingData);
	const sessionInfo = useDataStore((state) => state.state?.SessionInfo);

	const [selectedNr, setSelectedNr] = useState<string | null>(null);
	const [analysisOpen, setAnalysisOpen] = useState(true);
	const [lapsOpen, setLapsOpen] = useState(false);
	const [shiftDown, setShiftDown] = useState(false);
	const [analysisPanelWidth, setAnalysisPanelWidth] = useState(PANEL_WIDTH_DEFAULT);
	const [lapsPanelWidth, setLapsPanelWidth] = useState(LAPS_PANEL_WIDTH_DEFAULT);
	const analysisPanelContentRef = useRef<HTMLDivElement>(null);
	const [analysisContentHeight, setAnalysisContentHeight] = useState(400);

	const resizeWidthStart = useRef<{ x: number; w: number } | null>(null);
	const resizeLapsWidthStart = useRef<{ x: number; w: number } | null>(null);

	// Measure analysis panel content height so StintAnalysisPanel can use full space
	useEffect(() => {
		const el = analysisPanelContentRef.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry?.contentRect.height) setAnalysisContentHeight(entry.contentRect.height);
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [analysisOpen]);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Shift") setShiftDown(true);
		};
		const onKeyUp = (e: KeyboardEvent) => {
			if (e.key === "Shift") setShiftDown(false);
		};
		const onBlur = () => setShiftDown(false);
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);
		window.addEventListener("blur", onBlur);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("blur", onBlur);
		};
	}, []);

	const onResizeWidthMove = useCallback((e: MouseEvent) => {
		if (resizeWidthStart.current == null) return;
		const delta = resizeWidthStart.current.x - e.clientX;
		const next = Math.min(
			MAX_PANEL_WIDTH,
			Math.max(MIN_PANEL_WIDTH, resizeWidthStart.current.w + delta),
		);
		setAnalysisPanelWidth(next);
		resizeWidthStart.current = { x: e.clientX, w: next };
	}, []);
	const onResizeWidthEnd = useCallback(() => {
		resizeWidthStart.current = null;
		window.removeEventListener("mousemove", onResizeWidthMove);
		window.removeEventListener("mouseup", onResizeWidthEnd);
	}, [onResizeWidthMove]);

	const onResizeLapsWidthMove = useCallback((e: MouseEvent) => {
		if (resizeLapsWidthStart.current == null) return;
		const delta = resizeLapsWidthStart.current.x - e.clientX;
		const next = Math.min(
			MAX_PANEL_WIDTH,
			Math.max(MIN_PANEL_WIDTH, resizeLapsWidthStart.current.w + delta),
		);
		setLapsPanelWidth(next);
		resizeLapsWidthStart.current = { x: e.clientX, w: next };
	}, []);
	const onResizeLapsWidthEnd = useCallback(() => {
		resizeLapsWidthStart.current = null;
		window.removeEventListener("mousemove", onResizeLapsWidthMove);
		window.removeEventListener("mouseup", onResizeLapsWidthEnd);
	}, [onResizeLapsWidthMove]);

	const startResizeWidth = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			resizeWidthStart.current = { x: e.clientX, w: analysisPanelWidth };
			window.addEventListener("mousemove", onResizeWidthMove);
			window.addEventListener("mouseup", onResizeWidthEnd);
		},
		[analysisPanelWidth, onResizeWidthMove, onResizeWidthEnd],
	);
	const startResizeLapsWidth = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			resizeLapsWidthStart.current = { x: e.clientX, w: lapsPanelWidth };
			window.addEventListener("mousemove", onResizeLapsWidthMove);
			window.addEventListener("mouseup", onResizeLapsWidthEnd);
		},
		[lapsPanelWidth, onResizeLapsWidthMove, onResizeLapsWidthEnd],
	);

	// Review data ─────────────────────────────────────────────────────────────
	const [sessions, setSessions] = useState<RawSession[]>([]);
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
	const [laps, setLaps] = useState<ReviewLap[]>([]);
	const [stintRows, setStintRows] = useState<ReviewStintRow[]>([]);
	const [pitWindows, setPitWindows] = useState<PitWindow[]>([]);
	const [loadStatus, setLoadStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

	// Load session list once
	useEffect(() => {
		fetchRawSessions(100)
			.then((data) => setSessions(data ?? []))
			.catch(() => setSessions([]));
	}, []);

	// Auto-select current live session when sessions list is ready
	useEffect(() => {
		if (!sessions.length || !sessionInfo || selectedSessionId) return;
		const match = sessions.find((s) => s.sessionKey === sessionInfo.Key);
		if (match) setSelectedSessionId(match.id);
	}, [sessions, sessionInfo, selectedSessionId]);

	const loadSessionData = useCallback(() => {
		if (!selectedSessionId) return;
		setLoadStatus("loading");
		Promise.all([
			fetchReviewLaps(selectedSessionId),
			fetchReviewStints(selectedSessionId),
			fetchReviewPitWindows(selectedSessionId),
		])
			.then(([lapsRes, stintsRes, pitWindowsRes]) => {
				setLaps(lapsRes);
				setStintRows(stintsRes);
				setPitWindows(pitWindowsRes);
				setLoadStatus("ready");
			})
			.catch(() => {
				setLaps([]);
				setStintRows([]);
				setPitWindows([]);
				setLoadStatus("error");
			});
	}, [selectedSessionId]);

	// Load laps + tire rows + pit windows when session changes
	useEffect(() => {
		loadSessionData();
	}, [loadSessionData]);

	// When viewing current (live) session, refetch when any driver completes a lap so stint data stays up to date
	const liveLapCountSignature = useDataStore((s) => {
		const lines = s.state?.TimingData?.Lines;
		if (!lines || typeof lines !== "object") return null;
		return Object.entries(lines)
			.map(([nr, line]) => `${nr}:${(line as { NumberOfLaps?: number }).NumberOfLaps ?? 0}`)
			.sort()
			.join(",");
	});
	const isViewingCurrentSession =
		!!selectedSessionId &&
		!!sessionInfo &&
		sessions.some((s) => s.id === selectedSessionId && s.sessionKey === sessionInfo.Key);
	const prevLiveSignatureRef = useRef<string | null>(null);
	useEffect(() => {
		if (!isViewingCurrentSession || liveLapCountSignature == null) return;
		if (prevLiveSignatureRef.current !== liveLapCountSignature) {
			const wasFirstRun = prevLiveSignatureRef.current === null;
			prevLiveSignatureRef.current = liveLapCountSignature;
			if (!wasFirstRun) loadSessionData();
		}
	}, [isViewingCurrentSession, liveLapCountSignature, loadSessionData]);

	// Rebuild stints when laps, tire data, pit windows or setting change
	const maxPitTimeToKeepStintSeconds = useSettingsStore((s) => s.maxPitTimeToKeepStintSeconds);
	const stintsMap = useMemo(() => {
		// Use selected session type for practice/qualifying detection; fall back to live session type
		const selectedSessionType = sessions.find((s) => s.id === selectedSessionId)?.sessionType;
		const sessionType = selectedSessionType ?? sessionInfo?.Type;
		return buildStints(laps, stintRows, sessionType, pitWindows, maxPitTimeToKeepStintSeconds);
	}, [laps, stintRows, sessions, selectedSessionId, sessionInfo, pitWindows, maxPitTimeToKeepStintSeconds]);

	// Selected stints (for analysis graph + timeline highlighting)
	const [selectedStintKeys, setSelectedStintKeys] = useState<Set<string>>(new Set());
	const lastSelectionSessionRef = useRef<string | null>(null);

	useEffect(() => {
		if (!selectedSessionId) return;
		if (stintsMap.size === 0) return;
		const all = new Set<string>();
		stintsMap.forEach((list, driverNr) => {
			list.forEach((_, idx) => all.add(`${driverNr}-${idx}`));
		});

		if (lastSelectionSessionRef.current !== selectedSessionId) {
			setSelectedStintKeys(all);
			lastSelectionSessionRef.current = selectedSessionId;
			return;
		}

		// Same session: keep existing selection where possible; auto-select any new stints
		setSelectedStintKeys((prev) => {
			if (prev.size === 0) return all;
			const next = new Set<string>();
			prev.forEach((k) => {
				if (all.has(k)) next.add(k);
			});
			all.forEach((k) => {
				if (!next.has(k)) next.add(k);
			});
			return next;
		});
	}, [selectedSessionId, stintsMap]);

	const toggleStintSelection = useCallback((driverNr: number, stintIndex: number) => {
		const key = `${driverNr}-${stintIndex}`;
		setSelectedStintKeys((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}, []);

	// Selected session object + time window
	const selectedSession = useMemo(
		() => sessions.find((s) => s.id === selectedSessionId) ?? null,
		[sessions, selectedSessionId],
	);

	// Session time window — prefer stored dates, fall back to span of loaded laps
	const [sessionStart, sessionEnd] = useMemo((): [Date | null, Date | null] => {
		if (selectedSession?.startDate && selectedSession?.endDate) {
			return [new Date(selectedSession.startDate), new Date(selectedSession.endDate)];
		}
		if (sessionInfo?.StartDate && sessionInfo?.EndDate) {
			return [new Date(sessionInfo.StartDate), new Date(sessionInfo.EndDate)];
		}
		if (laps.length === 0) return [null, null];
		let minMs = Infinity;
		let maxMs = -Infinity;
		for (const l of laps) {
			if (!l.time) continue;
			const endMs = new Date(l.time).getTime();
			if (Number.isNaN(endMs)) continue;
			const startMs = endMs - (l.lastLaptimeMs ?? 0);
			if (startMs < minMs) minMs = startMs;
			if (endMs > maxMs) maxMs = endMs;
		}
		if (!Number.isFinite(minMs)) return [null, null];
		// Add 60 s padding on each side
		return [new Date(minMs - 60_000), new Date(maxMs + 60_000)];
	}, [selectedSession, sessionInfo, laps]);

	const [timelineScale, setTimelineScale] = useState<TimelineScale>("auto");
	/** 0..1: when scale is fixed and session is longer than scale, offset of the visible window over the full session */
	const [timelineWindowOffset, setTimelineWindowOffset] = useState(0);
	const [lapPaintMode, setLapPaintMode] = useState<LapPaintMode>("global");

	// Global paint (F1-style): purple = new session best so far, green = new personal best so far, yellow otherwise.
	const globalLapPaint = useMemo((): Map<string, LapPaint> => {
		type Ev = { driverNr: number; lapNr: number; endMs: number; lapTimeMs: number };
		const events: Ev[] = [];
		for (const l of laps) {
			const ms = l.lastLaptimeMs ?? null;
			if (ms == null || ms <= 0) continue;
			const endMs = new Date(l.time).getTime();
			if (Number.isNaN(endMs)) continue;
			events.push({ driverNr: Number(l.driverNr), lapNr: l.lap, endMs, lapTimeMs: ms });
		}
		events.sort((a, b) => a.endMs - b.endMs);

		let globalBest = Infinity;
		const bestByDriver = new Map<number, number>();
		const out = new Map<string, LapPaint>();

		for (const ev of events) {
			const prevGlobal = globalBest;
			const prevPersonal = bestByDriver.get(ev.driverNr) ?? Infinity;

			let paint: LapPaint = "yellow";
			if (ev.lapTimeMs < prevGlobal) paint = "purple";
			else if (ev.lapTimeMs < prevPersonal) paint = "green";

			out.set(`${ev.driverNr}-${ev.lapNr}`, paint);

			if (ev.lapTimeMs < globalBest) globalBest = ev.lapTimeMs;
			if (ev.lapTimeMs < prevPersonal) bestByDriver.set(ev.driverNr, ev.lapTimeMs);
		}

		return out;
	}, [laps]);

	// First/last recorded lap across all drivers (no padding) — used for "Automatic (first–last lap)"
	const [lapSpanStart, lapSpanEnd] = useMemo((): [Date | null, Date | null] => {
		if (laps.length === 0) return [null, null];
		let minMs = Infinity;
		let maxMs = -Infinity;
		for (const l of laps) {
			if (!l.time) continue;
			const endMs = new Date(l.time).getTime();
			if (Number.isNaN(endMs)) continue;
			const startMs = endMs - (l.lastLaptimeMs ?? 0);
			if (startMs < minMs) minMs = startMs;
			if (endMs > maxMs) maxMs = endMs;
		}
		if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || maxMs <= minMs) return [null, null];
		return [new Date(minMs), new Date(maxMs)];
	}, [laps]);

	// Visible timeline window: auto = first→last recorded lap; fixed = scale-sized window, offset by slider when session is longer than scale
	const [timelineStart, timelineEnd] = useMemo((): [Date | null, Date | null] => {
		const baseStart = lapSpanStart ?? sessionStart;
		const baseEnd = lapSpanEnd ?? sessionEnd;
		if (!baseStart || !baseEnd) return [null, null];
		const startMs = baseStart.getTime();
		const endMs = baseEnd.getTime();
		const fullDurationMs = endMs - startMs;
		if (timelineScale === "auto") return [baseStart, baseEnd];
		const scaleMs = TIMELINE_SCALE_MS[timelineScale];
		const windowDurationMs = Math.min(scaleMs, fullDurationMs);
		const maxOffsetMs = Math.max(0, fullDurationMs - windowDurationMs);
		const offsetMs = timelineWindowOffset * maxOffsetMs;
		const windowStartMs = startMs + offsetMs;
		const windowEndMs = Math.min(endMs, windowStartMs + windowDurationMs);
		return [new Date(windowStartMs), new Date(windowEndMs)];
	}, [lapSpanStart, lapSpanEnd, sessionStart, sessionEnd, timelineScale, timelineWindowOffset]);

	// Current time for vertical line (live edge minus delay); re-render every second to move the line
	const delay = useSettingsStore((s) => s.delay);
	const [, tickNow] = useState(0);
	useEffect(() => {
		const id = setInterval(() => tickNow((n) => n + 1), 1000);
		return () => clearInterval(id);
	}, []);
	const currentTimeMs = Date.now() - delay * 1000;

	const timelineDurationMs = timelineStart && timelineEnd ? timelineEnd.getTime() - timelineStart.getTime() : 0;
	const currentTimePct =
		timelineStart && timelineEnd && timelineDurationMs > 0
			? Math.max(-1, Math.min(101, ((currentTimeMs - timelineStart.getTime()) / timelineDurationMs) * 100))
			: null;

	// Pre-index laps by driver number for O(1) lookup in rows
	const lapsByDriverNr = useMemo(() => {
		const map = new Map<number, ReviewLap[]>();
		for (const lap of laps) {
			const nr = Number(lap.driverNr);
			const list = map.get(nr) ?? [];
			list.push(lap);
			map.set(nr, list);
		}
		return map;
	}, [laps]);

	// Selected driver laps list (for right panel). Always include out-laps (first of any stint)
	// and in-laps (last of closed non-last stints). For other laps, filter to 30s–5min.
	const selectedDriverLaps = useMemo(() => {
		if (!selectedNr) return [];
		const driverNr = Number(selectedNr);
		const list = lapsByDriverNr.get(driverNr) ?? [];
		const stints = stintsMap.get(driverNr) ?? [];
		const lapToStint = new Map<number, { stintIdx: number; stintLapNr: number }>();
		stints.forEach((stint, si) => {
			stint.laps.forEach((l, li) => lapToStint.set(l.lap, { stintIdx: si, stintLapNr: li + 1 }));
		});
		const MIN_LAP_MS = 30_000;
		const MAX_LAP_MS = 300_000;
		return [...list]
			.filter((l) => {
				if (l.lastLaptimeMs == null || !l.time) return false;
				const stintInfo = lapToStint.get(l.lap);
				if (!stintInfo) return l.lastLaptimeMs > MIN_LAP_MS && l.lastLaptimeMs < MAX_LAP_MS;
				const stintData = stints[stintInfo.stintIdx];
				if (!stintData) return l.lastLaptimeMs > MIN_LAP_MS && l.lastLaptimeMs < MAX_LAP_MS;
				const stintTotalLaps = stintData.laps.length;
				// Out-lap: first lap of any stint
				const isOutLap = stintInfo.stintLapNr === 1;
				// In-lap: last lap of a non-last closed stint (with >1 laps in stint)
				const isInLap =
					stintTotalLaps > 1 &&
					stintInfo.stintLapNr === stintTotalLaps &&
					stintInfo.stintIdx < stints.length - 1;
				if (isOutLap || isInLap) return true;
				return l.lastLaptimeMs > MIN_LAP_MS && l.lastLaptimeMs < MAX_LAP_MS;
			})
			.sort((a, b) => a.lap - b.lap);
	}, [selectedNr, lapsByDriverNr, stintsMap]);

	// Map lap number -> stint index (1-based for display) for the selected driver
	const lapToStintIndex = useMemo(() => {
		if (!selectedNr) return new Map<number, number>();
		const stints = stintsMap.get(Number(selectedNr)) ?? [];
		const map = new Map<number, number>();
		stints.forEach((stint, stintIndex) => {
			stint.laps.forEach((l) => map.set(l.lap, stintIndex + 1));
		});
		return map;
	}, [selectedNr, stintsMap]);

	// Lap role for selected driver: out-lap (first of any stint — driver just exited pit),
	// in-lap (last of a non-last closed stint — cool-down / heading back into pit)
	const selectedDriverLapRole = useMemo(() => {
		if (!selectedNr) return new Map<number, "out" | "in">();
		const stints = stintsMap.get(Number(selectedNr)) ?? [];
		const map = new Map<number, "out" | "in">();
		stints.forEach((stint, stintIdx) => {
			stint.laps.forEach((l, li) => {
				// Out-lap: first lap of every stint (driver exiting pit)
				if (li === 0) {
					map.set(l.lap, "out");
				}
				// In-lap: last lap of a closed non-last stint (driver heading into pit)
				// Only mark if stint has more than 1 lap (avoid double-marking single-lap stints)
				if (li === stint.laps.length - 1 && stintIdx < stints.length - 1 && stint.laps.length > 1) {
					map.set(l.lap, "in");
				}
			});
		});
		return map;
	}, [selectedNr, stintsMap]);

	// Session ended and last stint index per driver (for "Live" / "Finished" and discard-last-lap)
	const sessionEnded = useDataStore((s) => {
		const status = s.state?.SessionStatus?.Status;
		return status === "Ends" || status === "Finished" || status === "Finalised";
	});
	const lastStintIndexByDriver = useMemo(() => {
		const map = new Map<number, number>();
		stintsMap.forEach((list, driverNr) => {
			if (list.length > 0) map.set(Number(driverNr), list.length - 1);
		});
		return map;
	}, [stintsMap]);

	// Stint-based lap paint for selected driver (for laps panel LED)
	const selectedDriverStintLapPaint = useMemo(() => {
		if (!selectedNr) return new Map<number, LapPaint>();
		const stints = stintsMap.get(Number(selectedNr)) ?? [];
		const out = new Map<number, LapPaint>();
		for (const stint of stints) {
			const lapsInStint = stint.laps ?? [];
			let fastestMs = Infinity;
			for (const l of lapsInStint) {
				const ms = l.lastLaptimeMs ?? null;
				if (ms != null && ms > 0 && ms < fastestMs) fastestMs = ms;
			}
			for (let i = 0; i < lapsInStint.length; i++) {
				const l = lapsInStint[i]!;
				const ms = l.lastLaptimeMs ?? null;
				const prevMs = i > 0 ? (lapsInStint[i - 1]?.lastLaptimeMs ?? null) : null;
				let paint: LapPaint = "yellow";
				if (ms != null && ms > 0 && ms === fastestMs) paint = "purple";
				else if (i > 0 && ms != null && ms > 0 && prevMs != null && prevMs > 0 && ms < prevMs) paint = "green";
				out.set(l.lap, paint);
			}
		}
		return out;
	}, [selectedNr, stintsMap]);

	const selectedDriverTla = useMemo(() => {
		if (!selectedNr || !drivers) return null;
		return drivers[selectedNr]?.Tla ?? selectedNr;
	}, [selectedNr, drivers]);

	// Auto-select leader
	useEffect(() => {
		if (!driversTiming) return;
		if (selectedNr && driversTiming.Lines[selectedNr]) return;
		const leader = Object.values(driversTiming.Lines).sort(sortPos)[0];
		if (leader) setSelectedNr(leader.RacingNumber);
	}, [driversTiming, selectedNr]);

	return (
		<div className="flex h-full flex-col overflow-hidden">
			{/* Top bar */}
			<div className="flex shrink-0 items-center gap-3 border-b border-zinc-800 px-3 py-2">
				<DataAvailability />

				{/* Session picker */}
				<select
					className="ml-2 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white"
					value={selectedSessionId ?? ""}
					onChange={(e) => {
						const v = e.target.value;
						if (v) setSelectedSessionId(v);
					}}
				>
					<option value="">— session —</option>
					{sessions.map((s) => (
						<option key={s.id} value={s.id}>
							{formatSessionLabel(s)}
						</option>
					))}
				</select>
				{loadStatus === "loading" && <span className="text-xs text-zinc-500">Loading…</span>}
				{loadStatus === "error" && (
					<span className="text-xs text-red-400">Failed to load session data</span>
				)}

				<div className="flex-1" />

				{/* Laps panel toggle */}
				<button
					type="button"
					onClick={() => setLapsOpen((v) => !v)}
					className={clsx(
						"rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
						lapsOpen
							? "border-zinc-600 bg-zinc-800 text-white"
							: "border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-white",
					)}
				>
					{lapsOpen ? "Hide laps" : "Show laps"}
				</button>

				{/* Analysis panel toggle */}
				<button
					type="button"
					onClick={() => setAnalysisOpen((v) => !v)}
					className={clsx(
						"rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
						analysisOpen
							? "border-zinc-600 bg-zinc-800 text-white"
							: "border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-white",
					)}
				>
					{analysisOpen ? "Hide analysis" : "Show analysis"}
				</button>
			</div>

			{/* Body */}
			<div className="flex min-h-0 flex-1 flex-col-reverse md:flex-row">
				{/* Driver list — fills all remaining horizontal space */}
				<div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-y-auto border-zinc-800 md:h-full md:rounded-lg md:border md:p-2">
					{/* Timeline scale selector */}
					{drivers && driversTiming && timelineStart && timelineEnd && (
						<div className="flex shrink-0 flex-col gap-1.5 py-1">
							<div className="flex flex-wrap items-center gap-2">
								<span className="text-xs text-zinc-500">Timeline scale:</span>
								<select
									value={timelineScale}
									onChange={(e) => {
										setTimelineScale(e.target.value as TimelineScale);
										setTimelineWindowOffset(0);
									}}
									className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white"
								>
									<option value="auto">Automatic (first–last lap)</option>
									<option value="1h">1 hour</option>
									<option value="2h">2 hours</option>
									<option value="4h">4 hours</option>
									<option value="8h">8 hours</option>
									<option value="12h">12 hours</option>
								</select>

								<span className="ml-2 text-xs text-zinc-500">Paint:</span>
								<select
									value={lapPaintMode}
									onChange={(e) => setLapPaintMode(e.target.value as LapPaintMode)}
									className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white"
								>
									<option value="global">Global (session best / personal best)</option>
									<option value="stint">Stint based</option>
								</select>
							</div>
							{timelineScale !== "auto" &&
								lapSpanStart &&
								lapSpanEnd && (() => {
									const fullMs =
										lapSpanEnd.getTime() - lapSpanStart.getTime();
									const scaleMs = TIMELINE_SCALE_MS[timelineScale];
									const canScroll = fullMs > scaleMs;
									if (!canScroll) return null;
									return (
										<div className="flex items-center gap-2">
											<span className="text-xs text-zinc-500 shrink-0">
												Navigate:
											</span>
											<Slider
												className="max-w-[200px]"
												value={Math.round(timelineWindowOffset * 100)}
												setValue={(v) => setTimelineWindowOffset(Math.max(0, Math.min(1, v / 100)))}
											/>
											<span className="text-[10px] tabular-nums text-zinc-500 shrink-0">
												{formatTimeAxisWithSeconds(timelineStart)} – {formatTimeAxisWithSeconds(timelineEnd)}
											</span>
										</div>
									);
								})()}
						</div>
					)}

					{/* Time axis: 4 time labels + current time vertical line */}
					{drivers && driversTiming && timelineStart && timelineEnd && (
						<div
							className="grid shrink-0 items-center gap-2 py-0.5"
							style={{ gridTemplateColumns: "5.5rem 3.5rem 4rem 5rem 5rem 4rem 4rem 1fr" }}
						>
							<div className="col-span-7" />
							<div className="relative h-5 w-full">
								{[0, 1 / 3, 2 / 3, 1].map((t) => {
									const tMs = timelineStart.getTime() + t * timelineDurationMs;
									return (
										<span
											key={t}
											className="absolute top-0 text-[10px] tabular-nums text-zinc-500"
											style={{
												left: `${t * 100}%`,
												transform: "translateX(-50%)",
											}}
										>
											{formatTimeAxis(new Date(tMs))}
										</span>
									);
								})}
								{currentTimePct != null && currentTimePct >= 0 && currentTimePct <= 100 && (
									<div
										className="absolute top-0 bottom-0 w-0.5 bg-cyan-400/90 pointer-events-none"
										style={{ left: `${currentTimePct}%`, transform: "translateX(-50%)" }}
										title={formatTimeOfDay(new Date(currentTimeMs).toISOString())}
									/>
								)}
							</div>
						</div>
					)}

					{(!drivers || !driversTiming) &&
						new Array(20)
							.fill("")
							.map((_, i) => (
								<SkeletonDriver
									key={`driver.loading.${i}`}
									sessionStart={sessionStart}
									sessionEnd={sessionEnd}
								/>
							))}

					{drivers && driversTiming && (
						<AnimatePresence>
							{Object.values(driversTiming.Lines)
								.sort(sortPos)
								.map((timingDriver, index) => (
									<StintGraphDriver
										key={`stintgraph.driver.${timingDriver.RacingNumber}`}
										position={index + 1}
										driver={drivers[timingDriver.RacingNumber]}
										timingDriver={timingDriver}
										selected={timingDriver.RacingNumber === selectedNr}
										onSelect={() => {
											setSelectedNr(timingDriver.RacingNumber);
											setLapsOpen(true);
										}}
										driverLaps={lapsByDriverNr.get(Number(timingDriver.RacingNumber)) ?? []}
										stintsMap={stintsMap}
										timelineStart={timelineStart}
										timelineEnd={timelineEnd}
										currentTimePct={currentTimePct}
										shiftDown={shiftDown}
										lapPaintMode={lapPaintMode}
										globalLapPaint={globalLapPaint}
										selectedStintKeys={selectedStintKeys}
										onToggleStint={toggleStintSelection}
									/>
								))}
						</AnimatePresence>
					)}
				</div>

				{/* Foldable Stint Analysis panel (resizable width via left edge) */}
				<AnimatePresence initial={false}>
					{analysisOpen && (
						<motion.div
							key="analysis-panel"
							initial={{ width: 0, opacity: 0 }}
							animate={{ width: analysisPanelWidth, opacity: 1 }}
							exit={{ width: 0, opacity: 0 }}
							transition={{ duration: 0.2, ease: "easeInOut" }}
							className="relative shrink-0 overflow-hidden border-l border-zinc-800"
						>
							{/* Resize handle: drag left edge to change panel width */}
							<div
								role="separator"
								aria-label="Resize panel"
								className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize border-l border-transparent hover:border-cyan-500/50 hover:bg-cyan-500/10"
								onMouseDown={startResizeWidth}
							/>
							<div
								className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 pl-4"
								style={{ width: analysisPanelWidth }}
							>
								<span className="shrink-0 text-sm font-medium text-zinc-300">Stint analysis</span>
								<div ref={analysisPanelContentRef} className="min-h-0 flex-1 overflow-hidden">
									<StintAnalysisPanel
										laps={laps}
										stintsMap={stintsMap}
										height={analysisContentHeight}
										selectedStintKeys={selectedStintKeys}
										onToggleStint={toggleStintSelection}
										sessionEnded={sessionEnded}
									/>
								</div>
							</div>
						</motion.div>
					)}
				</AnimatePresence>

				{/* Selected driver laps panel (resizable width via left edge) */}
				<AnimatePresence initial={false}>
					{lapsOpen && (
						<motion.div
							key="laps-panel"
							initial={{ width: 0, opacity: 0 }}
							animate={{ width: lapsPanelWidth, opacity: 1 }}
							exit={{ width: 0, opacity: 0 }}
							transition={{ duration: 0.2, ease: "easeInOut" }}
							className="relative shrink-0 overflow-hidden border-l border-zinc-800"
						>
							{/* Resize handle: drag left edge to change panel width */}
							<div
								role="separator"
								aria-label="Resize laps panel"
								className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize border-l border-transparent hover:border-cyan-500/50 hover:bg-cyan-500/10"
								onMouseDown={startResizeLapsWidth}
							/>
							<div
								className="flex h-full min-h-0 flex-col gap-2 overflow-hidden p-3 pl-4"
								style={{ width: lapsPanelWidth }}
							>
								{selectedNr && selectedDriverTla ? (
									<>
										<span className="shrink-0 text-sm font-medium text-zinc-300">
											Laps for {selectedDriverTla}
										</span>
										<div className="min-h-0 flex-1 overflow-y-auto rounded border border-zinc-800 bg-zinc-900/80">
											<table className="w-full border-collapse text-xs tabular-nums">
												<thead className="sticky top-0 bg-zinc-900">
													<tr className="border-b border-zinc-700 text-left text-zinc-500">
														<th className="py-1.5 pr-2 pl-2" title="Lap status">
															<span className="sr-only">Status</span>
														</th>
														<th className="py-1.5 pr-2">Lap</th>
														<th className="py-1.5 pr-2">Stint</th>
														<th className="py-1.5 pr-2">Time of day</th>
														<th className="py-1.5 pr-2 text-right">Lap time</th>
													</tr>
												</thead>
												<tbody>
													{selectedDriverLaps.length === 0 ? (
														<tr>
															<td colSpan={5} className="py-2 pl-2 text-zinc-500">
																No lap data for this session.
															</td>
														</tr>
													) : (
														selectedDriverLaps.map((lap) => {
															const stintIdx = lapToStintIndex.get(lap.lap) ?? null; // 1-based
															const lapRole = selectedDriverLapRole.get(lap.lap);
															// Distinct background per stint so stints are easy to tell apart
															const STINT_BG = [
																"bg-zinc-800/50",
																"bg-sky-900/25",
																"bg-emerald-900/25",
																"bg-amber-900/25",
																"bg-violet-900/25",
																"bg-rose-900/25",
															] as const;
															const stintBgClass =
																stintIdx != null ? STINT_BG[(stintIdx - 1) % STINT_BG.length] : "";
															const driverNr = Number(selectedNr);
															const isLastStintForDriver =
																stintIdx != null && lastStintIndexByDriver.get(driverNr) === stintIdx - 1;
															const stintIsLive = isLastStintForDriver && !sessionEnded;
															const paint =
																lapPaintMode === "global"
																	? globalLapPaint.get(`${driverNr}-${lap.lap}`)
																	: selectedDriverStintLapPaint.get(lap.lap);
															const ledColor = lapRole ? IN_OUT_LAP_COLOR : (paint ? LAP_PAINT_COLORS[paint] : "#52525b");
															const ledTitle =
																lapRole === "in"
																	? "In-lap (pitted)"
																	: lapRole === "out"
																		? "Out-lap (after pit)"
																		: lapPaintMode === "global"
																			? paint === "purple"
																				? "Overall best so far"
																				: paint === "green"
																					? "Personal best so far"
																					: "Normal lap"
																			: paint === "purple"
																				? "Fastest in stint"
																				: paint === "green"
																					? "Faster than previous lap"
																					: "Normal lap";
															return (
																<tr
																	key={`${lap.lap}-${lap.time}`}
																	className={clsx(
																		"border-b border-zinc-800/80 hover:bg-white/[0.04]",
																		stintBgClass,
																	)}
																>
																	<td className="py-1 pr-2 pl-2">
																		<span
																			className="inline-block h-2 w-2 rounded-full"
																			style={{ backgroundColor: ledColor }}
																			title={ledTitle}
																		/>
																	</td>
																	<td className="py-1 pr-2 font-medium text-zinc-200">
																		{lap.lap}
																		{lapRole && (
																			<span className="ml-1 text-[10px] font-normal text-sky-400" title={ledTitle}>
																				({lapRole === "in" ? "In" : "Out"})
																			</span>
																		)}
																	</td>
																	<td className="py-1 pr-2 text-zinc-400">
																		{stintIdx != null ? (
																			<>
																				S{stintIdx}
																				{stintIsLive && (
																					<span className="ml-1 text-[10px] text-emerald-400" title="Stint ongoing">Live</span>
																				)}
																				{isLastStintForDriver && sessionEnded && (
																					<span className="ml-1 text-[10px] text-zinc-500" title="Stint finished">Finished</span>
																				)}
																			</>
																		) : "—"}
																	</td>
																	<td className="py-1 pr-2 text-zinc-400">
																		{lap.time ? formatTimeOfDay(lap.time) : "—"}
																	</td>
																	<td className="py-1 pr-2 text-right text-zinc-300">
																		{lap.lastLaptimeMs != null && lap.lastLaptimeMs > 0
																			? formatMs(lap.lastLaptimeMs)
																			: "—"}
																	</td>
																</tr>
															);
														})
													)}
												</tbody>
											</table>
										</div>
									</>
								) : (
									<div className="flex h-full items-center justify-center text-xs text-zinc-500">
										Select a driver to view laps.
									</div>
								)}
							</div>
						</motion.div>
					)}
				</AnimatePresence>
			</div>
		</div>
	);
}

// ── StintGraphDriver ──────────────────────────────────────────────────────────

type StintGraphDriverProps = {
	position: number;
	driver: Driver;
	timingDriver: TimingDataDriver;
	selected: boolean;
	onSelect: () => void;
	driverLaps: ReviewLap[];
	stintsMap: Map<number, DetectedStint[]>;
	timelineStart: Date | null;
	timelineEnd: Date | null;
	currentTimePct: number | null;
	shiftDown: boolean;
	lapPaintMode: LapPaintMode;
	globalLapPaint: Map<string, LapPaint>;
	selectedStintKeys: Set<string>;
	onToggleStint: (driverNr: number, stintIndex: number) => void;
};

const hasDRS = (drs: number) => drs > 9;
const possibleDRS = (drs: number) => drs === 8;

const inDangerZone = (position: number, sessionPart: number) => {
	switch (sessionPart) {
		case 1:
			return position > 15;
		case 2:
			return position > 10;
		case 3:
		default:
			return false;
	}
};

const StintGraphDriver = ({
	position,
	driver,
	timingDriver,
	selected,
	onSelect,
	driverLaps,
	stintsMap,
	timelineStart,
	timelineEnd,
	currentTimePct,
	shiftDown,
	lapPaintMode,
	globalLapPaint,
	selectedStintKeys,
	onToggleStint,
}: StintGraphDriverProps) => {
	const sessionPart = useDataStore((state) => state.state?.TimingData?.SessionPart);
	const timingStatsDriver = useDataStore(
		(state) => state.state?.TimingStats?.Lines[driver.RacingNumber],
	);
	const appTimingDriver = useDataStore(
		(state) => state.state?.TimingAppData?.Lines[driver.RacingNumber],
	);
	const hasFastest = timingStatsDriver?.PersonalBestLapTime.Position == 1;

	const driverNr = Number(driver.RacingNumber);
	const driverStints = stintsMap.get(driverNr) ?? [];
	const reviewCompound =
		driverStints.length > 0 ? driverStints[driverStints.length - 1]!.compound : null;
	const liveCompound =
		appTimingDriver?.Stints && appTimingDriver.Stints.length > 0
			? (appTimingDriver.Stints[appTimingDriver.Stints.length - 1]!.Compound ?? null)
			: null;
	const compoundBadge = compoundToBadge(liveCompound ?? reviewCompound);
	const totalLaps = timingDriver.NumberOfLaps;

	const carData = useDataStore((state) =>
		state?.carsData ? state.carsData[driver.RacingNumber].Channels : undefined,
	);

	const favoriteDriver = useSettingsStore((state) =>
		state.favoriteDrivers.includes(driver.RacingNumber),
	);
	const backgroundColor = darkenTeamColor(driver.TeamColour);

	return (
		<motion.button
			type="button"
			onClick={onSelect}
			whileHover={{ scale: 1.01 }}
			whileTap={{ scale: 0.99 }}
			layout="position"
			aria-pressed={selected}
			className={clsx(
				"flex w-full cursor-pointer flex-col gap-0.5 rounded-lg p-1.5 text-left transition-colors select-none",
				{
					"opacity-50":
						timingDriver.KnockedOut || timingDriver.Retired || timingDriver.Stopped,
					"ring-1 ring-sky-400/60": favoriteDriver,
					"ring-2 ring-violet-400/60": hasFastest,
					"ring-2 ring-red-500/70":
						sessionPart != undefined && inDangerZone(position, sessionPart),
					"ring-2 ring-white/35": selected,
				},
			)}
			style={{ backgroundColor }}
		>
			<div
				className="grid items-center gap-2"
				style={{ gridTemplateColumns: "5.5rem 3.5rem 4rem 5rem 5rem 4rem 4rem 1fr" }}
			>
				<DriverTag
					className="min-w-full!"
					short={driver.Tla}
					teamColor={driver.TeamColour}
					position={position}
				/>
				<DriverDRS
					on={carData ? hasDRS(carData[45] ?? 0) : false}
					possible={carData ? possibleDRS(carData[45] ?? 0) : false}
					inPit={timingDriver.InPit}
					pitOut={timingDriver.PitOut}
				/>
				<DriverInfo
					timingDriver={timingDriver}
					gridPos={appTimingDriver ? parseInt(appTimingDriver.GridPos) : 0}
				/>
				<DriverGap timingDriver={timingDriver} sessionPart={sessionPart} />
				<DriverLapTime
					last={timingDriver.LastLapTime}
					best={timingDriver.BestLapTime}
					hasFastest={hasFastest}
					inPit={timingDriver.InPit}
				/>
				{(() => {
					// Current stint laps: live TimingAppData preferred, fallback to detected review stints.
					const liveCurrentStintLaps =
						appTimingDriver?.Stints && appTimingDriver.Stints.length > 0
							? appTimingDriver.Stints[appTimingDriver.Stints.length - 1]?.TotalLaps
							: undefined;
					const reviewCurrentStintLaps =
						driverStints.length > 0 ? driverStints[driverStints.length - 1]!.laps.length : 0;
					const currentStintLaps = liveCurrentStintLaps ?? reviewCurrentStintLaps;

					// Best lap position within its stint (lap-in-stint / total laps in that stint)
					let pbText = "—";
					let bestLapNr: number | null = null;
					let bestMs = Infinity;
					for (const l of driverLaps) {
						const ms = l.lastLaptimeMs ?? null;
						if (ms != null && ms > 0 && ms < bestMs) {
							bestMs = ms;
							bestLapNr = l.lap;
						}
					}
					if (bestLapNr != null && driverStints.length > 0) {
						for (const stint of driverStints) {
							const idx = stint.laps.findIndex((l) => l.lap === bestLapNr);
							if (idx !== -1) {
								pbText = `${idx + 1}/${stint.laps.length}`;
								break;
							}
						}
					}

					return (
						<div className="place-self-start">
							<p className="text-lg leading-none font-medium tabular-nums text-zinc-200">
								{currentStintLaps ?? 0}L
							</p>
							<p className="mt-0.5 text-[10px] font-semibold tabular-nums text-zinc-400" title="Best lap position in stint">
								PB {pbText}
							</p>
						</div>
					);
				})()}
				<div className="place-self-start">
					<p className="text-lg leading-none font-medium tabular-nums text-zinc-200">{totalLaps}L</p>
					<p
						className={clsx(
							"mt-0.5 inline-flex w-fit items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
							compoundBadge.className,
						)}
						title={compoundBadge.title}
					>
						{compoundBadge.label}
					</p>
				</div>
				<div className="relative self-center w-full">
					<DriverTimeline
						driverNr={driverNr}
						driverLaps={driverLaps}
						stintsMap={stintsMap}
						timelineStart={timelineStart}
						timelineEnd={timelineEnd}
						shiftDown={shiftDown}
						lapPaintMode={lapPaintMode}
						globalLapPaint={globalLapPaint}
						selectedStintKeys={selectedStintKeys}
						onToggleStint={onToggleStint}
					/>
					{/* Current time vertical line (same position in every row) */}
					{currentTimePct != null && currentTimePct >= 0 && currentTimePct <= 100 && (
						<div
							className="absolute top-0 bottom-0 w-0.5 bg-cyan-400/90 pointer-events-none z-[1]"
							style={{ left: `${currentTimePct}%`, transform: "translateX(-50%)" }}
						/>
					)}
				</div>
			</div>
		</motion.button>
	);
};

// ── SkeletonDriver ────────────────────────────────────────────────────────────

type SkeletonDriverProps = {
	sessionStart: Date | null;
	sessionEnd: Date | null;
};

const SkeletonDriver = ({ sessionStart: _s, sessionEnd: _e }: SkeletonDriverProps) => {
	const animateClass = "h-8 animate-pulse rounded-md bg-zinc-800";

	return (
		<div className="flex w-full flex-col gap-0.5 rounded-lg p-1.5">
			<div
				className="grid items-center gap-2"
				style={{ gridTemplateColumns: "5.5rem 3.5rem 4rem 5rem 5rem 4rem 4rem 1fr" }}
			>
				<div className={animateClass} style={{ width: "100%" }} />
				<div className={animateClass} style={{ width: "90%" }} />
				{new Array(2).fill(null).map((_, index) => (
					<div className="flex w-full flex-col gap-1" key={`skeleton.${index}`}>
						<div className={clsx(animateClass, "h-4!")} />
						<div className={clsx(animateClass, "h-3! w-2/3")} />
					</div>
				))}
				<div className="flex w-full flex-col gap-1">
					<div className={clsx(animateClass, "h-3! w-4/5")} />
					<div className={clsx(animateClass, "h-4!")} />
				</div>
				<div className="flex w-full flex-col gap-1">
					<div className={clsx(animateClass, "h-3! w-2/3")} />
					<div className={clsx(animateClass, "h-4! w-1/2")} />
				</div>
				<div className="flex w-full flex-col gap-1">
					<div className={clsx(animateClass, "h-3! w-1/2")} />
					<div className={clsx(animateClass, "h-4! w-3/5")} />
				</div>
				<div className="h-4 w-full animate-pulse rounded bg-zinc-800/60" />
			</div>
		</div>
	);
};
