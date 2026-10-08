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
import { useReviewStore } from "@/stores/useReviewStore";

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

export type GapChartEntry = { driverNr: number; stintIndex: number; stint: DetectedStint };

type GapChartProps = {
	entries: GapChartEntry[];
	alignedLap: number;
};

function formatGap(ms: number): string {
	if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
	if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
	return `${ms}ms`;
}

export default function GapChart({ entries, alignedLap }: GapChartProps) {
	const getCumulativeMsAtAlignedLap = useReviewStore((s) => s.getCumulativeMsAtAlignedLap);

	const lapsList = entries.map((e) => (e.stint.countedLaps ?? e.stint.laps).length);
	const maxLaps = lapsList.length > 0 ? Math.min(...lapsList) : 0;
	const data: Record<string, number | string>[] = [];
	for (let lapIndex = 0; lapIndex < maxLaps; lapIndex++) {
		const row: Record<string, number | string> = { lapIndex };
		let minCumulative = Infinity;
		const cumulatives: number[] = [];
		for (const { driverNr, stintIndex } of entries) {
			const cum = getCumulativeMsAtAlignedLap(driverNr, stintIndex, lapIndex);
			cumulatives.push(cum);
			if (cum < minCumulative) minCumulative = cum;
		}
		cumulatives.forEach((ms, i) => {
			(row as Record<string, number>)[`series_${i}`] = (ms - minCumulative) / 1000;
		});
		data.push(row);
	}

	const lines = entries.map(({ driverNr, stintIndex, stint }, i) => (
		<Line
			key={`${driverNr}-${stintIndex}`}
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
						domain={[0, "dataMax"]}
						tick={{ fill: "#a1a1aa", fontSize: 10 }}
					/>
					<YAxis
						tickFormatter={(v) => (typeof v === "number" ? formatGap(v * 1000) : "")}
						tick={{ fill: "#a1a1aa", fontSize: 10 }}
						domain={[0, "auto"]}
					/>
					<Tooltip
						contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46" }}
						labelFormatter={(_, payload) => {
							const p = payload?.[0]?.payload;
							return p != null ? `Stint lap ${Number(p.lapIndex) + 1}` : "";
						}}
						formatter={(value: number) => [formatGap(value * 1000), ""]}
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
