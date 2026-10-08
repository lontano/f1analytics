"use client";

import { useState } from "react";
import clsx from "clsx";

import type { Sector, TimingDataDriver } from "@/types/state.type";
import { classifyEstimatedLap, estimateCurrentLap, formatLapTimeMs, parseTimeMs } from "@/lib/lapModel";
import { useReferenceModel } from "@/hooks/useReferenceModel";
import { useSegmentWeightStore } from "@/stores/useSegmentWeightStore";
import { useInterval } from "@/hooks/useInterval";
import { useDataStore } from "@/stores/useDataStore";

type Props = {
	timingDriver: TimingDataDriver;
	/**
	 * Compact / track-map variant:
	 *  - hides the confidence dot
	 *  - removes all gaps between mini-sector LEDs
	 *  - adds a wide sector-summary bar above the mini LEDs
	 */
	compact?: boolean;
};

const CONFIDENCE_DOT: Record<string, string> = {
	high: "bg-emerald-500",
	medium: "bg-amber-400",
	low: "bg-zinc-500",
	none: "bg-zinc-700",
};

function miniLedClass(status: number | undefined): string {
	return clsx("h-[3px] w-[3px]", {
		"bg-amber-400": status === 2048 || status === 2052,
		"bg-emerald-500": status === 2049,
		"bg-violet-600": status === 2051,
		"bg-blue-500": status === 2064,
		"bg-zinc-700": !status || status === 0,
	});
}

function sectorBarClass(sector: Sector): string {
	if (sector.OverallFastest) return "bg-violet-600";
	if (sector.PersonalFastest) return "bg-emerald-500";
	if (sector.Value) return "bg-amber-400";
	return "bg-zinc-700";
}

function estimatedLapTextClass(tone: ReturnType<typeof classifyEstimatedLap>): string {
	return clsx({
		"text-zinc-400": tone === "none",
		"text-amber-400": tone === "normal",
		"text-emerald-500": tone === "personal",
		"text-violet-600": tone === "session",
	});
}

export default function DriverEstimatedLap({ timingDriver, compact = false }: Props) {
	const refModel = useReferenceModel();
	const timingStats = useDataStore((state) => state.state?.TimingStats);
	const segWeights = useSegmentWeightStore(
		(s) => s.drivers[timingDriver.RacingNumber]?.sectorWeights ?? null,
	);
	const crossingWallMs = useSegmentWeightStore(
		(s) => s.drivers[timingDriver.RacingNumber]?.crossingWallMs ?? null,
	);

	const [nowMs, setNowMs] = useState(() => Date.now());
	useInterval(() => setNowMs(Date.now()), 200);

	const result = estimateCurrentLap(timingDriver, refModel, segWeights, crossingWallMs, nowMs);
	const dotClass = CONFIDENCE_DOT[result.confidence] ?? CONFIDENCE_DOT.none;
	const sectors = timingDriver.Sectors ?? [];
	const personalBestMs = parseTimeMs(timingDriver.BestLapTime?.Value);
	const sessionBestMs = Object.values(timingStats?.Lines ?? {}).reduce<number | null>((best, line) => {
		const lapMs = parseTimeMs(line.PersonalBestLapTime?.Value);
		if (lapMs === null) return best;
		return best === null || lapMs < best ? lapMs : best;
	}, null);
	const estimatedTone = classifyEstimatedLap(result.ms, personalBestMs, sessionBestMs);

	return (
		<div className="place-self-start">
			{/* Time row */}
			<div className="flex items-center gap-1">
				<p className={clsx("text-lg leading-none font-medium italic tabular-nums", estimatedLapTextClass(estimatedTone))}>
					{result.ms !== null ? formatLapTimeMs(result.ms) : "-- ---"}
				</p>
				{!compact && result.ms !== null && (
					<span
						className={clsx("h-2 w-2 shrink-0 rounded-full", dotClass)}
						title={`Confidence: ${result.confidence}`}
					/>
				)}
			</div>

			{compact ? (
				<div className="mt-1 flex flex-col gap-[2px]">
					{/* Wide sector-summary bars — one per sector, width proportional to segment count */}
					<div className="flex gap-[2px]">
						{sectors.map((sector, si) => (
							<div
								key={`est.bar.${si}`}
								className={clsx("h-[4px] rounded-[1px]", sectorBarClass(sector))}
								style={{ flex: Math.max(sector.Segments?.length ?? 1, 1) }}
							/>
						))}
					</div>

					{/* Mini-sector LEDs — no gaps, sectors butted together */}
					<div className="flex">
						{sectors.map((sector, si) =>
							(sector.Segments ?? []).map((seg, j) => (
								<div key={`est.seg.${si}.${j}`} className={miniLedClass(seg.Status)} />
							)),
						)}
					</div>
				</div>
			) : (
				/* Default variant: small gaps between sectors */
				<div className="mt-1 flex items-center gap-[3px]">
					{sectors.map((sector, si) => (
						<div key={`est.sector.${si}`} className="flex items-center gap-[1px]">
							{(sector.Segments ?? []).map((seg, j) => (
								<div key={`est.seg.${si}.${j}`} className={miniLedClass(seg.Status)} />
							))}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
