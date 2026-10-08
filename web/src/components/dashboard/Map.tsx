import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";

import type { PositionCar, TimingDataDriver } from "@/types/state.type";
import type { Map, TrackPosition } from "@/types/map.type";

import { fetchMap } from "@/lib/fetchMap";
import { asArray } from "@/lib/merge";

import { useDataStore } from "@/stores/useDataStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { getTrackStatusMessage } from "@/lib/getTrackStatusMessage";
import {
	createSectors,
	findYellowSectors,
	getSectorColor,
	type MapSector,
	prioritizeColoredSectors,
	rad,
	rotate,
} from "@/lib/map";

// This is basically fearlessly copied from
// https://github.com/tdjsnelling/monaco

const SPACE = 1000;
const ROTATION_FIX = 90;

/**
 * Snap the car to the track-geometry point that corresponds to its last
 * confirmed mini-sector boundary, with a 0.5-segment nudge when in-progress.
 */
function getSegmentPosition(
	timingDriver: TimingDataDriver | undefined,
	originalTrackPoints: { x: number; y: number }[] | null,
): PositionCar | null {
	if (!timingDriver || !originalTrackPoints || originalTrackPoints.length === 0) return null;

	const allSegments = asArray(timingDriver.Sectors).flatMap((sector) => asArray(sector.Segments));
	if (allSegments.length === 0) {
		return { Status: "OnTrack", X: originalTrackPoints[0].x, Y: originalTrackPoints[0].y, Z: 0 };
	}

	let furthestIdx = -1;
	for (let i = allSegments.length - 1; i >= 0; i--) {
		if ((allSegments[i]?.Status ?? 0) > 0) { furthestIdx = i; break; }
	}
	if (furthestIdx === -1) {
		for (let i = 0; i < allSegments.length; i++) {
			if (allSegments[i]?.Status !== undefined) { furthestIdx = i; break; }
		}
	}
	if (furthestIdx === -1) furthestIdx = 0;

	const currentStatus = allSegments[furthestIdx]?.Status ?? 0;
	const nudge = currentStatus === 1 ? 0.5 : 0;
	const segmentSize = 1 / Math.max(allSegments.length, 1);
	const baseRatio = furthestIdx / Math.max(allSegments.length - 1, 1);
	const adjustedRatio = baseRatio + nudge * segmentSize;

	const idx = Math.min(Math.max(Math.floor(adjustedRatio * (originalTrackPoints.length - 1)), 0), originalTrackPoints.length - 1);
	const pt = originalTrackPoints[idx];
	return { Status: "OnTrack", X: pt.x, Y: pt.y, Z: 0 };
}

function getSmoothedSegmentPosition(
	fracIdx: number,
	totalSegments: number,
	trackPoints: { x: number; y: number }[],
): PositionCar {
	const ratio = fracIdx / Math.max(totalSegments - 1, 1);
	const fracPtIdx = ratio * (trackPoints.length - 1);
	const lo = Math.floor(fracPtIdx);
	const hi = Math.min(lo + 1, trackPoints.length - 1);
	const t = fracPtIdx - lo;
	return {
		Status: "OnTrack",
		X: trackPoints[lo].x * (1 - t) + trackPoints[hi].x * t,
		Y: trackPoints[lo].y * (1 - t) + trackPoints[hi].y * t,
		Z: 0,
	};
}

type Corner = {
	number: number;
	pos: TrackPosition;
	labelPos: TrackPosition;
};

type SmoothPositionsProp = {
	getSmoothedIndex: (driverNr: string) => number | null;
	enabled: boolean;
};

type Props = {
	filter?: string[];
	highlightDriver?: string;
	smoothPositions?: SmoothPositionsProp | null;
	totalSegmentsForSmooth?: number;
};

export default function Map({ filter, highlightDriver, smoothPositions, totalSegmentsForSmooth = 0 }: Props) {
	const showCornerNumbers = useSettingsStore((state) => state.showCornerNumbers);
	const favoriteDrivers = useSettingsStore((state) => state.favoriteDrivers);

	const drivers = useDataStore((state) => state?.state?.DriverList);
	const trackStatus = useDataStore((state) => state?.state?.TrackStatus);
	const timingDrivers = useDataStore((state) => state?.state?.TimingData);
	const rawRCM = useDataStore((state) => state?.state?.RaceControlMessages?.Messages);
	const raceControlMessages = rawRCM ? asArray(rawRCM) : undefined;
	const circuitKey = useDataStore((state) => state?.state?.SessionInfo?.Meeting.Circuit.Key);

	const [[minX, minY, widthX, widthY], setBounds] = useState<(null | number)[]>([null, null, null, null]);
	const [[centerX, centerY], setCenter] = useState<(null | number)[]>([null, null]);

	const [points, setPoints] = useState<null | { x: number; y: number }[]>(null);
	const [sectors, setSectors] = useState<MapSector[]>([]);
	const [corners, setCorners] = useState<Corner[]>([]);
	const [rotation, setRotation] = useState<number>(0);
	const [finishLine, setFinishLine] = useState<null | { x: number; y: number; startAngle: number }>(null);
	const [originalTrackPoints, setOriginalTrackPoints] = useState<null | { x: number; y: number }[]>(null);

	useEffect(() => {
		(async () => {
			if (!circuitKey) return;
			const mapJson = await fetchMap(circuitKey);

			if (!mapJson) return;

			const centerX = (Math.max(...mapJson.x) - Math.min(...mapJson.x)) / 2;
			const centerY = (Math.max(...mapJson.y) - Math.min(...mapJson.y)) / 2;

			const fixedRotation = mapJson.rotation + ROTATION_FIX;

			const sectors = createSectors(mapJson).map((s) => ({
				...s,
				start: rotate(s.start.x, s.start.y, fixedRotation, centerX, centerY),
				end: rotate(s.end.x, s.end.y, fixedRotation, centerX, centerY),
				points: s.points.map((p) => rotate(p.x, p.y, fixedRotation, centerX, centerY)),
			}));

			const cornerPositions: Corner[] = mapJson.corners.map((corner) => ({
				number: corner.number,
				pos: rotate(corner.trackPosition.x, corner.trackPosition.y, fixedRotation, centerX, centerY),
				labelPos: rotate(
					corner.trackPosition.x + 540 * Math.cos(rad(corner.angle)),
					corner.trackPosition.y + 540 * Math.sin(rad(corner.angle)),
					fixedRotation,
					centerX,
					centerY,
				),
			}));

			const rotatedPoints = mapJson.x.map((x, index) => rotate(x, mapJson.y[index], fixedRotation, centerX, centerY));

			const pointsX = rotatedPoints.map((item) => item.x);
			const pointsY = rotatedPoints.map((item) => item.y);

			const cMinX = Math.min(...pointsX) - SPACE;
			const cMinY = Math.min(...pointsY) - SPACE;
			const cWidthX = Math.max(...pointsX) - cMinX + SPACE * 2;
			const cWidthY = Math.max(...pointsY) - cMinY + SPACE * 2;

			const rotatedFinishLine = rotate(mapJson.x[0], mapJson.y[0], fixedRotation, centerX, centerY);

			const dx = rotatedPoints[3].x - rotatedPoints[0].x;
			const dy = rotatedPoints[3].y - rotatedPoints[0].y;
			const startAngle = Math.atan2(dy, dx) * (180 / Math.PI);

			const originalPoints = mapJson.x.map((x, index) => ({ x, y: mapJson.y[index] }));

			setCenter([centerX, centerY]);
			setBounds([cMinX, cMinY, cWidthX, cWidthY]);
			setSectors(sectors);
			setPoints(rotatedPoints);
			setRotation(fixedRotation);
			setCorners(cornerPositions);
			setFinishLine({ x: rotatedFinishLine.x, y: rotatedFinishLine.y, startAngle });
			setOriginalTrackPoints(originalPoints);
		})();
	}, [circuitKey]);

	const yellowSectors = useMemo(() => findYellowSectors(raceControlMessages), [raceControlMessages]);

	const renderedSectors = useMemo(() => {
		const status = getTrackStatusMessage(trackStatus?.Status ? parseInt(trackStatus.Status) : undefined);

		return sectors
			.map((sector) => {
				const color = getSectorColor(sector, status?.bySector, status?.trackColor, yellowSectors);
				return {
					color,
					pulse: status?.pulse,
					number: sector.number,
					strokeWidth: color === "stroke-white" ? 60 : 120,
					d: `M${sector.points[0].x},${sector.points[0].y} ${sector.points.map((point) => `L${point.x},${point.y}`).join(" ")}`,
				};
			})
			.sort(prioritizeColoredSectors);
	}, [trackStatus, sectors, yellowSectors]);

	if (!points || !minX || !minY || !widthX || !widthY) {
		return (
			<div className="h-full w-full p-2" style={{ minHeight: "35rem" }}>
				<div className="h-full w-full animate-pulse rounded-lg bg-zinc-800" />
			</div>
		);
	}

	return (
		<svg
			viewBox={`${minX} ${minY} ${widthX} ${widthY}`}
			className="h-full w-full xl:max-h-screen"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				className="stroke-gray-800"
				strokeWidth={300}
				strokeLinejoin="round"
				fill="transparent"
				d={`M${points[0].x},${points[0].y} ${points.map((point) => `L${point.x},${point.y}`).join(" ")}`}
			/>

			{renderedSectors.map((sector) => {
				const style = sector.pulse
					? {
							animation: `${sector.pulse * 100}ms linear infinite pulse`,
						}
					: {};
				return (
					<path
						key={`map.sector.${sector.number}`}
						className={sector.color}
						strokeWidth={sector.strokeWidth}
						strokeLinecap="round"
						strokeLinejoin="round"
						fill="transparent"
						d={sector.d}
						style={style}
					/>
				);
			})}

			{finishLine && (
				<rect
					x={finishLine.x - 75}
					y={finishLine.y}
					width={240}
					height={20}
					fill="red"
					stroke="red"
					strokeWidth={70}
					transform={`rotate(${finishLine.startAngle + 90}, ${finishLine.x + 25}, ${finishLine.y})`}
				/>
			)}

			{showCornerNumbers &&
				corners.map((corner) => (
					<CornerNumber
						key={`corner.${corner.number}`}
						number={corner.number}
						x={corner.labelPos.x}
						y={corner.labelPos.y}
					/>
				))}

			{centerX && centerY && drivers && timingDrivers && (
				<>
					{Object.values(drivers ?? {})
						.reverse()
						.filter((driver) => (filter ? filter.includes(driver.RacingNumber) : true))
						.map((driver) => {
							const timingDriver = timingDrivers?.Lines[driver.RacingNumber];
							const hidden = timingDriver
								? timingDriver.KnockedOut || timingDriver.Stopped || timingDriver.Retired
								: false;
							const pit = timingDriver ? timingDriver.InPit : false;

							let driverPosition: PositionCar | null = null;
							if (
								smoothPositions?.enabled &&
								totalSegmentsForSmooth > 0 &&
								originalTrackPoints &&
								smoothPositions.getSmoothedIndex(driver.RacingNumber) !== null
							) {
								const fracIdx = smoothPositions.getSmoothedIndex(driver.RacingNumber)!;
								driverPosition = getSmoothedSegmentPosition(
									fracIdx,
									totalSegmentsForSmooth,
									originalTrackPoints,
								);
							}
							if (!driverPosition) {
								driverPosition = getSegmentPosition(timingDriver, originalTrackPoints);
							}

							if (!driverPosition) return null;

							return (
								<CarDot
									key={`map.driver.${driver.RacingNumber}`}
									favoriteDriver={favoriteDrivers.length > 0 ? favoriteDrivers.includes(driver.RacingNumber) : false}
									highlighted={!!highlightDriver && driver.RacingNumber === highlightDriver}
									name={driver.Tla}
									color={driver.TeamColour}
									pit={pit}
									hidden={hidden}
									pos={driverPosition}
									rotation={rotation}
									centerX={centerX}
									centerY={centerY}
									smoothActive={smoothPositions?.enabled ?? false}
								/>
							);
						})}
				</>
			)}
		</svg>
	);
}

type CornerNumberProps = {
	number: number;
	x: number;
	y: number;
};

const CornerNumber: React.FC<CornerNumberProps> = ({ number, x, y }) => {
	return (
		<text x={x} y={y} className="fill-zinc-700" fontSize={300} fontWeight="semibold">
			{number}
		</text>
	);
};

type CarDotProps = {
	name: string;
	color: string | undefined;
	favoriteDriver: boolean;
	highlighted: boolean;

	pit: boolean;
	hidden: boolean;

	pos: PositionCar;
	rotation: number;

	centerX: number;
	centerY: number;

	smoothActive?: boolean;
};

const CarDot = ({ pos, name, color, favoriteDriver, highlighted, pit, hidden, rotation, centerX, centerY, smoothActive }: CarDotProps) => {
	const rotatedPos = rotate(pos.X, pos.Y, rotation, centerX, centerY);
	const transform = [`translateX(${rotatedPos.x}px)`, `translateY(${rotatedPos.y}px)`].join(" ");
	const transitionStyle = smoothActive ? undefined : "all 1s linear";

	return (
		<g
			className={clsx("fill-zinc-700", { "opacity-30": pit }, { "opacity-0!": hidden })}
			style={{
				...(transitionStyle && { transition: transitionStyle }),
				transform,
				...(color && { fill: `#${color}` }),
			}}
		>
			{highlighted && (
				<circle
					id="map.driver.highlight"
					className="stroke-white"
					r={240}
					fill="transparent"
					strokeWidth={40}
					style={{ opacity: 0.35, ...(transitionStyle && { transition: transitionStyle }) }}
				/>
			)}
			<circle id={`map.driver.circle`} r={120} />
			<text
				id={`map.driver.text`}
				fontWeight="bold"
				fontSize={120 * 3}
				style={{
					transform: "translateX(150px) translateY(-120px)",
				}}
			>
				{name}
			</text>

			{favoriteDriver && (
				<circle
					id={`map.driver.favorite`}
					className="stroke-sky-400"
					r={180}
					fill="transparent"
					strokeWidth={40}
					style={transitionStyle ? { transition: transitionStyle } : undefined}
				/>
			)}
		</g>
	);
};
