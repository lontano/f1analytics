import clsx from "clsx";

import type { TimingDataDriver, TimingStatsDriver } from "@/types/state.type";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { asArray } from "@/lib/merge";

type Props = {
	sectors: TimingDataDriver["Sectors"];
	bestSectors: TimingStatsDriver["BestSectors"] | undefined;
	inPit?: boolean;
};

export default function DriverMiniSectors({ sectors = [], bestSectors, inPit }: Props) {
	const showMiniSectors = useSettingsStore((state) => state.showMiniSectors);
	const showBestSectors = useSettingsStore((state) => state.showBestSectors);

	return (
		<div className="flex gap-2">
			{sectors.map((sector, i) => {
				const bestSector = bestSectors?.[i];
				const liveValue = sector.Value || sector.PreviousValue;
				const bestValue = bestSector?.Value;
				const mainValue = inPit ? bestValue : liveValue;
				const secondaryValue = inPit ? liveValue : bestValue;
				const mainOverallFastest = inPit ? bestSector?.Position === 1 : sector.OverallFastest;
				const mainPersonalFastest = inPit ? !!bestValue && bestSector?.Position !== 1 : sector.PersonalFastest;

				return (
					<div key={`sector.${i}`} className="flex flex-col gap-1">
						{showMiniSectors && (
							<div className="flex flex-row gap-1">
								{asArray(sector.Segments).map((segment, j) => (
									<MiniSector status={segment.Status} key={`sector.mini.${j}`} />
								))}
							</div>
						)}

						<div className={clsx("flex", showMiniSectors ? "items-center gap-1" : "flex-col")}>
							<p
								className={clsx("text-lg leading-none font-medium tabular-nums", {
									"text-violet-600!": mainOverallFastest,
									"text-emerald-500!": mainPersonalFastest,
									"text-zinc-500": !mainValue,
								})}
							>
								{!!mainValue ? mainValue : "-- ---"}
							</p>

							{showBestSectors && (
								<p
									className={clsx("text-sm leading-none text-zinc-500 tabular-nums", {
										"text-violet-600!": !inPit && bestSector?.Position === 1,
										"text-zinc-500!": !secondaryValue,
									})}
								>
									{!!secondaryValue ? secondaryValue : "-- ---"}
								</p>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}

function MiniSector({ status }: { status: number }) {
	return (
		<div
			style={{ width: 10, height: 5, borderRadius: 2 }}
			className={clsx({
				"bg-amber-400": status === 2048 || status === 2052, // TODO unsure
				"bg-emerald-500": status === 2049,
				"bg-violet-600": status === 2051,
				"bg-blue-500": status === 2064,
				"bg-zinc-700": status === 0,
			})}
		/>
	);
}
