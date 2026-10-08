export type ReviewLap = {
	driverNr: number;
	lap: number;
	position: number | null;
	gapMs: number | null;
	leaderGapMs: number | null;
	lastLaptimeMs: number | null;
	sector1Ms: number | null;
	sector2Ms: number | null;
	sector3Ms: number | null;
	time: string;
};

export type ReviewStintRow = {
	driverNr: number;
	lap: number;
	compound: string | null;
	stintLaps: number | null;
	time: string;
};

/** One pit visit from timing_driver in_pit_segment. */
export type PitWindow = {
	driverNr: number;
	enterTime: string;
	exitTime: string;
};

export type DetectedStint = {
	driverNr: number;
	startLap: number;
	endLap: number;
	compound: string;
	/** Number of laps with valid time in countedLaps (excludes out-lap first / in-lap last). */
	lapCount: number;
	isRaceSim: boolean;
	/** All laps in the stint (for timeline). */
	laps: ReviewLap[];
	/** Laps used for stats and chart: first (out-lap) and last (in-lap) excluded when they start/end in pits. */
	countedLaps: ReviewLap[];
};

export type SessionDriverRow = {
	driverNr: number;
};

export type SelectedStint = {
	driverNr: number;
	stintIndex: number;
};
