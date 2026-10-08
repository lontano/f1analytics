"use client";

import { useReviewStore } from "@/stores/useReviewStore";

function formatLapTime(ms: number): string {
	const s = ms / 1000;
	if (s >= 60) {
		const m = Math.floor(s / 60);
		const sec = (s % 60).toFixed(3);
		return `${m}:${sec.padStart(6, "0")}`;
	}
	return `${s.toFixed(3)}s`;
}

function formatGap(ms: number): string {
	if (ms <= 0) return "—";
	if (ms >= 60000) return `+${(ms / 60000).toFixed(1)}m`;
	if (ms >= 1000) return `+${(ms / 1000).toFixed(2)}s`;
	return `+${ms}ms`;
}

export default function AlignedLeaderboard() {
	const getLeaderboardAtAlignedLap = useReviewStore((s) => s.getLeaderboardAtAlignedLap);
	const board = getLeaderboardAtAlignedLap();

	if (board.length === 0) {
		return (
			<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-center text-sm text-zinc-500">
				Select one or more stints above to see the aligned leaderboard.
			</div>
		);
	}

	return (
		<div className="overflow-x-auto rounded-lg border border-zinc-800">
			<table className="w-full min-w-[320px] text-left text-sm">
				<thead>
					<tr className="border-b border-zinc-800 bg-zinc-900/80">
						<th className="px-3 py-2 font-medium text-zinc-400">Pos</th>
						<th className="px-3 py-2 font-medium text-zinc-400">Driver</th>
						<th className="px-3 py-2 font-medium text-zinc-400">Lap time</th>
						<th className="px-3 py-2 font-medium text-zinc-400">Cumulative</th>
						<th className="px-3 py-2 font-medium text-zinc-400">Gap</th>
					</tr>
				</thead>
				<tbody>
					{board.map((row, pos) => (
						<tr
							key={`${row.driverNr}-${row.stintIndex}`}
							className="border-b border-zinc-800/80 hover:bg-zinc-800/30"
						>
							<td className="px-3 py-2 font-medium tabular-nums text-white">{pos + 1}</td>
							<td className="px-3 py-2 font-medium tabular-nums text-white">#{row.driverNr}</td>
							<td className="px-3 py-2 tabular-nums text-zinc-300">
								{row.lapTimeMs != null && row.lapTimeMs > 0
									? formatLapTime(row.lapTimeMs)
									: "—"}
							</td>
							<td className="px-3 py-2 tabular-nums text-zinc-300">
								{formatLapTime(row.cumulativeMs)}
							</td>
							<td className="px-3 py-2 tabular-nums text-zinc-400">
								{formatGap(row.gapMs)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
