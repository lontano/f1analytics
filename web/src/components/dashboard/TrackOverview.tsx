"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

import type { TimingDataDriver } from "@/types/state.type";

import { asArray } from "@/lib/merge";

import { useDataStore } from "@/stores/useDataStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

const countSegments = (sectors: { Segments?: unknown[] }[]) =>
	sectors.reduce((acc, s) => acc + (asArray(s.Segments).length), 0);

const currentSegmentIndex = (sectors: { Segments?: { Status?: number }[] }[]): number => {
	const all = sectors.flatMap((s) => asArray(s.Segments));
	for (let i = all.length - 1; i >= 0; i--) {
		if ((all[i]?.Status ?? 0) !== 0) return i;
	}
	return 0;
};

const mapIndexFloat = (idx: number, fromTotal: number, toTotal: number): number => {
	if (toTotal <= 1 || fromTotal <= 1) return 0;
	const ratio = idx / (fromTotal - 1);
	return Math.min(toTotal - 1, Math.max(0, ratio * (toTotal - 1)));
};

type Props = {
	selectedNr: string | null;
	totalSegments: number;
	/** Segment index at which S1 ends, S2 ends (so ticks between S1/S2 and S2/S3) */
	sectorEndSegments?: [number, number];
	getSmoothedIndex?: ((driverNr: string) => number | null) | null;
	smoothEnabled?: boolean;
	driverSize?: number;
	onSelectDriver?: (nr: string | null) => void;
};

const LINE_HEIGHT = 48;
const SVG_HEIGHT = LINE_HEIGHT + 20;

export default function TrackOverview({
	selectedNr,
	totalSegments,
	sectorEndSegments = [0, 0],
	getSmoothedIndex = null,
	smoothEnabled = false,
	driverSize = 2,
	onSelectDriver,
}: Props) {
	const favoriteDrivers = useSettingsStore((state) => state.favoriteDrivers);
	const drivers = useDataStore((state) => state?.state?.DriverList);
	const timingDrivers = useDataStore((state) => state?.state?.TimingData);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [containerWidth, setContainerWidth] = useState<number>(400);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;

		const updateWidth = () => {
			const next = Math.max(280, Math.floor(el.clientWidth));
			setContainerWidth((prev) => (prev === next ? prev : next));
		};

		updateWidth();

		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => updateWidth());
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const lineDrivers = useMemo(() => {
		if (!timingDrivers?.Lines || !drivers || totalSegments <= 0) return [];

		return Object.values(timingDrivers.Lines)
			.filter(
				(d) =>
					!d.KnockedOut &&
					!d.Stopped &&
					!d.Retired,
			)
			.map((d) => {
				const info = drivers[d.RacingNumber];
				if (!info) return null;

				const othTotal = countSegments(d.Sectors ?? []);
				const othIdx = currentSegmentIndex(d.Sectors ?? []);
				const baseTotal = Math.max(totalSegments, 1);

				let positionRatio: number;
				if (
					smoothEnabled &&
					getSmoothedIndex &&
					getSmoothedIndex(d.RacingNumber) !== null
				) {
					const fracIdx = getSmoothedIndex(d.RacingNumber)!;
					const inferredFromTotal = Math.max(othTotal, baseTotal, Math.floor(fracIdx) + 1, 1);
					const mapped = mapIndexFloat(fracIdx, inferredFromTotal, baseTotal);
					positionRatio = mapped / Math.max(baseTotal - 1, 1);
				} else {
					const mapped = mapIndexFloat(othIdx, Math.max(othTotal, 1), baseTotal);
					positionRatio = mapped / Math.max(baseTotal - 1, 1);
				}

				return {
					nr: d.RacingNumber,
					tla: info.Tla,
					teamColor: info.TeamColour,
					positionRatio: Math.max(0, Math.min(1, positionRatio)),
				};
			})
			.filter(Boolean) as {
			nr: string;
			tla: string;
			teamColor: string;
			positionRatio: number;
		}[];
	}, [drivers, getSmoothedIndex, smoothEnabled, timingDrivers, totalSegments]);

	if (totalSegments <= 0) {
		return (
			<div className="flex min-h-[80px] w-full items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950">
				<div className="text-xs text-zinc-500">No segment data</div>
			</div>
		);
	}

	const width = Math.max(280, containerWidth);
	const centerY = LINE_HEIGHT / 2;
	const driverDotR = driverSize;
	const edgePad = Math.max(2, driverDotR + 2);
	const labelOffset = Math.max(12, driverDotR + 8);
	const textSize = Math.max(7, Math.round(driverDotR * 1.4));

	const toX = (ratio: number) => edgePad + ratio * (width - edgePad * 2);

	const s1End = sectorEndSegments[0] ?? 0;
	const s2End = sectorEndSegments[1] ?? 0;
	const sector1X = toX(s1End / Math.max(totalSegments - 1, 1));
	const sector2X = toX(s2End / Math.max(totalSegments - 1, 1));

	return (
		<div className="flex h-full min-h-0 w-full flex-col rounded-lg border border-zinc-800 bg-zinc-950 p-2">
			<div className="mb-1 text-xs font-medium text-zinc-400">Track analysis</div>
			<div ref={containerRef} className="relative flex min-h-[72px] flex-1 items-center">
				<svg
					viewBox={`0 0 ${width} ${SVG_HEIGHT}`}
					className="h-[88px] w-full"
					preserveAspectRatio="xMidYMid meet"
				>
					{/* Lap line: left = start, right = end */}
					<line
						x1={edgePad}
						y1={centerY}
						x2={width - edgePad}
						y2={centerY}
						className="stroke-zinc-700"
						strokeWidth={3}
						strokeLinecap="round"
					/>

					{/* Sector boundaries */}
					{s1End > 0 && (
						<line
							x1={sector1X}
							y1={centerY - 12}
							x2={sector1X}
							y2={centerY + 12}
							className="stroke-zinc-500"
							strokeWidth={2}
							strokeDasharray="3 2"
						/>
					)}
					{s2End > 0 && s2End !== s1End && (
						<line
							x1={sector2X}
							y1={centerY - 12}
							x2={sector2X}
							y2={centerY + 12}
							className="stroke-zinc-500"
							strokeWidth={2}
							strokeDasharray="3 2"
						/>
					)}

					{/* Sector labels */}
					<text
						x={edgePad}
						y={centerY - 16}
						className="fill-zinc-500"
						fontSize={9}
						fontWeight={600}
					>
						Start
					</text>
					<text
						x={width - edgePad}
						y={centerY - 16}
						textAnchor="end"
						className="fill-zinc-500"
						fontSize={9}
						fontWeight={600}
					>
						End
					</text>
					{s1End > 0 && (
						<text
							x={sector1X}
							y={centerY - 16}
							textAnchor="middle"
							className="fill-zinc-500"
							fontSize={8}
						>
							S1
						</text>
					)}
					{s2End > 0 && s2End !== s1End && (
						<text
							x={sector2X}
							y={centerY - 16}
							textAnchor="middle"
							className="fill-zinc-500"
							fontSize={8}
						>
							S2
						</text>
					)}

					{/* Driver markers */}
					{lineDrivers.map((d) => {
						const x = toX(d.positionRatio);
						const isSelected = d.nr === selectedNr;
						const isFavorite = favoriteDrivers.includes(d.nr);
						const fillStyle = d.teamColor
							? { fill: `#${d.teamColor}` }
							: { fill: "#71717a" };
						const handleClick = () => {
							if (onSelectDriver) onSelectDriver(isSelected ? null : d.nr);
						};
						return (
							<g
								key={`lapline.driver.${d.nr}`}
								onClick={handleClick}
								onKeyDown={(e) => e.key === "Enter" && handleClick()}
								role="button"
								tabIndex={0}
								className="cursor-pointer"
								style={{
									transform: `translate(${x}px, ${centerY}px)`,
									...(smoothEnabled ? {} : { transition: "transform 400ms ease-out" }),
								}}
							>
								<circle
									cx={0}
									cy={0}
									r={Math.max(driverDotR + 6, 18)}
									fill="transparent"
								/>
								{isSelected && (
									<circle
										cx={0}
										cy={0}
										r={driverDotR + 5}
										className="stroke-white fill-transparent"
										strokeWidth={2.5}
									/>
								)}
								{isFavorite && !isSelected && (
									<circle
										cx={0}
										cy={0}
										r={driverDotR + 4}
										className="stroke-sky-400 fill-transparent"
										strokeWidth={2}
									/>
								)}
								<circle
									cx={0}
									cy={0}
									r={driverDotR}
									className={clsx(!d.teamColor && "fill-zinc-600")}
									style={{ ...fillStyle, stroke: "#0a0a0a", strokeWidth: 1 }}
								/>
								<text
									x={0}
									y={labelOffset}
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
			</div>
		</div>
	);
}
