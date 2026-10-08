"use client";

import clsx from "clsx";
import type { DetectedStint } from "@/types/review.type";
import { useReviewStore } from "@/stores/useReviewStore";

const COMPOUND_COLORS: Record<string, string> = {
	SOFT: "#ef4444",
	MEDIUM: "#facc15",
	HARD: "#78716c",
	INTERMEDIATE: "#22d3ee",
	WET: "#3b82f6",
	UNKNOWN: "#52525b",
};

export default function StintTimeline() {
	const drivers = useReviewStore((s) => s.drivers);
	const getStintsForDriver = useReviewStore((s) => s.getStintsForDriver);
	const selectedStints = useReviewStore((s) => s.selectedStints);
	const toggleStint = useReviewStore((s) => s.toggleStint);

	return (
		<div className="flex flex-col gap-2">
			<p className="text-xs font-medium text-zinc-400">Click a stint to align and compare</p>
			<div className="flex flex-col gap-3">
				{drivers.map((driverNr) => {
					const stints = getStintsForDriver(driverNr);
					if (stints.length === 0) return null;
					const totalLaps = Math.max(...stints.map((s) => s.laps.length), 1);
					return (
						<div key={driverNr} className="flex items-center gap-3">
							<span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums text-zinc-300">
								#{driverNr}
							</span>
							<div className="flex min-w-0 flex-1 gap-0.5">
								{stints.map((stint, stintIndex) => {
									const width = (stint.laps.length / totalLaps) * 100;
									const isSelected = selectedStints.some(
										(s) => s.driverNr === driverNr && s.stintIndex === stintIndex,
									);
									const color = COMPOUND_COLORS[stint.compound] ?? COMPOUND_COLORS.UNKNOWN;
									return (
										<button
											key={`${stint.startLap}-${stint.compound}`}
											type="button"
											onClick={() => toggleStint(driverNr, stintIndex)}
											className={clsx(
												"relative flex shrink-0 flex-col items-center justify-center rounded px-1 py-1.5 text-[10px] font-medium transition",
												isSelected
													? "ring-2 ring-white ring-offset-2 ring-offset-zinc-950"
													: "hover:opacity-90",
											)}
											style={{
												width: `${Math.max(width, 8)}%`,
												backgroundColor: color,
												color: stint.compound === "MEDIUM" || stint.compound === "HARD" ? "#18181b" : "#fff",
											}}
											title={`Laps ${stint.startLap}-${stint.endLap} · ${stint.compound} · ${stint.lapCount} laps`}
										>
											<span>{stint.compound}</span>
											{stint.isRaceSim && (
												<span className="absolute -top-1 right-0 rounded bg-amber-500 px-1 text-[9px] text-zinc-900">
													Race sim
												</span>
											)}
										</button>
									);
								})}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
