"use client";

import { useMemo } from "react";
import clsx from "clsx";

import { useDataStore } from "@/stores/useDataStore";

type SignalStatus = "active" | "stale" | "none";

function useGpsStatus(): SignalStatus {
	const positions = useDataStore((s) => s.positions);
	return useMemo(() => {
		if (!positions) return "none";
		const entries = Object.values(positions);
		if (entries.length === 0) return "stale";
		// At least one car has non-zero coordinates.
		const hasCoords = entries.some((p) => p.X !== 0 || p.Y !== 0);
		return hasCoords ? "active" : "stale";
	}, [positions]);
}

function useTelemetryStatus(): SignalStatus {
	const carsData = useDataStore((s) => s.carsData);
	return useMemo(() => {
		if (!carsData) return "none";
		const entries = Object.values(carsData);
		if (entries.length === 0) return "stale";
		// At least one car reports a speed reading.
		const hasChannels = entries.some((c) => c.Channels?.["2"] !== undefined);
		return hasChannels ? "active" : "stale";
	}, [carsData]);
}

type PillProps = {
	label: string;
	subLabel: string;
	status: SignalStatus;
};

function DataPill({ label, subLabel, status }: PillProps) {
	const isActive = status === "active";
	const isNone = status === "none";

	return (
		<span
			className={clsx(
				"flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
				isActive
					? "border-emerald-800/60 bg-emerald-950/50 text-emerald-300"
					: isNone
						? "border-zinc-800 bg-zinc-950 text-zinc-700"
						: "border-zinc-700/50 bg-zinc-900/50 text-zinc-500",
			)}
			title={
				isActive
					? `${label} data is live and being recorded to database`
					: isNone
						? `${label} data is not available from the feed`
						: `${label} feed connected but no data received yet`
			}
		>
			<span
				className={clsx(
					"h-2 w-2 shrink-0 rounded-full",
					isActive ? "animate-pulse bg-emerald-500" : isNone ? "bg-zinc-700" : "bg-zinc-500",
				)}
			/>
			<span>{label}</span>
			{isActive && <span className="text-emerald-600">{subLabel}</span>}
		</span>
	);
}

/**
 * Shows live availability of GPS position data and car telemetry.
 * Both streams are always recorded to the database when active.
 */
export default function DataAvailability() {
	const gpsStatus = useGpsStatus();
	const telemetryStatus = useTelemetryStatus();

	return (
		<div className="flex items-center gap-1.5">
			<DataPill label="GPS" subLabel="·DB" status={gpsStatus} />
			<DataPill label="Telemetry" subLabel="·DB" status={telemetryStatus} />
		</div>
	);
}
