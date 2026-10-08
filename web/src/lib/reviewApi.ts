import { livePath } from "@/env";
import type { DetectedStint, PitWindow, ReviewLap, ReviewStintRow, SessionDriverRow } from "@/types/review.type";

const withParams = (path: string, params: Record<string, string | number | undefined>) => livePath(path, params);

export async function fetchReviewDrivers(sessionId: string): Promise<SessionDriverRow[]> {
	const res = await fetch(withParams("/api/review/drivers", { sessionId }), { cache: "no-store" });
	if (!res.ok) throw new Error(`review drivers request failed: ${res.status}`);
	return (await res.json()) as SessionDriverRow[];
}

export async function fetchReviewLaps(sessionId: string): Promise<ReviewLap[]> {
	const res = await fetch(withParams("/api/review/laps", { sessionId }), { cache: "no-store" });
	if (!res.ok) throw new Error(`review laps request failed: ${res.status}`);
	const rows = (await res.json()) as ReviewLap[];
	return rows.map((r) => ({
		...r,
		driverNr: Number(r.driverNr),
		lap: r.lap ?? 0,
	}));
}

export async function fetchReviewStints(sessionId: string): Promise<ReviewStintRow[]> {
	const res = await fetch(withParams("/api/review/stints", { sessionId }), { cache: "no-store" });
	if (!res.ok) throw new Error(`review stints request failed: ${res.status}`);
	const rows = (await res.json()) as ReviewStintRow[];
	return rows.map((r) => ({ ...r, driverNr: Number(r.driverNr), lap: r.lap ?? 0 }));
}

export async function fetchReviewPitWindows(sessionId: string): Promise<PitWindow[]> {
	const res = await fetch(withParams("/api/review/pit-windows", { sessionId }), { cache: "no-store" });
	if (!res.ok) throw new Error(`review pit-windows request failed: ${res.status}`);
	const rows = (await res.json()) as PitWindow[];
	return rows.map((r) => ({
		...r,
		driverNr: Number(r.driverNr),
		enterTime: r.enterTime,
		exitTime: r.exitTime,
	}));
}

const RACE_SIM_MIN_LAPS = 5;

/** Gap between lap completions (ms) above which we treat as stint break when no pit windows. Normal lap ~90–120s; use 3 min to only split on clear pit/long stop. */
const STINT_BREAK_GAP_MS = 180_000;

/**
 * Window (ms) after pit EXIT to consider a lap as an out-lap.
 * The out-lap ends at the first S/F crossing after exiting the pit.
 * On most circuits, that crossing is within 30–120 s of the pit exit.
 */
const OUT_LAP_MARGIN_MS = 150_000; // 2.5 min — covers slow out-laps on longer tracks

/**
 * Window (ms) after the last lap ends to consider it a cool-down / in-lap.
 * After the S/F crossing that ends the last lap, the driver heads to the pit entrance.
 * On circuits where the pit entrance is well past the S/F line this can take up to ~120 s.
 */
const IN_LAP_MARGIN_MS = 150_000; // 2.5 min

/**
 * Find compound for a given lap from tire rows (nearest lap <= targetLap).
 */
function compoundAtLap(tireRows: ReviewStintRow[], targetLap: number): string {
	let best: ReviewStintRow | null = null;
	for (const r of tireRows) {
		const lap = r.lap ?? 0;
		if (lap <= targetLap && (!best || (best.lap ?? 0) < lap)) best = r;
	}
	return best?.compound ?? "UNKNOWN";
}

/**
 * Exclude:
 *  - First lap if it is an out-lap: the first S/F crossing after a pit exit falls within OUT_LAP_MARGIN_MS
 *    of that exit.
 *  - Last lap if it is a cool-down / in-lap: a pit entry falls within IN_LAP_MARGIN_MS after that lap ends.
 *
 * For performance analysis only counted (flying) laps matter, so in/out laps are excluded.
 */
function countedLapsForStint(
	laps: ReviewLap[],
	windows: PitWindow[],
): ReviewLap[] {
	if (laps.length === 0) return [];
	if (laps.length === 1) return laps;

	const firstTimeMs = new Date(laps[0]!.time).getTime();
	const lastLap = laps[laps.length - 1]!;
	const lastTimeMs = new Date(lastLap.time).getTime();

	// Drop first lap if it ends within OUT_LAP_MARGIN_MS of a pit exit (= out-lap)
	let dropFirst = false;
	for (const w of windows) {
		const exitMs = new Date(w.exitTime).getTime();
		const delta = firstTimeMs - exitMs;
		if (delta >= 0 && delta <= OUT_LAP_MARGIN_MS) {
			dropFirst = true;
			break;
		}
	}

	// Drop last lap if a pit entry occurs within IN_LAP_MARGIN_MS after that lap ends (= cool-down / in-lap).
	// We only look at pit entries that are strictly after the last lap ended, not ones that happened
	// during the lap itself (those would be handled by the stint-break logic in buildStints).
	let dropLast = false;
	for (const w of windows) {
		const enterMs = new Date(w.enterTime).getTime();
		const delta = enterMs - lastTimeMs;
		if (delta >= 0 && delta <= IN_LAP_MARGIN_MS) {
			dropLast = true;
			break;
		}
	}

	if (!dropFirst && !dropLast) return laps;
	if (dropFirst && dropLast && laps.length <= 2) return [];
	const start = dropFirst ? 1 : 0;
	const end = dropLast ? laps.length - 1 : laps.length;
	return laps.slice(start, end);
}

/**
 * Group laps into stints per driver: consecutive laps without going through the pits.
 * Break when a pit window overlaps the gap between two lap completions and its duration
 * is greater than maxPitTimeToKeepStintSeconds (short visits like drive-through stay same stint).
 * When no pit windows exist (e.g. legacy data), break only when gap between laps > 3 min.
 * Compound is taken from tire data at the first lap of each stint.
 */
export function buildStints(
	laps: ReviewLap[],
	stintRows: ReviewStintRow[],
	sessionType: string | undefined,
	pitWindows: PitWindow[],
	maxPitTimeToKeepStintSeconds: number,
): Map<number, DetectedStint[]> {
	const lapsByDriver = new Map<number, ReviewLap[]>();
	for (const lap of laps) {
		const nr = Number(lap.driverNr);
		const list = lapsByDriver.get(nr) ?? [];
		list.push({ ...lap, driverNr: nr });
		lapsByDriver.set(nr, list);
	}
	for (const list of Array.from(lapsByDriver.values())) {
		list.sort((a, b) => a.lap - b.lap);
	}

	const tireByDriver = new Map<number, ReviewStintRow[]>();
	for (const row of stintRows) {
		const nr = Number(row.driverNr);
		const list = tireByDriver.get(nr) ?? [];
		list.push({ ...row, driverNr: nr, lap: row.lap ?? 0 });
		tireByDriver.set(nr, list);
	}
	for (const list of Array.from(tireByDriver.values())) {
		list.sort((a, b) => a.lap - b.lap);
	}

	const pitWindowsByDriver = new Map<number, PitWindow[]>();
	for (const w of pitWindows) {
		const nr = Number(w.driverNr);
		const list = pitWindowsByDriver.get(nr) ?? [];
		list.push({ ...w, driverNr: nr });
		pitWindowsByDriver.set(nr, list);
	}

	const maxPitMs = Math.max(0, maxPitTimeToKeepStintSeconds) * 1000;
	const isPractice =
		typeof sessionType === "string" && sessionType.toLowerCase().includes("practice");

	const result = new Map<number, DetectedStint[]>();

	for (const [driverNr, driverLaps] of Array.from(lapsByDriver.entries())) {
		if (driverLaps.length === 0) continue;

		const tireRows = tireByDriver.get(driverNr) ?? [];
		const windows = pitWindowsByDriver.get(driverNr) ?? [];
		const stints: DetectedStint[] = [];
		let currentLaps: ReviewLap[] = [driverLaps[0]!];

		for (let i = 1; i < driverLaps.length; i++) {
			const prevLap = driverLaps[i - 1]!;
			const currLap = driverLaps[i]!;
			const prevTimeMs = new Date(prevLap.time).getTime();
			const currTimeMs = new Date(currLap.time).getTime();
			const gapMs = currTimeMs - prevTimeMs;

			let breakStint = false;
			if (windows.length > 0) {
				for (const w of windows) {
					const enterMs = new Date(w.enterTime).getTime();
					const exitMs = new Date(w.exitTime).getTime();
					const durationMs = exitMs - enterMs;
					const overlaps = enterMs < currTimeMs && exitMs > prevTimeMs;
					if (overlaps && durationMs > maxPitMs) {
						breakStint = true;
						break;
					}
				}
			} else {
				// No pit windows (e.g. legacy data): break stint on large gap between lap completions
				if (gapMs > STINT_BREAK_GAP_MS) breakStint = true;
			}

			if (breakStint) {
				const startLap = currentLaps[0]!.lap;
				const endLap = currentLaps[currentLaps.length - 1]!.lap;
				const counted = countedLapsForStint(currentLaps, windows);
				const withTime = counted.filter((l) => l.lastLaptimeMs != null && l.lastLaptimeMs > 0);
				stints.push({
					driverNr,
					startLap,
					endLap,
					compound: compoundAtLap(tireRows, startLap),
					lapCount: withTime.length,
					isRaceSim:
						isPractice && withTime.length >= RACE_SIM_MIN_LAPS && compoundAtLap(tireRows, startLap) !== "UNKNOWN",
					laps: [...currentLaps],
					countedLaps: counted,
				});
				currentLaps = [currLap];
			} else {
				currentLaps.push(currLap);
			}
		}

		const startLap = currentLaps[0]!.lap;
		const endLap = currentLaps[currentLaps.length - 1]!.lap;
		const counted = countedLapsForStint(currentLaps, windows);
		const withTime = counted.filter((l) => l.lastLaptimeMs != null && l.lastLaptimeMs > 0);
		stints.push({
			driverNr,
			startLap,
			endLap,
			compound: compoundAtLap(tireRows, startLap),
			lapCount: withTime.length,
			isRaceSim:
				isPractice && withTime.length >= RACE_SIM_MIN_LAPS && compoundAtLap(tireRows, startLap) !== "UNKNOWN",
			laps: currentLaps,
			countedLaps: counted,
		});

		if (stints.length > 0) result.set(driverNr, stints);
	}

	return result;
}
