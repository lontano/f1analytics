import clsx from "clsx";

import type { TimingDataDriver } from "@/types/state.type";
import { useSettingsStore } from "@/stores/useSettingsStore";

type Props = {
	timingDriver: TimingDataDriver;
	sessionPart: number | undefined;
};

export default function DriverGap({ timingDriver, sessionPart }: Props) {
	const mainIntervalMode = useSettingsStore((state) => state.mainIntervalMode);
	const gapToLeader =
		timingDriver.GapToLeader ??
		(timingDriver.Stats ? timingDriver.Stats[sessionPart ? sessionPart - 1 : 0].TimeDiffToFastest : undefined) ??
		timingDriver.TimeDiffToFastest ??
		"";

	const gapToFront =
		timingDriver.IntervalToPositionAhead?.Value ??
		(timingDriver.Stats ? timingDriver.Stats[sessionPart ? sessionPart - 1 : 0].TimeDifftoPositionAhead : undefined) ??
		timingDriver.TimeDiffToPositionAhead ??
		"";

	const catching = timingDriver.IntervalToPositionAhead?.Catching;
	const mainValue = mainIntervalMode === "leader" ? gapToLeader : gapToFront;
	const secondaryValue = mainIntervalMode === "leader" ? gapToFront : gapToLeader;
	const mainCatching = mainIntervalMode === "previous" && catching;

	return (
		<div className="place-self-start">
			<p
				className={clsx("text-lg leading-none font-medium tabular-nums", {
					"text-emerald-500": mainCatching,
					"text-zinc-500": !mainValue,
				})}
			>
				{!!mainValue ? mainValue : "-- ---"}
			</p>

			<p className="text-sm leading-none text-zinc-500 tabular-nums">{!!secondaryValue ? secondaryValue : "-- ---"}</p>
		</div>
	);
}
