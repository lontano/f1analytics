"use client";

import { create } from "zustand";

export type ReplayMode = "live" | "replay";
export type ReplayStatus = "idle" | "loading" | "ready" | "error";

export type TrackStatusSegment = {
	startMs: number;
	endMs: number;
	status: number;
};

type ReplayStore = {
	mode: ReplayMode;
	status: ReplayStatus;
	error: string | null;
	loadingProgress: string | null;

	sessionId: string | null;

	startTime: string | null; // RFC3339
	endTime: string | null; // RFC3339
	durationMs: number;
	eventCount: number;

	currentMs: number;
	playing: boolean;
	speed: number;

	trackStatusTimeline: TrackStatusSegment[];

	setMode: (mode: ReplayMode) => void;
	startReplay: (sessionId: string) => void;
	stopReplay: () => void;

	setStatus: (status: ReplayStatus, error?: string | null) => void;
	setLoadingProgress: (msg: string | null) => void;
	setMeta: (meta: { startTime: string | null; endTime: string | null; durationMs: number; eventCount: number }) => void;
	setTrackStatusTimeline: (timeline: TrackStatusSegment[]) => void;

	setCurrentMs: (ms: number) => void;
	setPlaying: (v: boolean) => void;
	setSpeed: (v: number) => void;
};

export const useReplayStore = create<ReplayStore>((set, get) => ({
	mode: "live",
	status: "idle",
	error: null,
	loadingProgress: null,

	sessionId: null,

	startTime: null,
	endTime: null,
	durationMs: 0,
	eventCount: 0,

	currentMs: 0,
	playing: false,
	speed: 1,

	trackStatusTimeline: [],

	setMode: (mode) => {
		if (mode === "live") {
			set({
				mode: "live",
				status: "idle",
				error: null,
				sessionId: null,
				startTime: null,
				endTime: null,
				durationMs: 0,
				eventCount: 0,
				currentMs: 0,
				playing: false,
				speed: 1,
			});
			return;
		}

		// Switching to replay without selecting a session keeps current selection.
		set({ mode: "replay" });
	},

	startReplay: (sessionId) => {
		set({
			mode: "replay",
			status: "loading",
			error: null,
			loadingProgress: "Connecting…",
			sessionId,
			currentMs: 0,
			playing: false,
		});
	},

	stopReplay: () => {
		get().setMode("live");
	},

	setStatus: (status, error = null) => set({ status, error, loadingProgress: status === "ready" || status === "error" ? null : undefined }),
	setLoadingProgress: (msg) => set({ loadingProgress: msg }),
	setMeta: ({ startTime, endTime, durationMs, eventCount }) =>
		set({
			startTime,
			endTime,
			durationMs: Math.max(0, Math.floor(durationMs)),
			eventCount,
		}),

	setTrackStatusTimeline: (timeline) => set({ trackStatusTimeline: timeline }),

	setCurrentMs: (ms) => {
		const { durationMs } = get();
		const clamped = Math.min(Math.max(0, Math.floor(ms)), Math.max(0, Math.floor(durationMs)));
		set({ currentMs: clamped });
	},
	setPlaying: (v) => set({ playing: v }),
	setSpeed: (v) => set({ speed: Math.min(Math.max(v, 0.1), 20) }),
}));

