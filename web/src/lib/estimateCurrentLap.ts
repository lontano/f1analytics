// Re-export everything from the canonical lapModel module so any existing
// import paths pointing here continue to work.
export {
	parseTimeMs,
	formatLapTimeMs,
	countSegments,
	buildReferenceModel,
	estimateCurrentLap,
} from "@/lib/lapModel";

export type { ReferenceModel, SectorQuality, LapConfidence, LapEstimate } from "@/lib/lapModel";
