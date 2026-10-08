import { livePath } from "@/env";

import type { RawEvent, RawEventsQuery, RawSession, RawSessionBounds } from "@/types/raw.type";

const withParams = (path: string, params: Record<string, string | number | undefined>) => livePath(path, params);

export function formatSessionLabel(s: RawSession): string {
	const info = s.sessionInfo as { Meeting?: { Name?: string } } | null;
	const meeting = info && typeof info === "object" ? info.Meeting?.Name : undefined;
	const name = s.sessionName ?? s.sessionPath ?? s.id;
	const type = s.sessionType ? ` (${s.sessionType})` : "";
	const when = s.startDate ?? s.startedAt ?? s.createdAt;
	const title = meeting ? `${meeting} — ${name}` : name;
	return `${title}${type} — ${when}`;
}

export async function fetchRawSessions(limit = 50): Promise<RawSession[]> {
	const res = await fetch(withParams("/api/raw/sessions", { limit }), { cache: "no-store" });
	if (!res.ok) throw new Error(`raw sessions request failed: ${res.status}`);
	return (await res.json()) as RawSession[];
}

export async function fetchRawTopics(sessionId: string): Promise<string[]> {
	const res = await fetch(withParams("/api/raw/topics", { sessionId }), { cache: "no-store" });
	if (!res.ok) throw new Error(`raw topics request failed: ${res.status}`);
	return (await res.json()) as string[];
}

export async function fetchRawEvents(query: RawEventsQuery): Promise<RawEvent[]> {
	const res = await fetch(
		withParams("/api/raw/events", {
			sessionId: query.sessionId,
			topic: query.topic,
			from: query.from,
			to: query.to,
			cursor: query.cursor,
			limit: query.limit,
		}),
		{ cache: "no-store" },
	);

	if (!res.ok) throw new Error(`raw events request failed: ${res.status}`);
	return (await res.json()) as RawEvent[];
}

export async function fetchRawBounds(sessionId: string): Promise<RawSessionBounds> {
	const res = await fetch(withParams("/api/raw/bounds", { sessionId }), { cache: "no-store" });
	if (!res.ok) throw new Error(`raw bounds request failed: ${res.status}`);
	return (await res.json()) as RawSessionBounds;
}

export async function fetchRawInitial(sessionId: string): Promise<RawEvent> {
	const res = await fetch(withParams("/api/raw/initial", { sessionId }), { cache: "no-store" });
	if (!res.ok) throw new Error(`raw initial request failed: ${res.status}`);
	return (await res.json()) as RawEvent;
}

