"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";

import Map from "@/components/dashboard/Map";
import TrackCircle from "@/components/dashboard/TrackCircle";
import SectorPanel from "@/components/dashboard/SectorPanel";
import DriverTag from "@/components/driver/DriverTag";
import DriverDRS from "@/components/driver/DriverDRS";
import DriverInfo from "@/components/driver/DriverInfo";
import DriverGap from "@/components/driver/DriverGap";
import DriverLapTime from "@/components/driver/DriverLapTime";
import DriverEstimatedLap from "@/components/driver/DriverEstimatedLap";

import { sortPos } from "@/lib/sorting";
import { countSegments } from "@/lib/lapModel";
import { darkenTeamColor } from "@/lib/teamColor";

import { useDataStore } from "@/stores/useDataStore";
import { useSmoothPositions } from "@/hooks/useSmoothPositions";
import DataAvailability from "@/components/DataAvailability";
import type { Driver, TimingDataDriver } from "@/types/state.type";
import { useSettingsStore } from "@/stores/useSettingsStore";

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const CIRCLE_MIN_H = 260;
const CIRCLE_MAX_H = 900;
const CIRCLE_DEFAULT_H = 420;
const CIRCLE_H_KEY = "trackmap.circleHeight";

export default function TrackMap() {
	const drivers = useDataStore((state) => state.state?.DriverList);
	const driversTiming = useDataStore((state) => state.state?.TimingData);

	const [selectedNr, setSelectedNr] = useState<string | null>(null);
	const hasUserDeselectedRef = useRef(false);

	const [circleHeight, setCircleHeight] = useState<number>(() => {
		try {
			const raw = window.localStorage.getItem(CIRCLE_H_KEY);
			const parsed = raw ? Number.parseInt(raw, 10) : CIRCLE_DEFAULT_H;
			return clamp(Number.isFinite(parsed) ? parsed : CIRCLE_DEFAULT_H, CIRCLE_MIN_H, CIRCLE_MAX_H);
		} catch {
			return CIRCLE_DEFAULT_H;
		}
	});

	const circleHeightRef = useRef<number>(circleHeight);
	useEffect(() => {
		circleHeightRef.current = circleHeight;
	}, [circleHeight]);

	const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();

		const startY = e.clientY;
		const startH = circleHeightRef.current;

		const onMove = (ev: PointerEvent) => {
			const next = clamp(startH + (ev.clientY - startY), CIRCLE_MIN_H, CIRCLE_MAX_H);
			circleHeightRef.current = next;
			setCircleHeight(next);
		};

		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			try {
				window.localStorage.setItem(CIRCLE_H_KEY, String(circleHeightRef.current));
			} catch {
				// ignore
			}
		};

		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp, { once: true });
	};

	useEffect(() => {
		if (!driversTiming) return;
		if (selectedNr !== null && driversTiming.Lines[selectedNr]) return;
		if (selectedNr === null && hasUserDeselectedRef.current) return;

		const leader = Object.values(driversTiming.Lines).sort(sortPos)[0];
		if (leader) setSelectedNr(leader.RacingNumber);
	}, [driversTiming, selectedNr]);

	const handleSelectDriver = (nr: string | null) => {
		hasUserDeselectedRef.current = nr === null;
		setSelectedNr(nr);
	};

	const timingStats = useDataStore((state) => state.state?.TimingStats);

	const leaderTimingDriver = useMemo(() => {
		if (!driversTiming) return undefined;
		const leader = Object.values(driversTiming.Lines).sort(sortPos)[0];
		return leader ?? undefined;
	}, [driversTiming]);

	const selectedTimingDriver = useMemo(() => {
		if (!driversTiming) return undefined;
		if (selectedNr && driversTiming.Lines[selectedNr]) return driversTiming.Lines[selectedNr];
		return leaderTimingDriver;
	}, [driversTiming, selectedNr, leaderTimingDriver]);

	const selectedDriver = useMemo(() => {
		if (!drivers) return undefined;
		const nr = selectedNr ?? leaderTimingDriver?.RacingNumber;
		return nr ? drivers[nr] : undefined;
	}, [drivers, selectedNr, leaderTimingDriver]);

	const selectedTimingStatsDriver = useMemo(() => {
		if (!timingStats || !selectedNr) return undefined;
		return timingStats.Lines[selectedNr];
	}, [timingStats, selectedNr]);

	const totalSegments = useMemo(
		() => countSegments(selectedTimingDriver?.Sectors ?? []),
		[selectedTimingDriver?.Sectors],
	);
	const pageDelay = useSettingsStore((state) => state.delay);
	const smoothPositionsSetting = useSettingsStore((state) => state.smoothPositions);
	const setSmoothPositions = useSettingsStore((state) => state.setSmoothPositions);
	const smoothPositions = useSmoothPositions(smoothPositionsSetting, totalSegments);

	return (
		<div className="flex flex-col-reverse md:h-full md:flex-row">
			<div className="flex w-full flex-col gap-0.5 overflow-y-auto border-zinc-800 md:h-full md:w-fit md:rounded-lg md:border md:p-2">

				{(!drivers || !driversTiming) &&
					new Array(20).fill("").map((_, index) => <SkeletonDriver key={`driver.loading.${index}`} />)}

				{drivers && driversTiming && (
					<AnimatePresence>
						{Object.values(driversTiming.Lines)
							.sort(sortPos)
							.map((timingDriver, index) => (
								<TrackMapDriver
									key={`trackmap.driver.${timingDriver.RacingNumber}`}
									position={index + 1}
									driver={drivers[timingDriver.RacingNumber]}
									timingDriver={timingDriver}
									selected={timingDriver.RacingNumber === selectedNr}
									onSelect={() => handleSelectDriver(timingDriver.RacingNumber)}
								/>
							))}
					</AnimatePresence>
				)}
			</div>

			<div className="flex min-h-0 flex-col md:flex-1">
				<div className="flex flex-wrap items-center justify-end gap-3 px-3 pt-2 pb-0">
					<label className="flex items-center gap-2 text-xs text-zinc-400">
						<input
							type="checkbox"
							checked={smoothPositionsSetting}
							onChange={(e) => setSmoothPositions(e.target.checked)}
						/>
						<span>Smooth positions</span>
						{smoothPositionsSetting && smoothPositions.delayMs > 0 && (
							<span className="tabular-nums text-zinc-500">
								(effective: ~
								{((smoothPositions.pageDelayMs + smoothPositions.extraDelayMs) / 1000).toFixed(1)}s
								{pageDelay > 0 ? `, extra: ~${(smoothPositions.extraDelayMs / 1000).toFixed(1)}s` : ""}
								)
							</span>
						)}
					</label>
					<DataAvailability />
				</div>

				<div className="p-2 md:p-3" style={{ height: circleHeight }}>
					{selectedTimingDriver ? (
						<div className="h-full">
							<TrackCircle
								selectedNr={selectedNr}
								driverLabel={selectedDriver ? selectedDriver.Tla : leaderTimingDriver?.RacingNumber ?? undefined}
								sectors={selectedTimingDriver.Sectors}
								onSelectDriver={handleSelectDriver}
								smooth={smoothPositions}
							/>
						</div>
					) : (
						<div className="h-64 w-full animate-pulse rounded-lg bg-zinc-800" />
					)}
				</div>

				<div
					onPointerDown={startResize}
					className="group flex h-3 shrink-0 cursor-row-resize items-center justify-center bg-zinc-950/40 hover:bg-white/5"
					title="Drag to resize"
				>
					<div className="h-1 w-12 rounded-full bg-zinc-800 group-hover:bg-zinc-600" />
				</div>

				<div className="min-h-0 flex-1">
					<Map
						highlightDriver={selectedNr ?? undefined}
						smoothPositions={smoothPositions.enabled ? smoothPositions : null}
						totalSegmentsForSmooth={totalSegments}
					/>
				</div>
			</div>

			<SectorPanel
				timingDriver={selectedTimingDriver}
				timingStatsDriver={selectedTimingStatsDriver}
			/>
		</div>
	);
}

type TrackMapDriverProps = {
	position: number;
	driver: Driver;
	timingDriver: TimingDataDriver;
	selected: boolean;
	onSelect: () => void;
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

const TrackMapDriver = ({ position, driver, timingDriver, selected, onSelect }: TrackMapDriverProps) => {
	const sessionPart = useDataStore((state) => state.state?.TimingData?.SessionPart);
	const timingStatsDriver = useDataStore((state) => state.state?.TimingStats?.Lines[driver.RacingNumber]);
	const appTimingDriver = useDataStore((state) => state.state?.TimingAppData?.Lines[driver.RacingNumber]);
	const hasFastest = timingStatsDriver?.PersonalBestLapTime.Position == 1;

	const carData = useDataStore((state) => (state?.carsData ? state.carsData[driver.RacingNumber].Channels : undefined));

	const favoriteDriver = useSettingsStore((state) => state.favoriteDrivers.includes(driver.RacingNumber));
	const showEstimatedLap = useSettingsStore((state) => state.showEstimatedLap);
	const backgroundColor = darkenTeamColor(driver.TeamColour);

	return (
		<motion.button
			type="button"
			onClick={onSelect}
			whileHover={{ scale: 1.01 }}
			whileTap={{ scale: 0.99 }}
			layout="position"
			aria-pressed={selected}
			className={clsx("flex w-full cursor-pointer flex-col gap-1 rounded-lg p-1.5 text-left transition-colors select-none", {
				"opacity-50": timingDriver.KnockedOut || timingDriver.Retired || timingDriver.Stopped,
				"ring-1 ring-sky-400/60": favoriteDriver,
				"ring-2 ring-violet-400/60": hasFastest,
				"ring-2 ring-red-500/70": sessionPart != undefined && inDangerZone(position, sessionPart),
				"ring-2 ring-white/35": selected,
			})}
			style={{ backgroundColor }}
		>
			<div
				className="grid items-center gap-2"
				style={{
					gridTemplateColumns: showEstimatedLap
						? "5.5rem 3.5rem 4rem 5rem 5rem 5.5rem"
						: "5.5rem 3.5rem 4rem 5rem 5rem",
				}}
			>
				<DriverTag className="min-w-full!" short={driver.Tla} teamColor={driver.TeamColour} position={position} />
				<DriverDRS
					on={carData ? hasDRS(carData[45] ?? 0) : false}
					possible={carData ? possibleDRS(carData[45] ?? 0) : false}
					inPit={timingDriver.InPit}
					pitOut={timingDriver.PitOut}
				/>
				<DriverInfo timingDriver={timingDriver} gridPos={appTimingDriver ? parseInt(appTimingDriver.GridPos) : 0} />
				<DriverGap timingDriver={timingDriver} sessionPart={sessionPart} />
				<DriverLapTime last={timingDriver.LastLapTime} best={timingDriver.BestLapTime} hasFastest={hasFastest} inPit={timingDriver.InPit} />
				{showEstimatedLap && <DriverEstimatedLap timingDriver={timingDriver} compact />}
			</div>
		</motion.button>
	);
};

const SkeletonDriver = () => {
	const showEstimatedLap = useSettingsStore((state) => state.showEstimatedLap);
	const animateClass = "h-8 animate-pulse rounded-md bg-zinc-800";

	return (
		<div
			className="grid place-items-center items-center gap-1 p-1"
			style={{
				gridTemplateColumns: showEstimatedLap
					? "5.5rem 3.5rem 4rem 5rem 5rem 5.5rem"
					: "5.5rem 3.5rem 4rem 5rem 5rem",
			}}
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

			{showEstimatedLap && (
				<div className="flex w-full flex-col gap-1">
					<div className={clsx(animateClass, "h-4!")} />
					<div className={clsx(animateClass, "h-3! w-2/3")} />
				</div>
			)}
		</div>
	);
};
