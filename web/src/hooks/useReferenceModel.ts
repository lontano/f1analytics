"use client";

import { useMemo } from "react";

import { useDataStore } from "@/stores/useDataStore";
import { buildReferenceModel } from "@/lib/lapModel";
import type { ReferenceModel } from "@/lib/lapModel";

/**
 * Derives the reference lap model from the live TimingStats feed.
 *
 * The reference is recomputed whenever any driver posts a new personal-best
 * sector time, giving an up-to-date field-median template throughout the
 * session. No external store or side-effects needed.
 */
export function useReferenceModel(): ReferenceModel {
	const timingStats = useDataStore((s) => s.state?.TimingStats);
	return useMemo(() => buildReferenceModel(timingStats), [timingStats]);
}
