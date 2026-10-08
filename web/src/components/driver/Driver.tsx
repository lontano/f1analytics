"use client";

import clsx from "clsx";
import { motion } from "motion/react";

import type { Driver, TimingDataDriver } from "@/types/state.type";

import { useSettingsStore } from "@/stores/useSettingsStore";
import { useDataStore } from "@/stores/useDataStore";
import { asArray } from "@/lib/merge";
import { darkenTeamColor } from "@/lib/teamColor";

import DriverTag from "./DriverTag";
import DriverDRS from "./DriverDRS";
import DriverGap from "./DriverGap";
import DriverTire from "./DriverTire";
import DriverMiniSectors from "./DriverMiniSectors";
import DriverLapTime from "./DriverLapTime";
import DriverEstimatedLap from "./DriverEstimatedLap";
import DriverInfo from "./DriverInfo";
import DriverCarMetrics from "./DriverCarMetrics";

type Props = {
	position: number;
	driver: Driver;
	timingDriver: TimingDataDriver;
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

export default function Driver({ driver, timingDriver, position }: Props) {
	const sessionPart = useDataStore((state) => state.state?.TimingData?.SessionPart);
	const timingStatsDriver = useDataStore((state) => state.state?.TimingStats?.Lines[driver.RacingNumber]);
	const appTimingDriver = useDataStore((state) => state.state?.TimingAppData?.Lines[driver.RacingNumber]);
	const carData = useDataStore((state) => (state?.carsData ? state.carsData[driver.RacingNumber].Channels : undefined));

	const hasFastest = timingStatsDriver?.PersonalBestLapTime.Position == 1;

	const carMetrics = useSettingsStore((state) => state.carMetrics);
	const showEstimatedLap = useSettingsStore((state) => state.showEstimatedLap);

	const favoriteDriver = useSettingsStore((state) => state.favoriteDrivers.includes(driver.RacingNumber));
	const backgroundColor = darkenTeamColor(driver.TeamColour);

	const gridCols = [
		"5.5rem",
		"3.5rem",
		"5.5rem",
		"4rem",
		"5rem",
		"5.5rem",
		...(showEstimatedLap ? ["5.5rem"] : []),
		"auto",
		...(carMetrics ? ["10.5rem"] : []),
	].join(" ");

	return (
		<motion.div
			layout="position"
			className={clsx("flex flex-col gap-1 rounded-lg p-1.5 select-none", {
				"opacity-50": timingDriver.KnockedOut || timingDriver.Retired || timingDriver.Stopped,
				"ring-1 ring-sky-400/60": favoriteDriver,
				"ring-2 ring-violet-400/60": hasFastest,
				"ring-2 ring-red-500/70": sessionPart != undefined && inDangerZone(position, sessionPart),
			})}
			style={{ backgroundColor }}
		>
			<div className="grid items-center gap-2" style={{ gridTemplateColumns: gridCols }}>
				<DriverTag className="min-w-full!" short={driver.Tla} teamColor={driver.TeamColour} position={position} />
				<DriverDRS
					on={carData ? hasDRS(carData[45] ?? 0) : false}
					possible={carData ? possibleDRS(carData[45] ?? 0) : false}
					inPit={timingDriver.InPit}
					pitOut={timingDriver.PitOut}
				/>
				<DriverTire stints={appTimingDriver?.Stints ? asArray(appTimingDriver.Stints) : undefined} />
				<DriverInfo timingDriver={timingDriver} gridPos={appTimingDriver ? parseInt(appTimingDriver.GridPos) : 0} />
				<DriverGap timingDriver={timingDriver} sessionPart={sessionPart} />
				<DriverLapTime last={timingDriver.LastLapTime} best={timingDriver.BestLapTime} hasFastest={hasFastest} inPit={timingDriver.InPit} />
				{showEstimatedLap && <DriverEstimatedLap timingDriver={timingDriver} />}
				<DriverMiniSectors
					sectors={asArray(timingDriver.Sectors)}
					bestSectors={timingStatsDriver?.BestSectors}
					inPit={timingDriver.InPit}
				/>

				{carMetrics && carData && <DriverCarMetrics carData={carData} />}
			</div>
		</motion.div>
	);
}
