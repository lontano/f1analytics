"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";

import type { RawSession } from "@/types/raw.type";

import { fetchRawSessions, formatSessionLabel } from "@/lib/rawApi";
import { useReplayStore } from "@/stores/useReplayStore";

import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";

export default function ReplayPage() {
	const [sessions, setSessions] = useState<RawSession[] | null>(null);
	const [sessionsError, setSessionsError] = useState<string | null>(null);
	const [pickedSessionId, setPickedSessionId] = useState<string | null>(null);

	const mode = useReplayStore((s) => s.mode);
	const status = useReplayStore((s) => s.status);
	const error = useReplayStore((s) => s.error);
	const loadingProgress = useReplayStore((s) => s.loadingProgress);
	const eventCount = useReplayStore((s) => s.eventCount);
	const durationMs = useReplayStore((s) => s.durationMs);

	const loadedSessionId = useReplayStore((s) => s.sessionId);
	const startReplay = useReplayStore((s) => s.startReplay);
	const stopReplay = useReplayStore((s) => s.stopReplay);
	const setPlaying = useReplayStore((s) => s.setPlaying);

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

	const canLoad = !!pickedSessionId && mode !== "replay";
	const canReload = !!pickedSessionId && mode === "replay" && pickedSessionId !== loadedSessionId;

	return (
		<div className="flex w-full flex-col gap-3 p-3">
			<div className="rounded-lg border border-zinc-800 p-3">
				<div className="flex items-center justify-between gap-2">
					<div className="text-lg font-semibold">Replay</div>
					{mode === "replay" && (
						<Button
							onClick={() => {
								setPlaying(false);
								stopReplay();
							}}
							className="bg-zinc-900!"
						>
							Back to live
						</Button>
					)}
				</div>

				<div className="mt-3 grid gap-2 md:grid-cols-[minmax(18rem,1fr)_auto_auto] md:items-center">
					<Select
						placeholder="Select a stored session"
						options={options}
						selected={pickedSessionId}
						setSelected={setPickedSessionId}
					/>

					<Button
						onClick={() => {
							if (!pickedSessionId) return;
							startReplay(pickedSessionId);
						}}
						className={clsx({ "opacity-50 pointer-events-none": !canLoad && !canReload })}
					>
						{canReload ? "Load" : "Start replay"}
					</Button>

					<div className="text-sm text-zinc-500">
						{sessionsError ? sessionsError : sessions ? `${sessions.length} sessions` : "Loading sessions..."}
					</div>
				</div>

				{status === "loading" && (
					<div className="mt-3 text-sm text-zinc-400">{loadingProgress ?? "Loading replay data…"}</div>
				)}
				{status === "error" && <div className="mt-3 text-sm text-red-400">{error ?? "Replay failed to load."}</div>}
				{status === "ready" && (
					<div className="mt-3 flex items-center gap-3 text-sm text-emerald-400">
						<span>
							Ready — {eventCount.toLocaleString()} events
							{durationMs > 0 ? `, ${Math.round(durationMs / 1000)}s duration` : " (snapshot)"}
						</span>
						<span className="text-zinc-500">
							{durationMs > 0
								? "Navigate to any dashboard page and press play."
								: "Navigate to any dashboard page to view the stored session."}
						</span>
					</div>
				)}
			</div>
		</div>
	);
}

