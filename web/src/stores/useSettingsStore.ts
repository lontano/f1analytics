import { persist, createJSONStorage, subscribeWithSelector } from "zustand/middleware";
import { create } from "zustand";

type SpeedUnit = "metric" | "imperial";
type MainIntervalMode = "leader" | "previous";

type SettingsStore = {
	delay: number;
	setDelay: (delay: number) => void;

	speedUnit: SpeedUnit;
	setSpeedUnit: (speedUnit: SpeedUnit) => void;

	showCornerNumbers: boolean;
	setShowCornerNumbers: (showCornerNumbers: boolean) => void;

	carMetrics: boolean;
	setCarMetrics: (carMetrics: boolean) => void;

	tableHeaders: boolean;
	setTableHeaders: (tableHeaders: boolean) => void;

	showBestSectors: boolean;
	setShowBestSectors: (showBestSectors: boolean) => void;

	showMiniSectors: boolean;
	setShowMiniSectors: (showMiniSectors: boolean) => void;

	showEstimatedLap: boolean;
	setShowEstimatedLap: (showEstimatedLap: boolean) => void;

	mainIntervalMode: MainIntervalMode;
	setMainIntervalMode: (mainIntervalMode: MainIntervalMode) => void;

	oledMode: boolean;
	setOledMode: (oledMode: boolean) => void;

	useSafetyCarColors: boolean;
	setUseSafetyCarColors: (useSafetyCarColors: boolean) => void;

	favoriteDrivers: string[];
	setFavoriteDrivers: (favoriteDrivers: string[]) => void;
	removeFavoriteDriver: (driver: string) => void;

	raceControlChime: boolean;
	setRaceControlChime: (raceControlChime: boolean) => void;

	raceControlChimeVolume: number;
	setRaceControlChimeVolume: (raceControlChimeVolume: number) => void;

	delayIsPaused: boolean;
	setDelayIsPaused: (delayIsPaused: boolean) => void;

	/** Max pit time (seconds) to still count as same stint. Pit stops longer than this start a new stint. */
	maxPitTimeToKeepStintSeconds: number;
	setMaxPitTimeToKeepStintSeconds: (seconds: number) => void;

	smoothPositions: boolean;
	setSmoothPositions: (smoothPositions: boolean) => void;
};

export const useSettingsStore = create<SettingsStore>()(
	subscribeWithSelector(
		persist(
			(set) => ({
				delay: 0,
				setDelay: (delay: number) => set({ delay }),

				speedUnit: "metric",
				setSpeedUnit: (speedUnit: SpeedUnit) => set({ speedUnit }),

				showCornerNumbers: false,
				setShowCornerNumbers: (showCornerNumbers: boolean) => set({ showCornerNumbers }),

				carMetrics: false,
				setCarMetrics: (carMetrics: boolean) => set({ carMetrics }),

				tableHeaders: false,
				setTableHeaders: (tableHeaders: boolean) => set({ tableHeaders }),

				showBestSectors: true,
				setShowBestSectors: (showBestSectors: boolean) => set({ showBestSectors }),

				showMiniSectors: true,
				setShowMiniSectors: (showMiniSectors: boolean) => set({ showMiniSectors }),

				showEstimatedLap: false,
				setShowEstimatedLap: (showEstimatedLap: boolean) => set({ showEstimatedLap }),

				mainIntervalMode: "leader",
				setMainIntervalMode: (mainIntervalMode: MainIntervalMode) => set({ mainIntervalMode }),

				oledMode: false,
				setOledMode: (oledMode: boolean) => set({ oledMode }),

				useSafetyCarColors: true,
				setUseSafetyCarColors: (useSafetyCarColors: boolean) => set({ useSafetyCarColors }),

				favoriteDrivers: [],
				setFavoriteDrivers: (favoriteDrivers: string[]) => set({ favoriteDrivers }),
				removeFavoriteDriver: (driver: string) =>
					set((state) => ({ favoriteDrivers: state.favoriteDrivers.filter((d) => d !== driver) })),

				raceControlChime: false,
				setRaceControlChime: (raceControlChime: boolean) => set({ raceControlChime }),

				raceControlChimeVolume: 50,
				setRaceControlChimeVolume: (raceControlChimeVolume: number) => set({ raceControlChimeVolume }),

				delayIsPaused: true,
				setDelayIsPaused: (delayIsPaused: boolean) => set({ delayIsPaused }),

				maxPitTimeToKeepStintSeconds: 30,
				setMaxPitTimeToKeepStintSeconds: (maxPitTimeToKeepStintSeconds: number) =>
					set({ maxPitTimeToKeepStintSeconds: Math.max(0, Math.min(300, maxPitTimeToKeepStintSeconds)) }),

				smoothPositions: false,
				setSmoothPositions: (smoothPositions: boolean) => set({ smoothPositions }),
			}),
			{
				name: "settings-storage",
				storage: createJSONStorage(() => localStorage),
				onRehydrateStorage: (state) => {
					return () => state.setDelayIsPaused(false);
				},
			},
		),
	),
);
