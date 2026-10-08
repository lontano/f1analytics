"use client";

import { create } from "zustand";
import {
	fetchReviewDrivers,
	fetchReviewLaps,
	fetchReviewStints,
	fetchReviewPitWindows,
	buildStints,
} from "@/lib/reviewApi";
import { useSettingsStore } from "@/stores/useSettingsStore";
import type { DetectedStint, ReviewLap, SelectedStint } from "@/types/review.type";

export type ReviewStatus = "idle" | "loading" | "ready" | "error";

type ReviewStore = {
	sessionId: string | null;
	sessionType: string | null;
	drivers: number[];
	allLaps: ReviewLap[];
	stints: Map<number, DetectedStint[]>;
	selectedStints: SelectedStint[];
	alignedLap: number;
	maxAlignedLap: number;
	playing: boolean;
	speed: number;
	status: ReviewStatus;
	error: string | null;

	loadSession: (sessionId: string, sessionType?: string) => Promise<void>;
	toggleStint: (driverNr: number, stintIndex: number) => void;
	play: () => void;
	pause: () => void;
	setSpeed: (v: number) => void;
	seekLap: (n: number) => void;
	tick: (elapsedMs: number) => void;

	getStintsForDriver: (driverNr: number) => DetectedStint[];
	getSelectedStintEntries: () => { driverNr: number; stint: DetectedStint }[];
	getCumulativeMsAtAlignedLap: (driverNr: number, stintIndex: number, upToLapIndex: number) => number;
	getLeaderboardAtAlignedLap: () => { driverNr: number; stintIndex: number; cumulativeMs: number; lapTimeMs: number | null; gapMs: number }[];
	getAvgLapMsAtAlignedLap: () => number;
};

export const useReviewStore = create<ReviewStore>((set, get) => ({
	sessionId: null,
	sessionType: null,
	drivers: [],
	allLaps: [],
	stints: new Map(),
	selectedStints: [],
	alignedLap: 0,
	maxAlignedLap: 0,
	playing: false,
	speed: 1,
	status: "idle",
	error: null,

	loadSession: async (sessionId, sessionType) => {
		set({ status: "loading", error: null, sessionId, sessionType: sessionType ?? null });
		try {
			const [driversRes, lapsRes, stintsRes, pitWindows] = await Promise.all([
				fetchReviewDrivers(sessionId),
				fetchReviewLaps(sessionId),
				fetchReviewStints(sessionId),
				fetchReviewPitWindows(sessionId),
			]);
			const laps = lapsRes;
			const stintRows = stintsRes;
			const sessionTypeFromStore = get().sessionType;
			const maxPitSeconds = useSettingsStore.getState().maxPitTimeToKeepStintSeconds;
			const stints = buildStints(
				laps,
				stintRows,
				sessionTypeFromStore ?? undefined,
				pitWindows,
				maxPitSeconds,
			);
			set({
				status: "ready",
				drivers: driversRes.map((d) => d.driverNr),
				allLaps: laps,
				stints,
				selectedStints: [],
				alignedLap: 0,
				maxAlignedLap: 0,
			});
		} catch (e) {
			const error = e instanceof Error ? e.message : "Failed to load session";
			set({ status: "error", error });
		}
	},

	toggleStint: (driverNr, stintIndex) => {
		const { selectedStints, stints } = get();
		const list = stints.get(driverNr);
		if (!list || stintIndex < 0 || stintIndex >= list.length) return;
		const stint = list[stintIndex];
		const key = `${driverNr}-${stintIndex}`;
		const exists = selectedStints.some((s) => s.driverNr === driverNr && s.stintIndex === stintIndex);
		let next: SelectedStint[];
		if (exists) {
			next = selectedStints.filter((s) => !(s.driverNr === driverNr && s.stintIndex === stintIndex));
		} else {
			next = [...selectedStints, { driverNr, stintIndex }];
		}
		const lapsLengths = next.map((s) => {
			const st = get().stints.get(s.driverNr)?.[s.stintIndex];
			const laps = st?.countedLaps ?? st?.laps;
			return laps?.length ?? 0;
		});
		const maxAlignedLap = lapsLengths.length > 0 ? Math.min(...lapsLengths) - 1 : 0;
		const alignedLap = Math.min(get().alignedLap, Math.max(0, maxAlignedLap));
		set({
			selectedStints: next,
			maxAlignedLap: Math.max(0, maxAlignedLap),
			alignedLap,
		});
	},

	play: () => set({ playing: true }),
	pause: () => set({ playing: false }),
	setSpeed: (v) => set({ speed: Math.min(Math.max(v, 0.5), 10) }),
	seekLap: (n) => {
		const { maxAlignedLap } = get();
		set({ alignedLap: Math.min(Math.max(0, Math.floor(n)), maxAlignedLap) });
	},

	tick: (elapsedMs) => {
		const { playing, speed, alignedLap, maxAlignedLap } = get();
		if (!playing || alignedLap >= maxAlignedLap) {
			if (playing && alignedLap >= maxAlignedLap) set({ playing: false });
			return;
		}
		const avgMs = get().getAvgLapMsAtAlignedLap();
		if (avgMs <= 0) return;
		const advance = (elapsedMs * speed) / avgMs;
		if (advance >= 1) {
			const next = Math.min(alignedLap + Math.floor(advance), maxAlignedLap);
			set({ alignedLap: next });
			if (next >= maxAlignedLap) set({ playing: false });
		}
	},

	getStintsForDriver: (driverNr) => {
		return get().stints.get(driverNr) ?? [];
	},

	getSelectedStintEntries: () => {
		const { selectedStints, stints } = get();
		return selectedStints
			.map((s) => {
				const stint = stints.get(s.driverNr)?.[s.stintIndex];
				return stint ? { driverNr: s.driverNr, stint } : null;
			})
			.filter((x): x is { driverNr: number; stint: DetectedStint } => x != null);
	},

	getCumulativeMsAtAlignedLap: (driverNr, stintIndex, upToLapIndex) => {
		const { stints } = get();
		const stint = stints.get(driverNr)?.[stintIndex];
		const laps = stint?.countedLaps ?? stint?.laps;
		if (!laps?.length) return 0;
		let sum = 0;
		for (let i = 0; i <= upToLapIndex && i < laps.length; i++) {
			const ms = laps[i]?.lastLaptimeMs;
			if (ms != null && ms > 0) sum += ms;
		}
		return sum;
	},

	getLeaderboardAtAlignedLap: () => {
		const { alignedLap, selectedStints, stints } = get();
		const entries = selectedStints
			.map((s) => {
				const stint = stints.get(s.driverNr)?.[s.stintIndex];
				const laps = stint?.countedLaps ?? stint?.laps;
				if (!laps?.length || alignedLap >= laps.length) return null;
				const lap = laps[alignedLap];
				const cumulativeMs = get().getCumulativeMsAtAlignedLap(s.driverNr, s.stintIndex, alignedLap);
				return {
					driverNr: s.driverNr,
					stintIndex: s.stintIndex,
					cumulativeMs,
					lapTimeMs: lap?.lastLaptimeMs ?? null,
					gapMs: 0,
				};
			})
			.filter((x): x is NonNullable<typeof x> => x != null);
		const minCumulative = Math.min(...entries.map((e) => e.cumulativeMs));
		return entries
			.map((e) => ({ ...e, gapMs: e.cumulativeMs - minCumulative }))
			.sort((a, b) => a.cumulativeMs - b.cumulativeMs);
	},

	getAvgLapMsAtAlignedLap: () => {
		const { alignedLap, getLeaderboardAtAlignedLap } = get();
		const board = getLeaderboardAtAlignedLap();
		const withTime = board.map((e) => e.lapTimeMs).filter((m): m is number => m != null && m > 0);
		if (withTime.length === 0) return 90000;
		return withTime.reduce((a, b) => a + b, 0) / withTime.length;
	},
}));
