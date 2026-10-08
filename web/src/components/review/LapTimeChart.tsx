"use client";

import {
	CartesianGrid,
	Legend,
	Line,
	LineChart,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import type { DetectedStint } from "@/types/review.type";

const DRIVER_COLORS = [
	"#ef4444",
	"#3b82f6",
	"#22c55e",
	"#eab308",
	"#a855f7",
	"#ec4899",
	"#14b8a6",
	"#f97316",
];

export type LapTimeChartEntry = { driverNr: number; stint: DetectedStint };

type LapTimeChartProps = {
	entries: LapTimeChartEntry[];
	alignedLap: number;
};

function formatLapTime(ms: number): string {
	const s = ms / 1000;
	if (s >= 60) {
		const m = Math.floor(s / 60);
		const sec = (s % 60).toFixed(3);
		return `${m}:${sec.padStart(6, "0")}`;
	}
	return `${s.toFixed(3)}s`;
}

export default function LapTimeChart({ entries, alignedLap }: LapTimeChartProps) {
	const dataByLap = new Map<number, Record<string, number | string>>();
	entries.forEach(({ driverNr, stint }, seriesIndex) => {
		(stint.countedLaps ?? stint.laps).forEach((lap, idx) => {
			if (lap.lastLaptimeMs == null || lap.lastLaptimeMs <= 0) return;
			let row = dataByLap.get(idx);
			if (!row) {
				row = { lapIndex: idx };
				dataByLap.set(idx, row);
			}
			(row as Record<string, number>)[`series_${seriesIndex}`] = lap.lastLaptimeMs / 1000;
		});
	});
	const data = Array.from(dataByLap.entries())
		.sort((a, b) => a[0] - b[0])
		.map(([, row]) => row);

	const lines = entries.map(({ driverNr, stint }, i) => (
		<Line
			key={`${driverNr}-${stint.startLap}`}
			type="monotone"
			dataKey={`series_${i}`}
			name={`#${driverNr} ${stint.compound}`}
			stroke={DRIVER_COLORS[i % DRIVER_COLORS.length]}
			strokeWidth={2}
			dot={false}
			connectNulls
		/>
	));

	return (
		<div className="h-64 w-full">
			<ResponsiveContainer width="100%" height="100%">
				<LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
					<CartesianGrid strokeDasharray="3 3" className="stroke-zinc-700" />
					<XAxis
						dataKey="lapIndex"
						type="number"
						domain={["dataMin", "dataMax"]}
						tick={{ fill: "#a1a1aa", fontSize: 10 }}
					/>
					<YAxis
						tickFormatter={(v) => (typeof v === "number" ? formatLapTime(v * 1000) : "")}
						tick={{ fill: "#a1a1aa", fontSize: 10 }}
						domain={["auto", "auto"]}
					/>
					<Tooltip
						contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46" }}
						labelFormatter={(_, payload) => {
							const p = payload?.[0]?.payload;
							return p ? `Stint lap ${Number(p.lapIndex) + 1}` : "";
						}}
						formatter={(value: number) => [formatLapTime(value * 1000), ""]}
					/>
					<Legend wrapperStyle={{ fontSize: 11 }} />
					{lines}
					<ReferenceLine
						x={alignedLap}
						stroke="#facc15"
						strokeWidth={2}
						strokeDasharray="4 2"
					/>
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}
