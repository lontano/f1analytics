"use client";

import { useEffect } from "react";

import { useDataStore } from "@/stores/useDataStore";
import { useSegmentWeightStore } from "@/stores/useSegmentWeightStore";

/**
 * Call once at a high level (dashboard layout).
 * On every TimingData tick it stamps the wall-clock time of each new
 * mini-sector crossing and, when a sector completes, calibrates the
 * per-mini-sector weight fractions for that driver/sector pair.
 */
export function useSegmentWeightUpdater() {
	const timingData = useDataStore((s) => s.state?.TimingData);
	const ingest = useSegmentWeightStore((s) => s.ingest);

	useEffect(() => {
		if (!timingData) return;
		ingest(timingData);
	}, [timingData, ingest]);
}
