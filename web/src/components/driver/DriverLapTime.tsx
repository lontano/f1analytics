import clsx from "clsx";

import type { TimingDataDriver } from "@/types/state.type";

type Props = {
	last: TimingDataDriver["LastLapTime"];
	best: TimingDataDriver["BestLapTime"];
	hasFastest: boolean;
	/** When true, show fastest (best) lap as the main line instead of last lap */
	inPit?: boolean;
};

export default function DriverLapTime({ last, best, hasFastest, inPit }: Props) {
	const mainValue = inPit ? best.Value : last.Value;
	const mainOverallFastest = inPit ? false : last.OverallFastest;
	const mainPersonalFastest = inPit ? false : last.PersonalFastest;
	const secondaryValue = inPit ? last.Value : best.Value;

	return (
		<div className="place-self-start">
			<p
				className={clsx("text-lg leading-none font-medium tabular-nums", {
					"text-violet-600!": mainOverallFastest,
					"text-emerald-500!": mainPersonalFastest,
					"text-zinc-500!": !mainValue,
				})}
			>
				{!!mainValue ? mainValue : "-- -- ---"}
			</p>
			<p
				className={clsx("text-sm leading-none text-zinc-500 tabular-nums", {
					"text-violet-600!": hasFastest && !inPit,
					"text-zinc-500!": !secondaryValue,
				})}
			>
				{!!secondaryValue ? secondaryValue : "-- -- ---"}
			</p>
		</div>
	);
}
