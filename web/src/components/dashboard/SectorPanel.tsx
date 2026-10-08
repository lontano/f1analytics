"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";

import type { Sector, TimingDataDriver, TimingStatsDriver } from "@/types/state.type";
import { useReferenceModel } from "@/hooks/useReferenceModel";
import { computePaceFactor, parseTimeMs, formatLapTimeMs } from "@/lib/lapModel";
import type { ReferenceModel } from "@/lib/lapModel";

// ─── Internal types ──────────────────────────────────────────────────────────

type SectorRow = {
	sectorIdx: number;
	status: number;
	currentMs: number | null;
	isEstimate: boolean;
	lastMs: number | null;
	bestMs: number | null;
	refMs: number | null;
};

// ─── Formatting helpers ──────────────────────────────────────────────────────

const fmtMs = (ms: number | null | undefined): string => {
	if (ms == null || ms < 0) return "---";
	return formatLapTimeMs(ms);
};

const pctDiff = (compare: number | null, base: number | null): number | null => {
	if (compare === null || base === null || base === 0) return null;
	return ((compare - base) / base) * 100;
};

const fmtPct = (pct: number | null): string => {
	if (pct === null) return "";
	return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
};

// ─── Styling helpers ─────────────────────────────────────────────────────────

const ledClass = (status: number): string =>
	clsx("inline-block h-2 w-2 shrink-0 rounded-[1px]", {
		"bg-amber-400": status === 2048 || status === 2052,
		"bg-emerald-500": status === 2049,
		"bg-violet-600": status === 2051,
		"bg-blue-500": status === 2064,
		"bg-zinc-700": !status || status === 0,
	});

const currentColor = (status: number, isEstimate: boolean): string => {
	if (isEstimate) return "italic text-zinc-500";
	return clsx({
		"text-violet-400": status === 2051,
		"text-emerald-500": status === 2049,
		"text-amber-400": status === 2048 || status === 2052,
		"text-zinc-100": !status || status === 0,
	});
};

const pctColor = (pct: number | null): string => {
	if (pct === null) return "text-zinc-700";
	if (pct > 0.5) return "text-red-400";
	if (pct < -0.5) return "text-emerald-400";
	return "text-zinc-400";
};

// ─── Sector status: use sector.Status or derive from last segment in sector ────

function sectorStatus(sector: Sector | undefined): number {
	if (!sector) return 0;
	if ((sector.Status ?? 0) !== 0) return sector.Status;
	const segs = sector.Segments ?? [];
	if (segs.length === 0) return 0;
	const last = segs[segs.length - 1];
	return last?.Status ?? 0;
}

// ─── Row builder (sector-level only) ───────────────────────────────────────────

function buildSectorRows(
	timingDriver: TimingDataDriver,
	statsDriver: TimingStatsDriver | undefined | null,
	refModel: ReferenceModel,
): SectorRow[] {
	const sectors = timingDriver.Sectors ?? [];
	const { factor } = computePaceFactor(timingDriver, refModel);
	const paceFactor = factor ?? 1.0;

	const rows: SectorRow[] = [];

	for (let si = 0; si < Math.min(sectors.length, 3); si++) {
		const sector = sectors[si];
		const siKey = si as 0 | 1 | 2;

		const sectorActualMs = parseTimeMs(sector?.Value);
		const sectorLastMs = parseTimeMs(sector?.PreviousValue);
		const sectorBestMs = parseTimeMs(statsDriver?.BestSectors?.[si]?.Value);
		const refSectorMs = refModel.sectorMs[siKey];
		const sectorEstMs = refSectorMs !== null ? refSectorMs * paceFactor : null;

		const isComplete = sectorActualMs !== null;
		const currentMs = isComplete ? sectorActualMs : sectorEstMs;
		const isEstimate = !isComplete;

		rows.push({
			sectorIdx: si,
			status: sectorStatus(sector),
			currentMs,
			isEstimate,
			lastMs: sectorLastMs,
			bestMs: sectorBestMs,
			refMs: refSectorMs,
		});
	}

	return rows;
}

const partialSum = (values: (number | null)[]): number | null => {
	let total = 0;
	let any = false;
	for (const v of values) {
		if (v !== null) {
			total += v;
			any = true;
		}
	}
	return any ? total : null;
};

const CompareCell = ({ ms, base }: { ms: number | null; base: number | null }) => {
	const pct = pctDiff(ms, base);
	if (ms === null) return <span className="text-zinc-700">---</span>;
	return (
		<div className="flex flex-col items-end leading-tight">
			<span className="text-zinc-200">{fmtMs(ms)}</span>
			{pct !== null && <span className={clsx("text-[8.5px]", pctColor(pct))}>{fmtPct(pct)}</span>}
		</div>
	);
};

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
	timingDriver: TimingDataDriver | undefined;
	timingStatsDriver: TimingStatsDriver | undefined;
};

export default function SectorPanel({ timingDriver, timingStatsDriver }: Props) {
	const [isOpen, setIsOpen] = useState(true);
	const refModel = useReferenceModel();

	const rows = useMemo(
		() =>
			timingDriver
				? buildSectorRows(timingDriver, timingStatsDriver, refModel)
				: [],
		[timingDriver, timingStatsDriver, refModel],
	);

	const totals = useMemo(
		() => ({
			currentMs: partialSum(rows.map((r) => r.currentMs)),
			lastMs: partialSum(rows.map((r) => r.lastMs)),
			bestMs: partialSum(rows.map((r) => r.bestMs)),
			refMs: partialSum(rows.map((r) => r.refMs)),
		}),
		[rows],
	);

	return (
		<div className="flex h-full shrink-0">
			{!isOpen && (
				<button
					type="button"
					onClick={() => setIsOpen(true)}
					className="flex h-full w-7 shrink-0 cursor-pointer items-center justify-center border-l border-zinc-800 bg-zinc-950 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
					title="Open sectors panel"
				>
					<span className="-rotate-90 select-none text-[9px] font-semibold uppercase tracking-widest whitespace-nowrap">
						Sectors ‹
					</span>
				</button>
			)}

			{isOpen && (
				<div className="flex h-full w-[17rem] shrink-0 flex-col overflow-hidden border-l border-zinc-800 bg-zinc-950">
					<div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-3 py-2">
						<span className="text-[10px] font-semibold tracking-widest text-zinc-400 uppercase">
							Sectors
						</span>
						<button
							type="button"
							onClick={() => setIsOpen(false)}
							className="cursor-pointer text-xs text-zinc-600 transition-colors hover:text-zinc-300"
							title="Collapse"
						>
							›
						</button>
					</div>

					<div className="min-h-0 flex-1 overflow-y-auto">
						{rows.length === 0 ? (
							<div className="flex h-24 items-center justify-center text-xs text-zinc-600">
								No driver selected
							</div>
						) : (
							<table className="w-full border-collapse text-[10px] tabular-nums">
								<thead className="sticky top-0 z-10 bg-zinc-950">
									<tr className="border-b border-zinc-800">
										<th className="px-1.5 py-1.5 text-left font-medium text-zinc-500">Sector</th>
										<th className="px-1.5 py-1.5 text-right font-medium text-zinc-500">Current</th>
										<th className="px-1.5 py-1.5 text-right font-medium text-zinc-500">Last</th>
										<th className="px-1.5 py-1.5 text-right font-medium text-zinc-500">Best</th>
										<th className="px-1.5 py-1.5 text-right font-medium text-zinc-500">Ref</th>
									</tr>
								</thead>

								<tbody>
									{rows.map((row) => (
										<tr key={row.sectorIdx} className="border-b border-zinc-900/50 hover:bg-white/[0.03]">
											<td className="px-1.5 py-1">
												<div className="flex items-center gap-1">
													<span className={ledClass(row.status)} />
													<span className="text-zinc-400">S{row.sectorIdx + 1}</span>
												</div>
											</td>
											<td className="px-1.5 py-1 text-right">
												<span className={currentColor(row.status, row.isEstimate)}>
													{fmtMs(row.currentMs)}
												</span>
											</td>
											<td className="px-1.5 py-1 text-right">
												<CompareCell ms={row.lastMs} base={row.currentMs} />
											</td>
											<td className="px-1.5 py-1 text-right">
												<CompareCell ms={row.bestMs} base={row.currentMs} />
											</td>
											<td className="px-1.5 py-1 text-right">
												<CompareCell ms={row.refMs} base={row.currentMs} />
											</td>
										</tr>
									))}
								</tbody>

								<tfoot className="sticky bottom-0 z-10 border-t-2 border-zinc-700 bg-zinc-950">
									<tr>
										<td className="px-1.5 py-1.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
											Total
										</td>
										<td className="px-1.5 py-1.5 text-right">
											<span
												className={clsx(
													"font-semibold italic",
													totals.currentMs !== null ? "text-zinc-100" : "text-zinc-600",
												)}
											>
												{fmtMs(totals.currentMs)}
											</span>
										</td>
										{[totals.lastMs, totals.bestMs, totals.refMs].map((ms, ci) => (
											<td key={ci} className="px-1.5 py-1.5 text-right">
												<CompareCell ms={ms} base={totals.currentMs} />
											</td>
										))}
									</tr>
								</tfoot>
							</table>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
