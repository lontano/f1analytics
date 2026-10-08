"use client";

import { motion } from "motion/react";
import Image from "@/compat/image";

import xIcon from "public/icons/xmark.svg";

import type { Driver } from "@/types/state.type";
import { useDataStore } from "@/stores/useDataStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

import DriverTag from "@/components/driver/DriverTag";
import SelectMultiple from "@/components/ui/SelectMultiple";

const isDriver = (value: unknown): value is Driver =>
	!!value &&
	typeof value === "object" &&
	typeof (value as Driver).RacingNumber === "string" &&
	typeof (value as Driver).Tla === "string";

export default function FavoriteDrivers() {
	const driverList = useDataStore((state) => state.state?.DriverList);
	const { favoriteDrivers, setFavoriteDrivers, removeFavoriteDriver } = useSettingsStore();

	const drivers = Object.values(driverList ?? {}).filter(isDriver);

	return (
		<div className="flex flex-col gap-2">
			<div className="flex gap-2">
				{favoriteDrivers.map((driverNumber) => {
					const driver = drivers.find((d) => d.RacingNumber === driverNumber);

					if (!driver) return null;

					return (
						<div key={driverNumber} className="flex items-center gap-1 rounded-xl border border-zinc-800 p-1">
							<DriverTag teamColor={driver.TeamColour} short={driver.Tla} />

							<motion.button
								whileHover={{ scale: 1.05 }}
								whileTap={{ scale: 0.95 }}
								onClick={() => removeFavoriteDriver(driverNumber)}
							>
								<Image src={xIcon} alt="x" width={30} />
							</motion.button>
						</div>
					);
				})}
			</div>

			<div className="w-80">
				<SelectMultiple
					placeholder="Select favorite drivers"
					options={drivers.map((d) => ({
						label: d.FullName || d.BroadcastName || d.Tla,
						value: d.RacingNumber,
					}))}
					selected={favoriteDrivers}
					setSelected={setFavoriteDrivers}
				/>
			</div>
		</div>
	);
}
