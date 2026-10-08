import { useEffect, useMemo, useState } from "react";

import { utc, duration } from "@/compat/moment";
import { fetchRawSessions } from "@/lib/rawApi";
import type { RawSession } from "@/types/raw.type";
import { useDataStore } from "@/stores/useDataStore";
import { useReplayStore } from "@/stores/useReplayStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

import { readJson, writeJson } from "./storage";

type Pref = { mode: "live" | "replay"; sessionId: string | null };

const PREF_KEY = "f1a.transport";

function meetingName(session: RawSession): string {
	const info = session.sessionInfo as { Meeting?: { Name?: string } } | null;
	return info?.Meeting?.Name ?? "Unknown Grand Prix";
}

function fmt(ms: number) {
	const s = Math.max(0, Math.floor(ms / 1000));
	const hh = Math.floor(s / 3600);
	const mm = Math.floor((s % 3600) / 60);
	const ss = s % 60;
	if (hh > 0) return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
	return `${mm}:${String(ss).padStart(2, "0")}`;
}

export function TransportBar() {
	const [sessions, setSessions] = useState<RawSession[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [pickedId, setPickedId] = useState<string | null>(() => readJson<Pref>(PREF_KEY, { mode: "replay", sessionId: null }).sessionId);
	const [now, setNow] = useState(() => new Date());

	const mode = useReplayStore((s) => s.mode);
	const sessionId = useReplayStore((s) => s.sessionId);
	const status = useReplayStore((s) => s.status);
	const error = useReplayStore((s) => s.error);
	const loadingProgress = useReplayStore((s) => s.loadingProgress);
	const startTime = useReplayStore((s) => s.startTime);
	const durationMs = useReplayStore((s) => s.durationMs);
	const currentMs = useReplayStore((s) => s.currentMs);
	const playing = useReplayStore((s) => s.playing);
	const speed = useReplayStore((s) => s.speed);
	const startReplay = useReplayStore((s) => s.startReplay);
	const stopReplay = useReplayStore((s) => s.stopReplay);
	const setCurrentMs = useReplayStore((s) => s.setCurrentMs);
	const setPlaying = useReplayStore((s) => s.setPlaying);
	const setSpeed = useReplayStore((s) => s.setSpeed);

	const clock = useDataStore((s) => s.state?.ExtrapolatedClock);
	const sessionInfo = useDataStore((s) => s.state?.SessionInfo);
	const delay = useSettingsStore((s) => s.delay);

	useEffect(() => {
		const id = window.setInterval(() => setNow(new Date()), 1000);
		return () => window.clearInterval(id);
	}, []);

	useEffect(() => {
		let cancelled = false;
		fetchRawSessions(200)
			.then((data) => {
				if (!cancelled) setSessions(data);
			})
			.catch((e: unknown) => {
				if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load sessions");
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (sessionId) setPickedId(sessionId);
	}, [sessionId]);

	useEffect(() => {
		if (!sessions?.length) return;
		const pref = readJson<Pref>(PREF_KEY, { mode: "replay", sessionId: null });
		if (pref.mode === "live") return;
		const id = sessions.some((s) => s.id === pref.sessionId) ? pref.sessionId : sessions[0].id;
		if (!id) return;
		setPickedId(id);
		const current = useReplayStore.getState();
		if (current.mode === "replay" && current.sessionId === id && (current.status === "loading" || current.status === "ready")) return;
		writeJson(PREF_KEY, { mode: "replay", sessionId: id });
		startReplay(id);
	}, [sessions, startReplay]);

	const meetings = useMemo(() => {
		const map = new Map<string, RawSession[]>();
		for (const session of sessions ?? []) {
			const name = meetingName(session);
			const list = map.get(name) ?? [];
			list.push(session);
			map.set(name, list);
		}
		return [...map.entries()]
			.map(([name, list]) => {
				list.sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
				const latest = list.reduce((max, session) => ((session.startDate ?? "") > max ? (session.startDate ?? "") : max), "");
				return { name, sessions: list, latest };
			})
			.sort((a, b) => b.latest.localeCompare(a.latest));
	}, [sessions]);

	const picked = sessions?.find((session) => session.id === pickedId) ?? null;
	const gpName = picked ? meetingName(picked) : (meetings[0]?.name ?? "");
	const gpSessions = meetings.find((meeting) => meeting.name === gpName)?.sessions ?? [];

	function choose(id: string) {
		setPickedId(id);
		writeJson(PREF_KEY, { mode: "replay", sessionId: id });
		const current = useReplayStore.getState();
		if (current.mode === "replay" && current.sessionId === id && current.status !== "error") return;
		setPlaying(false);
		startReplay(id);
	}

	function onMeeting(name: string) {
		const group = meetings.find((meeting) => meeting.name === name);
		const next = group?.sessions[group.sessions.length - 1];
		if (next) choose(next.id);
	}

	function goLive() {
		setPlaying(false);
		writeJson(PREF_KEY, { mode: "live", sessionId: pickedId });
		stopReplay();
	}

	const timeRemaining =
		clock?.Remaining
			? mode === "replay"
				? clock.Remaining
				: clock.Extrapolating
					? utc(duration(clock.Remaining).subtract(utc().diff(utc(clock.Utc))).asMilliseconds() + delay * 1000).format("HH:mm:ss")
					: clock.Remaining
			: null;

	const startAbs = startTime ? Date.parse(startTime) : NaN;
	const at = Number.isFinite(startAbs) ? new Date(startAbs + currentMs) : null;
	const canPlay = mode === "replay" && status === "ready" && durationMs > 0;
	const sessionClock = timeRemaining ?? (mode === "replay" ? fmt(currentMs) : "—");
	const sessionClockLabel = timeRemaining ? "Remaining" : "Session";

	let note = loadError;
	if (!note && status === "loading") note = loadingProgress ?? "Loading session…";
	if (!note && status === "error") note = error ?? "Session failed to load";
	if (!note && mode === "live" && !sessionInfo) note = "No live timing. Pick a stored Grand Prix to load its data.";
	if (!note && mode === "replay" && status === "ready" && durationMs === 0) note = "Snapshot — this recording has no timeline to play.";

	return (
		<div className="transport">
			<div className="transport-clock">
				<span className="transport-k">Now</span>
				<strong>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</strong>
			</div>

			<label className="transport-field">
				<span className="transport-k">Grand Prix</span>
				<select value={gpName} disabled={!meetings.length} onChange={(event) => onMeeting(event.target.value)}>
					{meetings.length === 0 && <option value="">{sessions ? "No sessions" : "Loading…"}</option>}
					{meetings.map((meeting) => (
						<option key={meeting.name} value={meeting.name}>
							{meeting.name}
						</option>
					))}
				</select>
			</label>

			<label className="transport-field">
				<span className="transport-k">Session</span>
				<select value={pickedId ?? ""} disabled={!gpSessions.length} onChange={(event) => choose(event.target.value)}>
					{gpSessions.map((session) => (
						<option key={session.id} value={session.id}>
							{session.sessionName ?? "Session"}
						</option>
					))}
				</select>
			</label>

			<div className="transport-clock">
				<span className="transport-k">{sessionClockLabel}</span>
				<strong>{sessionClock}</strong>
			</div>

			<div className="transport-play">
				<button type="button" disabled={!canPlay} onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>
					{playing ? "Pause" : "Play"}
				</button>
				<select
					aria-label="Playback speed"
					value={speed}
					disabled={mode !== "replay"}
					onChange={(event) => setSpeed(Number.parseFloat(event.target.value))}
				>
					{[0.25, 0.5, 1, 2, 5, 10].map((value) => (
						<option key={value} value={value}>
							{value}×
						</option>
					))}
				</select>
				<input
					type="range"
					min={0}
					max={Math.max(0, durationMs)}
					step={250}
					value={Math.min(currentMs, Math.max(0, durationMs))}
					disabled={!canPlay}
					aria-label="Session position"
					onChange={(event) => {
						setPlaying(false);
						setCurrentMs(Number.parseInt(event.target.value, 10));
					}}
				/>
				<span className="transport-elapsed">
					{fmt(currentMs)} / {fmt(durationMs)}
				</span>
				{at && <span className="transport-k">{at.toLocaleString()}</span>}
				<button type="button" className={mode === "live" ? "active" : ""} onClick={goLive}>
					Live
				</button>
			</div>

			{note && <p className="transport-note">{note}</p>}
		</div>
	);
}
