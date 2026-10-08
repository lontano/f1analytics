"use client";

import { useEffect, useRef } from "react";
import { useReviewStore } from "@/stores/useReviewStore";

const SPEED_OPTIONS = [0.5, 1, 2, 5, 10];
const TICK_MS = 100;

export default function ReviewPlaybackBar() {
	const alignedLap = useReviewStore((s) => s.alignedLap);
	const maxAlignedLap = useReviewStore((s) => s.maxAlignedLap);
	const playing = useReviewStore((s) => s.playing);
	const speed = useReviewStore((s) => s.speed);
	const seekLap = useReviewStore((s) => s.seekLap);
	const play = useReviewStore((s) => s.play);
	const pause = useReviewStore((s) => s.pause);
	const setSpeed = useReviewStore((s) => s.setSpeed);
	const tick = useReviewStore((s) => s.tick);

	const lastTickRef = useRef(0);

	useEffect(() => {
		if (!playing) return;
		const id = setInterval(() => {
			const now = performance.now();
			const elapsed = lastTickRef.current ? now - lastTickRef.current : 0;
			lastTickRef.current = now;
			tick(elapsed);
		}, TICK_MS);
		return () => {
			clearInterval(id);
			lastTickRef.current = 0;
		};
	}, [playing, tick]);

	const hasSelection = maxAlignedLap >= 0;

	return (
		<div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
			<button
				type="button"
				onClick={() => (playing ? pause() : play())}
				disabled={!hasSelection}
				className="rounded-md bg-zinc-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-600 disabled:opacity-50"
			>
				{playing ? "Pause" : "Play"}
			</button>
			<div className="flex items-center gap-2">
				<span className="text-xs text-zinc-400">Speed</span>
				<select
					value={speed}
					onChange={(e) => setSpeed(Number(e.target.value))}
					className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-white"
				>
					{SPEED_OPTIONS.map((s) => (
						<option key={s} value={s}>
							{s}x
						</option>
					))}
				</select>
			</div>
			<div className="flex flex-1 min-w-[120px] items-center gap-2">
				<span className="w-16 shrink-0 text-right text-xs tabular-nums text-zinc-400">
					Lap {alignedLap + 1}
				</span>
				<input
					type="range"
					min={0}
					max={Math.max(0, maxAlignedLap)}
					value={alignedLap}
					onChange={(e) => seekLap(Number(e.target.value))}
					disabled={!hasSelection}
					className="h-2 flex-1 appearance-none rounded-full bg-zinc-700 disabled:opacity-50 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
				/>
				<span className="w-12 shrink-0 text-xs tabular-nums text-zinc-500">
					/{maxAlignedLap + 1}
				</span>
			</div>
		</div>
	);
}
