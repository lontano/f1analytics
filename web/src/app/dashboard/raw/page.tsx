"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

import Select from "@/components/ui/Select";
import Toggle from "@/components/ui/Toggle";
import Button from "@/components/ui/Button";
import SegmentedControls from "@/components/ui/SegmentedControls";

import { env } from "@/env";
import {
	fetchRawEvents,
	fetchRawInitial,
	fetchRawSessions,
	fetchRawTopics,
	formatSessionLabel,
} from "@/lib/rawApi";
import { fetchReviewDrivers, fetchReviewLaps } from "@/lib/reviewApi";

import type { RawEvent, RawSession } from "@/types/raw.type";
import type { ReviewLap } from "@/types/review.type";

type TabKind = "current" | "explore";

type EventItem =
	| { source: "db"; row: RawEvent }
	| { source: "live"; id: string; receivedAt: string; topic: string; data: unknown };

const LIVE_MAX = 500;

const firstTopicKey = (obj: unknown): string | null => {
	if (!obj || typeof obj !== "object") return null;
	const keys = Object.keys(obj as Record<string, unknown>).filter((k) => !k.startsWith("__"));
	return keys.length > 0 ? keys[0] : null;
};

/** Extract pit status for a driver from TimingData payload. */
function getPitStatusForDriver(data: unknown, driverNr: string): {
	inPit: boolean;
	pitOut: boolean;
	inPitLane: boolean;
} {
	const obj = data as Record<string, unknown> | null;
	if (!obj || typeof obj !== "object") return { inPit: false, pitOut: false, inPitLane: false };

	const lines = obj.Lines as Record<string, Record<string, unknown>> | undefined;
	const driver = lines?.[driverNr];
	if (!driver || typeof driver !== "object") return { inPit: false, pitOut: false, inPitLane: false };

	const inPit = driver.InPit === true;
	const pitOut = driver.PitOut === true;

	let inPitLane = false;
	const sectors = driver.Sectors as Array<{ Segments?: Array<{ Status?: number }> }> | undefined;
	if (Array.isArray(sectors)) {
		for (const s of sectors) {
			const segs = s?.Segments;
			if (Array.isArray(segs)) {
				for (const seg of segs) {
					if (seg?.Status === 2064) {
						inPitLane = true;
						break;
					}
				}
			}
			if (inPitLane) break;
		}
	}

	return { inPit, pitOut, inPitLane };
}

export default function RawPage() {
	const liveUrl = env.NEXT_PUBLIC_LIVE_URL;

	const [activeTab, setActiveTab] = useState<TabKind>("current");

	// Shared: sessions
	const [sessions, setSessions] = useState<RawSession[] | null>(null);
	const [sessionsError, setSessionsError] = useState<string | null>(null);
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

	// Current tab
	const [topics, setTopics] = useState<string[] | null>(null);
	const [topicsError, setTopicsError] = useState<string | null>(null);
	const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
	const [events, setEvents] = useState<EventItem[]>([]);
	const [eventsError, setEventsError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [cursor, setCursor] = useState<number | null>(null);
	const [selected, setSelected] = useState<EventItem | null>(null);
	const [fromTime, setFromTime] = useState("");
	const [toTime, setToTime] = useState("");
	const [liveTail, setLiveTail] = useState(false);
	const liveSeq = useRef(0);

	// Explore tab
	const [exploreDrivers, setExploreDrivers] = useState<{ value: string; label: string }[]>([]);
	const [exploreDriver, setExploreDriver] = useState<string | null>(null);
	const [exploreTopics, setExploreTopics] = useState<string[]>([]);
	const [exploreLaps, setExploreLaps] = useState<ReviewLap[]>([]);
	const [exploreLapsChecked, setExploreLapsChecked] = useState<Set<number>>(new Set());
	const [exploreInOutLapOnly, setExploreInOutLapOnly] = useState(false);
	const [exploreEvents, setExploreEvents] = useState<RawEvent[]>([]);
	const [exploreLoading, setExploreLoading] = useState(false);
	const [exploreError, setExploreError] = useState<string | null>(null);
	const [exploreSelected, setExploreSelected] = useState<RawEvent | null>(null);

	const sessionOptions = useMemo(
		() =>
			(sessions ?? []).map((s) => ({
				value: s.id,
				label: formatSessionLabel(s),
			})),
		[sessions],
	);

	const topicOptions = useMemo(
		() => [{ value: null as string | null, label: "All topics" }, ...(topics ?? []).map((t) => ({ value: t, label: t }))],
		[topics],
	);

	const exploreDriverLaps = useMemo(
		() =>
			exploreLaps
				.filter((l) => String(l.driverNr) === exploreDriver)
				.sort((a, b) => a.lap - b.lap),
		[exploreDriver, exploreLaps],
	);

	const loadPage = async (opts: { reset: boolean }) => {
		if (!selectedSessionId) return;
		if (loading) return;

		setLoading(true);
		setEventsError(null);

		try {
			const rows = await fetchRawEvents({
				sessionId: selectedSessionId,
				topic: selectedTopic ?? undefined,
				from: fromTime.trim() ? fromTime.trim() : undefined,
				to: toTime.trim() ? toTime.trim() : undefined,
				cursor: opts.reset ? undefined : cursor ?? undefined,
				limit: 200,
			});

			if (opts.reset) {
				setEvents(rows.map((row) => ({ source: "db" as const, row })));
			} else {
				setEvents((prev) => prev.concat(rows.map((row) => ({ source: "db" as const, row }))));
			}

			const last = rows[rows.length - 1];
			setCursor(last ? last.id : null);
		} catch (e) {
			setEventsError(e instanceof Error ? e.message : "failed to fetch raw events");
		} finally {
			setLoading(false);
		}
	};

	// Load sessions
	useEffect(() => {
		let cancelled = false;
		(async () => {
			setSessions(null);
			setSessionsError(null);
			try {
				const list = await fetchRawSessions(50);
				if (cancelled) return;
				setSessions(list);
				setSelectedSessionId((prev) => prev ?? list[0]?.id ?? null);
			} catch (e) {
				if (cancelled) return;
				setSessionsError(e instanceof Error ? e.message : "failed to fetch sessions");
			}
		})();
		return () => { cancelled = true; };
	}, []);

	// Load topics when session changes
	useEffect(() => {
		if (!selectedSessionId) return;
		let cancelled = false;
		(async () => {
			setTopics(null);
			setTopicsError(null);
			try {
				const list = await fetchRawTopics(selectedSessionId);
				if (cancelled) return;
				setTopics(list);
			} catch (e) {
				if (cancelled) return;
				setTopicsError(e instanceof Error ? e.message : "failed to fetch topics");
				setTopics([]);
			}
		})();
		return () => { cancelled = true; };
	}, [selectedSessionId]);

	// Current tab: load events when session/topic/time changes
	useEffect(() => {
		if (!selectedSessionId) return;
		setEvents([]);
		setCursor(null);
		setSelected(null);
		void loadPage({ reset: true });
	}, [selectedSessionId, selectedTopic, fromTime, toTime]);

	// Live tail
	useEffect(() => {
		if (!liveTail) return;
		const es = new EventSource(`${liveUrl}/api/realtime`);
		es.addEventListener("update", (message) => {
			try {
				const parsed = JSON.parse((message as MessageEvent).data) as unknown;
				const topic = firstTopicKey(parsed);
				if (!topic) return;
				const data = (parsed as Record<string, unknown>)[topic];
				const item: EventItem = {
					source: "live",
					id: `live-${liveSeq.current++}`,
					receivedAt: new Date().toISOString(),
					topic,
					data,
				};
				setEvents((prev) => [item, ...prev].slice(0, LIVE_MAX));
			} catch {
				// ignore
			}
		});
		return () => es.close();
	}, [liveTail, liveUrl]);

	// Explore: load drivers from initial + review
	useEffect(() => {
		if (!selectedSessionId || activeTab !== "explore") return;
		let cancelled = false;
		(async () => {
			try {
				const [initial, reviewDrivers] = await Promise.all([
					fetchRawInitial(selectedSessionId).catch(() => null),
					fetchReviewDrivers(selectedSessionId).catch(() => []),
				]);

				if (cancelled) return;

				const driverMap = new Map<string, string>();
				if (initial?.data && typeof initial.data === "object") {
					const raw = initial.data as Record<string, unknown>;
					const state = (raw.state ?? raw) as Record<string, unknown>;
					const dl = state?.DriverList as Record<string, { RacingNumber: string; Tla: string }> | undefined;
					if (dl) {
						for (const d of Object.values(dl)) {
							if (d?.RacingNumber && d?.Tla) driverMap.set(d.RacingNumber, d.Tla);
						}
					}
				}
				for (const r of reviewDrivers) {
					const nr = String(r.driverNr);
					if (!driverMap.has(nr)) driverMap.set(nr, `Driver ${nr}`);
				}
				setExploreDrivers(
					Array.from(driverMap.entries())
						.sort(([a], [b]) => Number(a) - Number(b))
						.map(([value, label]) => ({ value, label })),
				);
				setExploreDriver((prev) => (driverMap.has(prev ?? "") ? prev : driverMap.keys().next().value ?? null));
			} catch {
				// ignore
			}
		})();
	}, [selectedSessionId, activeTab]);

	// Explore: load laps when driver changes
	useEffect(() => {
			if (!selectedSessionId || !exploreDriver) {
				setExploreLaps([]);
				setExploreLapsChecked(new Set());
				return;
			}
		let cancelled = false;
		(async () => {
			try {
				const laps = await fetchReviewLaps(selectedSessionId);
				if (cancelled) return;
				setExploreLaps(laps);
				setExploreLapsChecked(new Set());
			} catch {
				setExploreLaps([]);
				setExploreLapsChecked(new Set());
			}
		})();
		return () => { cancelled = true; };
	}, [selectedSessionId, exploreDriver]);

	// Explore: load events (full or by lap)
	const loadExploreEvents = async () => {
		if (!selectedSessionId) return;
		setExploreLoading(true);
		setExploreError(null);
		try {
			let from: string | undefined;
			let to: string | undefined;
			if (exploreLapsChecked.size > 0 && exploreDriver) {
				const driverLaps = exploreLaps
					.filter((l) => String(l.driverNr) === exploreDriver)
					.sort((a, b) => a.lap - b.lap);
				const lapsInRange = driverLaps.filter((l) => exploreLapsChecked.has(l.lap));
				if (lapsInRange.length > 0) {
					const firstIdx = driverLaps.findIndex((l) => l.lap === lapsInRange[0]!.lap);
					const lastIdx = driverLaps.findIndex((l) => l.lap === lapsInRange[lapsInRange.length - 1]!.lap);
					from = firstIdx > 0 ? driverLaps[firstIdx - 1]!.time : undefined;
					to = driverLaps[lastIdx]!.time;
				}
			}
			const rows = await fetchRawEvents({
				sessionId: selectedSessionId,
				from,
				to,
				limit: 1000,
			});
			const chrono = [...rows].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
			setExploreEvents(chrono);
		} catch (e) {
			setExploreError(e instanceof Error ? e.message : "failed to fetch events");
			setExploreEvents([]);
		} finally {
			setExploreLoading(false);
		}
	};

	const selectedJson = useMemo(() => {
		if (activeTab === "explore") {
			if (!exploreSelected) return null;
			const data = exploreSelected.data;
			try {
				return JSON.stringify(data, null, 2);
			} catch {
				return String(data);
			}
		}
		const item = selected;
		if (!item) return null;
		const data = item.source === "db" ? item.row.data : item.data;
		try {
			return JSON.stringify(data, null, 2);
		} catch {
			return String(data);
		}
	}, [activeTab, selected, exploreSelected]);

	const copySelected = async () => {
		if (!selectedJson) return;
		await navigator.clipboard.writeText(selectedJson);
	};

	const filteredExploreEvents = useMemo(() => {
		let out = exploreEvents;
		if (exploreTopics.length > 0) {
			out = out.filter((ev) => {
				const topic = ev.topic ?? "(initial)";
				return exploreTopics.includes(topic);
			});
		}
		if (exploreInOutLapOnly && exploreDriver) {
			out = out.filter((ev) => {
				const topic = ev.topic ?? "(initial)";
				if (topic !== "TimingData") return false;
				const pit = getPitStatusForDriver(ev.data, exploreDriver);
				return pit.inPit || pit.pitOut || pit.inPitLane;
			});
		}
		return out;
	}, [exploreEvents, exploreTopics, exploreInOutLapOnly, exploreDriver]);

	return (
		<div className="flex h-full w-full flex-col gap-2 p-2 md:p-4">
			<div className="flex flex-col gap-2 rounded-lg border border-zinc-800 p-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<SegmentedControls<TabKind>
						options={[
							{ label: "Current data", value: "current" },
							{ label: "Explore by driver & lap", value: "explore" },
						]}
						selected={activeTab}
						onSelect={setActiveTab}
					/>
					<div className="min-w-[280px]">
						<Select<string>
							placeholder="Select session"
							options={sessionOptions}
							selected={selectedSessionId}
							setSelected={setSelectedSessionId}
						/>
					</div>
				</div>

				{activeTab === "current" && (
					<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
						<div className="flex flex-col gap-2 md:flex-row md:items-center">
							<div className="min-w-[220px]">
								<Select<string | null>
									placeholder="Filter topic"
									options={topicOptions}
									selected={selectedTopic}
									setSelected={setSelectedTopic}
								/>
							</div>
							<div className="flex items-center gap-2">
								<span className="text-sm text-zinc-400">Live tail</span>
								<Toggle enabled={liveTail} setEnabled={setLiveTail} />
							</div>
							<input
								className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white md:w-[260px]"
								placeholder="from (RFC3339, optional)"
								value={fromTime}
								onChange={(e) => setFromTime(e.target.value)}
							/>
							<input
								className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white md:w-[260px]"
								placeholder="to (RFC3339, optional)"
								value={toTime}
								onChange={(e) => setToTime(e.target.value)}
							/>
						</div>
						<div className="flex gap-2">
							<Button onClick={() => void loadPage({ reset: true })} className="px-3 py-2">
								Refresh
							</Button>
							<Button onClick={() => void loadPage({ reset: false })} className="px-3 py-2">
								Load more
							</Button>
						</div>
					</div>
				)}

				{activeTab === "explore" && (
					<div className="flex flex-col gap-4">
						<div className="flex flex-wrap items-end gap-4">
							<div className="min-w-[180px]">
								<label className="mb-1 block text-xs text-zinc-400">Driver</label>
								<select
									value={exploreDriver ?? ""}
									onChange={(e) => setExploreDriver(e.target.value || null)}
									className="w-full cursor-pointer appearance-none rounded-lg border-none bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-zinc-600"
									style={{ WebkitAppearance: "menulist" }}
								>
									<option value="">Select driver</option>
									{exploreDrivers.map((d) => (
										<option key={d.value} value={d.value}>
											{d.label}
										</option>
									))}
								</select>
							</div>
							<Button
								onClick={() => void loadExploreEvents()}
								disabled={exploreLoading}
								className="px-3 py-2"
							>
								{exploreLoading ? "Loading…" : "Load events"}
							</Button>
							<Button
								onClick={() => setExploreInOutLapOnly((v) => !v)}
								className={clsx("px-3 py-2", exploreInOutLapOnly && "bg-amber-800/50 ring-1 ring-amber-600")}
							>
								In-lap / Out-lap only
							</Button>
						</div>
						<div className="flex flex-wrap gap-6">
							<div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
								<label className="mb-2 block text-xs font-medium text-zinc-400">Topics</label>
								<div className="max-h-40 overflow-y-auto space-y-1.5">
									{(topics ?? []).map((t) => (
										<label key={t} className="flex cursor-pointer items-center gap-2">
											<input
												type="checkbox"
												checked={exploreTopics.includes(t)}
												onChange={(e) =>
													setExploreTopics((prev) =>
														e.target.checked ? [...prev, t] : prev.filter((x) => x !== t),
													)
												}
												className="h-4 w-4 rounded border-zinc-600 bg-zinc-900"
											/>
											<span className="text-sm text-zinc-200">{t}</span>
										</label>
									))}
									{(topics ?? []).length === 0 && (
										<span className="text-xs text-zinc-500">No topics</span>
									)}
								</div>
							</div>
							<div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
								<label className="mb-2 block text-xs font-medium text-zinc-400">Laps</label>
								<div className="max-h-40 overflow-y-auto space-y-1.5">
									{exploreDriverLaps.map((l) => (
										<label key={l.lap} className="flex cursor-pointer items-center gap-2">
											<input
												type="checkbox"
												checked={exploreLapsChecked.has(l.lap)}
												onChange={(e) =>
													setExploreLapsChecked((prev) => {
														const next = new Set(prev);
														if (e.target.checked) next.add(l.lap);
														else next.delete(l.lap);
														return next;
													})
												}
												className="h-4 w-4 rounded border-zinc-600 bg-zinc-900"
											/>
											<span className="text-sm text-zinc-200">
												Lap {l.lap} — {l.lastLaptimeMs != null ? `${(l.lastLaptimeMs / 1000).toFixed(2)}s` : "—"}
											</span>
										</label>
									))}
									{exploreDriverLaps.length === 0 && (
										<span className="text-xs text-zinc-500">
											{exploreDriver ? "No laps for this driver" : "Select a driver"}
										</span>
									)}
								</div>
							</div>
						</div>
					</div>
				)}
			</div>

			{sessionsError && (
				<div className="rounded-lg border border-red-900 bg-red-950/30 p-3 text-sm text-red-200">
					{sessionsError}
				</div>
			)}
			{topicsError && (
				<div className="rounded-lg border border-red-900 bg-red-950/30 p-3 text-sm text-red-200">
					{topicsError}
				</div>
			)}
			{eventsError && activeTab === "current" && (
				<div className="rounded-lg border border-red-900 bg-red-950/30 p-3 text-sm text-red-200">
					{eventsError}
				</div>
			)}
			{exploreError && activeTab === "explore" && (
				<div className="rounded-lg border border-red-900 bg-red-950/30 p-3 text-sm text-red-200">
					{exploreError}
				</div>
			)}

			{activeTab === "current" && (
				<div className="grid min-h-0 flex-1 grid-cols-1 gap-2 md:grid-cols-[420px_1fr]">
					<div className="no-scrollbar overflow-auto rounded-lg border border-zinc-800">
						<div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-400">
							<span>{events.length} events</span>
							<span>{loading ? "Loading…" : ""}</span>
						</div>
						<div className="flex flex-col">
							{events.map((ev) => {
								const isSelected = selected === ev;
								const key = ev.source === "db" ? `db-${ev.row.id}` : ev.id;
								const time = ev.source === "db" ? ev.row.time : ev.receivedAt;
								const topic = ev.source === "db" ? ev.row.topic ?? "(initial)" : ev.topic;
								const kind = ev.source === "db" ? ev.row.eventType : "live";
								return (
									<button
										key={key}
										onClick={() => setSelected(ev)}
										className={clsx(
											"cursor-pointer border-b border-zinc-900 p-2 text-left hover:bg-zinc-900",
											isSelected && "bg-zinc-900",
										)}
									>
										<div className="flex items-center justify-between gap-2">
											<div className="truncate text-sm text-white">{topic}</div>
											<div className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-200">
												{kind}
											</div>
										</div>
										<div className="mt-1 truncate text-xs text-zinc-500">{time}</div>
									</button>
								);
							})}
							{events.length === 0 && (
								<div className="p-4 text-sm text-zinc-500">
									No events yet. Enable Live tail to inspect live updates via SSE.
								</div>
							)}
						</div>
					</div>
					<div className="no-scrollbar overflow-auto rounded-lg border border-zinc-800">
						<div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-zinc-950 p-2">
							<div className="text-xs text-zinc-400">Details</div>
							<Button onClick={() => void copySelected()} className="px-3 py-2">
								Copy JSON
							</Button>
						</div>
						<div className="p-3">
							{selectedJson ? (
								<pre className="whitespace-pre-wrap break-words text-xs text-zinc-100">{selectedJson}</pre>
							) : (
								<div className="text-sm text-zinc-500">Select an event to view its payload.</div>
							)}
						</div>
					</div>
				</div>
			)}

			{activeTab === "explore" && (
				<div className="grid min-h-0 flex-1 grid-cols-1 gap-2 md:grid-cols-[420px_1fr]">
					<div className="no-scrollbar overflow-auto rounded-lg border border-zinc-800">
						<div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-400">
							<span>{filteredExploreEvents.length} events</span>
							{exploreDriver && (
								<span className="text-amber-200/80">
									Pit: <strong>In pit</strong> / <strong>Pit out</strong> / <strong>Pit lane</strong> (segment 2064)
								</span>
							)}
						</div>
						<div className="flex flex-col">
							{filteredExploreEvents.map((ev) => {
								const isSelected = exploreSelected?.id === ev.id;
								const topic = ev.topic ?? "(initial)";
								const pit =
									exploreDriver && topic === "TimingData"
										? getPitStatusForDriver(ev.data, exploreDriver)
										: null;
								const hasPit = pit && (pit.inPit || pit.pitOut || pit.inPitLane);
								return (
									<button
										key={ev.id}
										onClick={() => setExploreSelected(ev)}
										className={clsx(
											"cursor-pointer border-b border-zinc-900 p-2 text-left hover:bg-zinc-900",
											isSelected && "bg-zinc-900",
										)}
									>
										<div className="flex items-center justify-between gap-2">
											<div className="truncate text-sm text-white">{topic}</div>
											<div className="flex shrink-0 items-center gap-1">
												{hasPit && (
													<span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] text-amber-200" title="Pit-related: TimingData InPit/PitOut or segment status 2064">
														{pit!.inPit ? "In pit" : pit!.pitOut ? "Pit out" : "Pit lane"}
													</span>
												)}
												<div className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-200">
													{ev.eventType}
												</div>
											</div>
										</div>
										<div className="mt-1 truncate text-xs text-zinc-500">{ev.time}</div>
									</button>
								);
							})}
							{filteredExploreEvents.length === 0 && (
								<div className="p-4 text-sm text-zinc-500">
									Select driver, optional topics/lap, then click Load events.
								</div>
							)}
						</div>
					</div>
					<div className="no-scrollbar overflow-auto rounded-lg border border-zinc-800">
						<div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-zinc-950 p-2">
							<div className="text-xs text-zinc-400">Details</div>
							<Button onClick={() => void copySelected()} className="px-3 py-2">
								Copy JSON
							</Button>
						</div>
						<div className="p-3">
							{selectedJson ? (
								<pre className="whitespace-pre-wrap break-words text-xs text-zinc-100">{selectedJson}</pre>
							) : (
								<div className="text-sm text-zinc-500">Select an event to view its payload.</div>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
