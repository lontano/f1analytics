"use client";

import Link from "@/compat/link";
import clsx from "clsx";

import { useReplayStore } from "@/stores/useReplayStore";
import type { TrackStatusSegment } from "@/stores/useReplayStore";
import { useDataStore } from "@/stores/useDataStore";

import Button from "@/components/ui/Button";
import PlayControls from "@/components/ui/PlayControls";

const STATUS_COLORS: Record<number, string> = {
	1: "#22c55e",
	2: "#fbbf24",
	3: "#fbbf24",
	4: "#fbbf24",
	5: "#ef4444",
	6: "#fbbf24",
	7: "#fbbf24",
};

const fmt = (ms: number) => {
	const s = Math.max(0, Math.floor(ms / 1000));
	const hh = Math.floor(s / 3600);
	const mm = Math.floor((s % 3600) / 60);
	const ss = s % 60;
	if (hh > 0) return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
	return `${mm}:${String(ss).padStart(2, "0")}`;
};

const safeMs = (utc: string | null) => {
	if (!utc) return null;
	const ms = Date.parse(utc);
	return Number.isFinite(ms) ? ms : null;
};

export default function ReplayControlsBar() {
	const mode = useReplayStore((s) => s.mode);
	const status = useReplayStore((s) => s.status);
	const error = useReplayStore((s) => s.error);
	const sessionId = useReplayStore((s) => s.sessionId);

	const loadingProgress = useReplayStore((s) => s.loadingProgress);
	const startTime = useReplayStore((s) => s.startTime);
	const durationMs = useReplayStore((s) => s.durationMs);
	const currentMs = useReplayStore((s) => s.currentMs);

	const playing = useReplayStore((s) => s.playing);
	const speed = useReplayStore((s) => s.speed);

	const trackStatusTimeline = useReplayStore((s) => s.trackStatusTimeline);

	const setCurrentMs = useReplayStore((s) => s.setCurrentMs);
	const setPlaying = useReplayStore((s) => s.setPlaying);
	const setSpeed = useReplayStore((s) => s.setSpeed);
	const stopReplay = useReplayStore((s) => s.stopReplay);

	const setState = useDataStore((s) => s.setState);
	const setCarsData = useDataStore((s) => s.setCarsData);
	const setPositions = useDataStore((s) => s.setPositions);

	if (mode !== "replay") return null;

	const startAbs = safeMs(startTime);
	const absNow = startAbs !== null ? new Date(startAbs + currentMs).toISOString() : null;

	const ready = status === "ready" && durationMs > 0;
	const disabled = status !== "ready";

	return (
		<div className="w-full border-b border-zinc-800 bg-black/40 p-2 backdrop-blur-xs md:rounded-lg md:border">
			<div className="flex flex-col gap-2">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div className="flex items-center gap-2">
						<div className="text-sm font-semibold text-white">Replay</div>
						<Link className="text-xs text-zinc-400 hover:text-zinc-200" href="/dashboard/replay">
							{sessionId ? "change session" : "pick session"}
						</Link>
						{status === "loading" && <span className="text-xs text-zinc-400">{loadingProgress ?? "loading…"}</span>}
						{status === "error" && <span className="text-xs text-red-400">{error ?? "error"}</span>}
					</div>

					<div className="flex items-center gap-2">
						<Button
							className="bg-zinc-900! px-3! py-1.5!"
							onClick={() => {
								setPlaying(false);
								setState(null);
								setCarsData(null);
								setPositions(null);
								stopReplay();
							}}
						>
							Back to live
						</Button>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-3">
					<div className={clsx({ "opacity-50 pointer-events-none": disabled })}>
						<PlayControls playing={playing} onClick={() => setPlaying(!playing)} />
					</div>

					<select
						disabled={disabled}
						value={speed}
						onChange={(e) => setSpeed(parseFloat(e.target.value))}
						className={clsx(
							"rounded-lg bg-zinc-900 px-2 py-1 text-sm text-white",
							disabled && "opacity-50",
						)}
					>
						{[0.25, 0.5, 1, 2, 5, 10].map((v) => (
							<option key={v} value={v}>
								{v}x
							</option>
						))}
					</select>

					<div className="text-sm font-mono tabular-nums text-white">
						{fmt(currentMs)} / {fmt(durationMs)}
					</div>

					{absNow && <div className="text-xs font-mono text-zinc-400">{absNow}</div>}

					<div className="ml-auto flex gap-2">
						<Button
							className="bg-zinc-900! px-3! py-1.5!"
							onClick={() => {
								setPlaying(false);
								setCurrentMs(0);
							}}
						>
							Start
						</Button>
						<Button
							className="bg-zinc-900! px-3! py-1.5!"
							onClick={() => {
								setPlaying(false);
								setCurrentMs(durationMs);
							}}
						>
							End
						</Button>
					</div>
				</div>

				<div className="relative w-full">
					{durationMs > 0 && trackStatusTimeline.length > 0 && (
						<TrackStatusBar timeline={trackStatusTimeline} durationMs={durationMs} />
					)}
					<input
						className={clsx("relative z-10 w-full", !ready && "opacity-50")}
						type="range"
						min={0}
						max={Math.max(0, durationMs)}
						step={250}
						value={Math.min(currentMs, durationMs)}
						disabled={!ready}
						onChange={(e) => {
							setPlaying(false);
							setCurrentMs(parseInt(e.target.value));
						}}
					/>
				</div>
			</div>
		</div>
	);
}

function TrackStatusBar({
	timeline,
	durationMs,
}: {
	timeline: TrackStatusSegment[];
	durationMs: number;
}) {
	if (durationMs <= 0) return null;

	return (
		<div className="pointer-events-none absolute inset-x-0 top-1/2 flex h-2 -translate-y-1/2 overflow-hidden rounded-full">
			{timeline.map((seg, i) => {
				const left = (seg.startMs / durationMs) * 100;
				const width = ((seg.endMs - seg.startMs) / durationMs) * 100;
				const color = STATUS_COLORS[seg.status] ?? "#3f3f46";
				return (
					<div
						key={`ts.${i}`}
						className="absolute top-0 h-full"
						style={{
							left: `${left}%`,
							width: `${width}%`,
							backgroundColor: color,
							opacity: seg.status === 1 ? 0.25 : 0.5,
						}}
					/>
				);
			})}
		</div>
	);
}

