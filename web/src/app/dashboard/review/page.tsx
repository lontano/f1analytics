"use client";

import { useEffect, useMemo, useState } from "react";

import type { RawSession } from "@/types/raw.type";

import { fetchRawSessions, formatSessionLabel } from "@/lib/rawApi";
import { useReviewStore } from "@/stores/useReviewStore";

import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import StintTimeline from "@/components/review/StintTimeline";
import AlignedLeaderboard from "@/components/review/AlignedLeaderboard";
import LapTimeChart from "@/components/review/LapTimeChart";
import GapChart, { type GapChartEntry } from "@/components/review/GapChart";
import ReviewPlaybackBar from "@/components/review/ReviewPlaybackBar";

export default function ReviewPage() {
	const [sessions, setSessions] = useState<RawSession[] | null>(null);
	const [sessionsError, setSessionsError] = useState<string | null>(null);
	const [pickedSessionId, setPickedSessionId] = useState<string | null>(null);

	const status = useReviewStore((s) => s.status);
	const error = useReviewStore((s) => s.error);
	const loadSession = useReviewStore((s) => s.loadSession);
	const sessionId = useReviewStore((s) => s.sessionId);
	const selectedStints = useReviewStore((s) => s.selectedStints);
	const stints = useReviewStore((s) => s.stints);
	const alignedLap = useReviewStore((s) => s.alignedLap);

	useEffect(() => {
		(async () => {
			try {
				setSessionsError(null);
				const data = await fetchRawSessions(200);
				setSessions(data);
				if (!pickedSessionId && data.length > 0) setPickedSessionId(data[0].id);
			} catch (e) {
				setSessionsError(e instanceof Error ? e.message : "failed to load sessions");
				setSessions([]);
			}
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const options = useMemo(() => {
		if (!sessions) return [];
		return sessions.map((s) => ({ value: s.id, label: formatSessionLabel(s) }));
	}, [sessions]);

	const handleLoad = () => {
		if (!pickedSessionId) return;
		const session = sessions?.find((s) => s.id === pickedSessionId);
		loadSession(pickedSessionId, session?.sessionType ?? undefined);
	};

	const chartEntries = useMemo(() => {
		const lapEntries = selectedStints
			.map((s) => {
				const stint = stints.get(s.driverNr)?.[s.stintIndex];
				return stint ? { driverNr: s.driverNr, stint } : null;
			})
			.filter((x): x is { driverNr: number; stint: import("@/types/review.type").DetectedStint } => x != null);
		const gapEntries: GapChartEntry[] = selectedStints
			.map((s) => {
				const stint = stints.get(s.driverNr)?.[s.stintIndex];
				return stint ? { driverNr: s.driverNr, stintIndex: s.stintIndex, stint } : null;
			})
			.filter((x): x is GapChartEntry => x != null);
		return { lapEntries, gapEntries };
	}, [selectedStints, stints]);

	return (
		<div className="flex w-full flex-col gap-4 p-3">
			<div className="rounded-lg border border-zinc-800 p-3">
				<div className="text-lg font-semibold">Replay Review</div>
				<p className="mt-1 text-sm text-zinc-400">
					Load a session, select stints to align, then use the leaderboard and charts with playback.
				</p>
				<div className="mt-3 grid gap-2 md:grid-cols-[minmax(18rem,1fr)_auto_auto] md:items-center">
					<Select
						placeholder="Select a session"
						options={options}
						selected={pickedSessionId}
						setSelected={setPickedSessionId}
					/>
					<Button onClick={handleLoad} disabled={!pickedSessionId}>
						Load
					</Button>
					<div className="text-sm text-zinc-500">
						{sessionsError ?? (sessions ? `${sessions.length} sessions` : "Loading…")}
					</div>
				</div>
				{status === "loading" && (
					<div className="mt-3 text-sm text-zinc-400">Loading laps and stints…</div>
				)}
				{status === "error" && (
					<div className="mt-3 text-sm text-red-400">{error ?? "Failed to load."}</div>
				)}
			</div>

			{status === "ready" && (
				<>
					<div className="rounded-lg border border-zinc-800 p-3">
						<h2 className="mb-3 text-sm font-medium text-zinc-300">Stints</h2>
						<StintTimeline />
					</div>

					<div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
						<div className="flex flex-col gap-2">
							<h2 className="text-sm font-medium text-zinc-300">Aligned leaderboard</h2>
							<AlignedLeaderboard />
						</div>
						<div className="flex flex-col gap-4">
							<div>
								<h2 className="mb-2 text-sm font-medium text-zinc-300">Lap times</h2>
								{chartEntries.lapEntries.length > 0 ? (
									<LapTimeChart entries={chartEntries.lapEntries} alignedLap={alignedLap} />
								) : (
									<div className="flex h-64 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/30 text-sm text-zinc-500">
										Select stints to compare
									</div>
								)}
							</div>
							<div>
								<h2 className="mb-2 text-sm font-medium text-zinc-300">Gap to leader</h2>
								{chartEntries.gapEntries.length > 0 ? (
									<GapChart entries={chartEntries.gapEntries} alignedLap={alignedLap} />
								) : (
									<div className="flex h-64 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/30 text-sm text-zinc-500">
										Select stints to compare
									</div>
								)}
							</div>
						</div>
					</div>

					<div className="rounded-lg border border-zinc-800 p-3">
						<ReviewPlaybackBar />
					</div>
				</>
			)}
		</div>
	);
}
