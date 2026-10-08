export type RawSession = {
	id: string;
	createdAt: string;
	startedAt: string | null;
	endedAt: string | null;

	meetingKey: number | null;
	sessionKey: number | null;
	sessionName: string | null;
	sessionType: string | null;
	sessionPath: string | null;

	startDate: string | null;
	endDate: string | null;

	sessionInfo: unknown | null;
};

export type RawEvent = {
	id: number;
	time: string;
	receivedAt: string;

	sessionId: string;
	eventType: string;
	topic: string | null;

	data: unknown;
	signalrTimestamp: string | null;
};

export type RawEventsQuery = {
	sessionId: string;
	topic?: string;
	from?: string;
	to?: string;
	cursor?: number;
	limit?: number;
};

export type RawSessionBounds = {
	sessionId: string;
	minTime: string | null;
	maxTime: string | null;
	eventCount: number;
};

