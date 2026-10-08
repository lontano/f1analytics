"use client";

import { useEffect, useRef } from "react";

import type { CarData, CarsData, Position, Positions, State } from "@/types/state.type";
import type { RawEvent } from "@/types/raw.type";

import { fetchRawBounds, fetchRawEvents, fetchRawInitial } from "@/lib/rawApi";
import { inflate } from "@/lib/inflate";
import { merge } from "@/lib/merge";

import { useDataStore } from "@/stores/useDataStore";
import { useReplayStore } from "@/stores/useReplayStore";

type ReplayUpdate = {
	timeMs: number;
	topic: string;
	data: unknown;
};

type Snapshot = {
	absMs: number;
	index: number;
	state: State;
	cars: CarsData | null;
	pos: Positions | null;
};

const SNAPSHOT_INTERVAL_MS = 5_000;

const normalizeTopic = (topic: string) => {
	const trimmed = topic.trim();
	if (!trimmed) return trimmed;
	return trimmed.endsWith(".z") ? `${trimmed.slice(0, -2)}Z` : trimmed;
};

const normalizeInitialState = (raw: unknown): Record<string, unknown> => {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	// Handle wrapped format from recordings: { type, state: {...} }
	const obj = raw as Record<string, unknown>;
	const src =
		obj.state && typeof obj.state === "object" && !Array.isArray(obj.state)
			? (obj.state as Record<string, unknown>)
			: obj;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(src)) {
		out[normalizeTopic(k)] = v;
	}
	return out;
};

const clone = <T,>(v: T): T => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const sc = (globalThis as any).structuredClone as undefined | ((x: unknown) => unknown);
	if (typeof sc === "function") return sc(v) as T;
	return JSON.parse(JSON.stringify(v)) as T;
};

const safeParseMs = (v: string | null | undefined) => {
	if (!v) return null;
	const ms = Date.parse(v);
	return Number.isFinite(ms) ? ms : null;
};

export default function ReplayProvider() {
	const mode = useReplayStore((s) => s.mode);
	const sessionId = useReplayStore((s) => s.sessionId);
	const playing = useReplayStore((s) => s.playing);
	const speed = useReplayStore((s) => s.speed);
	const currentMs = useReplayStore((s) => s.currentMs);
	const durationMs = useReplayStore((s) => s.durationMs);

	const setStatus = useReplayStore((s) => s.setStatus);
	const setLoadingProgress = useReplayStore((s) => s.setLoadingProgress);
	const setMeta = useReplayStore((s) => s.setMeta);
	const setCurrentMs = useReplayStore((s) => s.setCurrentMs);
	const setPlaying = useReplayStore((s) => s.setPlaying);
	const setTrackStatusTimeline = useReplayStore((s) => s.setTrackStatusTimeline);

	const setState = useDataStore((s) => s.setState);
	const setCarsData = useDataStore((s) => s.setCarsData);
	const setPositions = useDataStore((s) => s.setPositions);

	const startAbsMsRef = useRef<number>(0);
	const updatesRef = useRef<ReplayUpdate[]>([]);
	const indexRef = useRef<number>(0);
	const stateRef = useRef<State>({} as State);
	const carsRef = useRef<CarsData | null>(null);
	const posRef = useRef<Positions | null>(null);
	const snapshotsRef = useRef<Snapshot[]>([]);
	const lastSnapshotAbsRef = useRef<number>(0);

	const loadedRef = useRef<boolean>(false);

	const internalSetRef = useRef<boolean>(false);
	const currentMsRef = useRef<number>(0);

	const intervalRef = useRef<number | null>(null);
	const lastRealRef = useRef<number>(0);

	useEffect(() => {
		currentMsRef.current = currentMs;
	}, [currentMs]);

	const publish = () => {
		setState(stateRef.current);
		setCarsData(carsRef.current);
		setPositions(posRef.current);
	};

	const maybeSnapshot = (absMs: number) => {
		if (absMs - lastSnapshotAbsRef.current < SNAPSHOT_INTERVAL_MS) return;

		snapshotsRef.current.push({
			absMs,
			index: indexRef.current,
			state: clone(stateRef.current),
			cars: clone(carsRef.current),
			pos: clone(posRef.current),
		});
		lastSnapshotAbsRef.current = absMs;
	};

	const applyOne = (u: ReplayUpdate) => {
		if (u.topic === "CarDataZ") {
			if (typeof u.data === "string") {
				try {
					const carData = inflate<CarData>(u.data);
					const last = carData.Entries?.[carData.Entries.length - 1];
					if (last?.Cars) carsRef.current = last.Cars;
				} catch {
					// ignore
				}
			}
			return;
		}

		if (u.topic === "PositionZ") {
			if (typeof u.data === "string") {
				try {
					const posData = inflate<Position>(u.data);
					const last = posData.Position?.[posData.Position.length - 1];
					if (last?.Entries) posRef.current = last.Entries;
				} catch {
					// ignore
				}
			}
			return;
		}

		const updateObj: Record<string, unknown> = { [u.topic]: u.data };
		stateRef.current = merge(stateRef.current, updateObj) as State;
	};

	const applyUntilAbs = (targetAbsMs: number) => {
		const updates = updatesRef.current;
		while (indexRef.current < updates.length && updates[indexRef.current].timeMs <= targetAbsMs) {
			const u = updates[indexRef.current];
			applyOne(u);
			indexRef.current += 1;
			maybeSnapshot(u.timeMs);
		}
	};

	const seekAbs = (targetAbsMs: number) => {
		const snaps = snapshotsRef.current;
		let bestIdx = 0;
		let lo = 0;
		let hi = snaps.length - 1;
		while (lo <= hi) {
			const mid = Math.floor((lo + hi) / 2);
			if (snaps[mid].absMs <= targetAbsMs) {
				bestIdx = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}

		const snap = snaps[bestIdx];
		stateRef.current = clone(snap.state);
		carsRef.current = clone(snap.cars);
		posRef.current = clone(snap.pos);
		indexRef.current = snap.index;
		lastSnapshotAbsRef.current = snap.absMs;

		applyUntilAbs(targetAbsMs);
		publish();
	};

	// Load replay data when switching sessions.
	useEffect(() => {
		if (mode !== "replay" || !sessionId) return;

		let cancelled = false;

		(async () => {
			try {
				setStatus("loading", null);
				setLoadingProgress("Fetching session metadata…");
				loadedRef.current = false;

				updatesRef.current = [];
				indexRef.current = 0;
				snapshotsRef.current = [];
				lastSnapshotAbsRef.current = 0;

				setState(null);
				setCarsData(null);
				setPositions(null);

				let bounds, initialEv;
				try {
					[bounds, initialEv] = await Promise.all([fetchRawBounds(sessionId), fetchRawInitial(sessionId)]);
				} catch (e) {
					throw new Error(`Failed to fetch session data: ${e instanceof Error ? e.message : String(e)}`);
				}
				if (cancelled) return;

				const totalEvents = bounds.eventCount ?? 0;
				console.log("[ReplayProvider] session bounds:", { minTime: bounds.minTime, maxTime: bounds.maxTime, eventCount: totalEvents });

				const minAbs = safeParseMs(bounds.minTime) ?? safeParseMs(initialEv.time) ?? Date.now();
				const maxAbs = safeParseMs(bounds.maxTime) ?? minAbs;

				startAbsMsRef.current = minAbs;
				const dur = Math.max(0, maxAbs - minAbs);
				setMeta({
					startTime: bounds.minTime ?? initialEv.time,
					endTime: bounds.maxTime,
					durationMs: dur,
					eventCount: totalEvents,
				});

				if (totalEvents === 0) {
					throw new Error("Session has no events to replay.");
				}

				setLoadingProgress("Applying initial state…");

				const initialNormalized = normalizeInitialState(initialEv.data);
				const carZ = typeof initialNormalized.CarDataZ === "string" ? (initialNormalized.CarDataZ as string) : null;
				const posZ = typeof initialNormalized.PositionZ === "string" ? (initialNormalized.PositionZ as string) : null;

				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const { CarDataZ: _c, PositionZ: _p, ...topicState } = initialNormalized;
				stateRef.current = topicState as unknown as State;

				carsRef.current = null;
				posRef.current = null;

				if (carZ) {
					try {
						const carData = inflate<CarData>(carZ);
						const first = carData.Entries?.[0];
						if (first?.Cars) carsRef.current = first.Cars;
					} catch {
						console.warn("[ReplayProvider] failed to inflate initial CarDataZ");
					}
				}

				if (posZ) {
					try {
						const posData = inflate<Position>(posZ);
						const first = posData.Position?.[0];
						if (first?.Entries) posRef.current = first.Entries;
					} catch {
						console.warn("[ReplayProvider] failed to inflate initial PositionZ");
					}
				}

				publish();

				setLoadingProgress(`Loading events (0 / ~${totalEvents})…`);

				const all: RawEvent[] = [];
				let cursor: number | undefined = undefined;
				let pageNum = 0;

				for (let guard = 0; guard < 50_000; guard++) {
					let page: RawEvent[];
					try {
						page = await fetchRawEvents({ sessionId, cursor, limit: 500 });
					} catch (e) {
						throw new Error(`Failed to fetch events (page ${pageNum + 1}, loaded ${all.length} so far): ${e instanceof Error ? e.message : String(e)}`);
					}
					if (cancelled) return;

					if (page.length === 0) break;
					all.push(...page);
					pageNum++;

					setLoadingProgress(`Loading events (${all.length} / ~${totalEvents})…`);

					const last = page[page.length - 1];
					if (!last) break;

					const nextCursor = last.id;
					if (cursor === nextCursor) break;
					cursor = nextCursor;

					if (page.length < 500) break;
				}

				console.log("[ReplayProvider] fetched", all.length, "raw events in", pageNum, "pages");

				setLoadingProgress("Processing timeline…");

				const updates = all
					.filter(
						(e) =>
							String(e.eventType).toLowerCase() === "update" &&
							typeof e.topic === "string" &&
							e.topic.length > 0,
					)
					.map((e) => ({
						timeMs: safeParseMs(e.time) ?? 0,
						topic: normalizeTopic(e.topic as string),
						data: e.data,
					}))
					.filter((e) => e.timeMs > 0 && e.topic.length > 0)
					.sort((a, b) => (a.timeMs !== b.timeMs ? a.timeMs - b.timeMs : 0));

				console.log("[ReplayProvider] usable update events:", updates.length, "duration (raw):", Math.round(dur / 1000), "s");

				// A stored snapshot has an initial state and no timeline. Keep it
				// viewable; playback stays at that single moment.

				// Trim the timeline to the first/last actual event so idle gaps at
				// the beginning and end of the recording are cropped away.
				const firstEventMs = updates.length > 0 ? updates[0].timeMs : minAbs;
				const lastEventMs = updates.length > 0 ? updates[updates.length - 1].timeMs : maxAbs;
				const trimmedStart = Math.max(minAbs, firstEventMs);
				const trimmedDur = Math.max(0, lastEventMs - trimmedStart);

				// Apply initial events that fall before the trimmed window.
				startAbsMsRef.current = trimmedStart;
				for (let k = 0; k < updates.length; k++) {
					if (updates[k].timeMs > trimmedStart) break;
					applyOne(updates[k]);
					indexRef.current = k + 1;
				}
				publish();

				setMeta({
					startTime: new Date(trimmedStart).toISOString(),
					endTime: new Date(trimmedStart + trimmedDur).toISOString(),
					durationMs: trimmedDur,
					eventCount: totalEvents,
				});

				// Build track status timeline for progress bar coloring.
				{
					const statusEvents = updates.filter((u) => u.topic === "TrackStatus");
					const segments: { startMs: number; endMs: number; status: number }[] = [];
					for (const ev of statusEvents) {
						const data = ev.data as { Status?: string } | null;
						const code = data?.Status ? Number.parseInt(data.Status, 10) : 0;
						if (!Number.isFinite(code) || code <= 0) continue;
						const relMs = Math.max(0, ev.timeMs - trimmedStart);
						if (segments.length > 0) {
							segments[segments.length - 1]!.endMs = relMs;
						}
						segments.push({ startMs: relMs, endMs: trimmedDur, status: code });
					}
					setTrackStatusTimeline(segments);
				}

				updatesRef.current = updates;

				snapshotsRef.current = [
					{
						absMs: startAbsMsRef.current,
						index: indexRef.current,
						state: clone(stateRef.current),
						cars: clone(carsRef.current),
						pos: clone(posRef.current),
					},
				];
				lastSnapshotAbsRef.current = startAbsMsRef.current;

				internalSetRef.current = true;
				setCurrentMs(0);
				setTimeout(() => {
					internalSetRef.current = false;
				}, 0);
				currentMsRef.current = 0;

				loadedRef.current = true;
				setLoadingProgress(null);
				setStatus("ready", null);
			} catch (e) {
				if (cancelled) return;
				const msg =
					e instanceof Error
						? e.message
						: typeof e === "string"
							? e
							: "failed to load replay session";
				console.error("[ReplayProvider] load error:", e);
				setLoadingProgress(null);
				setStatus("error", msg);
			}
		})();

		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mode, sessionId]);

	// Respond to user scrubbing (seek).
	useEffect(() => {
		if (mode !== "replay") return;
		if (!loadedRef.current) return;
		if (internalSetRef.current) return;

		const abs = startAbsMsRef.current + currentMs;
		seekAbs(abs);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mode, currentMs]);

	// Playback loop.
	useEffect(() => {
		if (mode !== "replay") return;
		if (!loadedRef.current) return;

		if (!playing) {
			if (intervalRef.current) {
				window.clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
			return;
		}

		lastRealRef.current = performance.now();

		intervalRef.current = window.setInterval(() => {
			const now = performance.now();
			const deltaReal = now - lastRealRef.current;
			lastRealRef.current = now;

			let next = currentMsRef.current + deltaReal * speed;
			if (next >= durationMs) {
				next = durationMs;
			}

			const abs = startAbsMsRef.current + next;
			applyUntilAbs(abs);
			publish();

			currentMsRef.current = next;
			internalSetRef.current = true;
			setCurrentMs(next);
			setTimeout(() => {
				internalSetRef.current = false;
			}, 0);

			if (next >= durationMs) {
				setPlaying(false);
			}
		}, 120);

		return () => {
			if (intervalRef.current) {
				window.clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mode, playing, speed, durationMs]);

	// Hard stop when leaving replay mode.
	useEffect(() => {
		if (mode === "replay") return;
		if (intervalRef.current) {
			window.clearInterval(intervalRef.current);
			intervalRef.current = null;
		}
		loadedRef.current = false;
		updatesRef.current = [];
		snapshotsRef.current = [];
		indexRef.current = 0;
	}, [mode]);

	return null;
}

