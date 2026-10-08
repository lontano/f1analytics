import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { useDataEngine } from "@/hooks/useDataEngine";
import { useSegmentWeightUpdater } from "@/hooks/useSegmentWeightUpdater";
import { useSocket } from "@/hooks/useSocket";
import { useStores } from "@/hooks/useStores";
import { useWakeLock } from "@/hooks/useWakeLock";

import ConnectionStatus from "@/components/ConnectionStatus";
import DataAvailability from "@/components/DataAvailability";
import DelayInput from "@/components/DelayInput";
import DelayTimer from "@/components/DelayTimer";
import OledModeProvider from "@/components/OledModeProvider";
import ReplayProvider from "@/components/ReplayProvider";
import TrackInfo from "@/components/TrackInfo";
import WeatherInfo from "@/components/WeatherInfo";

import { useDataStore } from "@/stores/useDataStore";
import { useReplayStore } from "@/stores/useReplayStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { TabPathProvider } from "@/shell/tabPath";

type SyncState = { syncing: boolean; ended: boolean; connected: boolean };

const SyncContext = createContext<SyncState>({ syncing: false, ended: false, connected: false });

export function TimingSession({ children }: { children: ReactNode }) {
	const replayMode = useReplayStore((state) => state.mode);
	const [liveConnected, setLiveConnected] = useState(false);
	const [maxDelay, setMaxDelay] = useState(0);
	const delay = useSettingsStore((state) => state.delay);
	const ended = useDataStore(({ state }) => state?.SessionStatus?.Status === "Ends");
	const connected = replayMode === "live" ? liveConnected : true;
	const syncing = replayMode === "live" ? delay > maxDelay : false;

	const handleLiveStatus = useCallback((status: { connected: boolean; maxDelay: number }) => {
		setLiveConnected(status.connected);
		setMaxDelay(status.maxDelay);
	}, []);

	useWakeLock();
	useSegmentWeightUpdater();

	return (
		<OledModeProvider>
			<SyncContext.Provider value={{ syncing, ended: Boolean(ended), connected }}>
				{replayMode === "live" && <LiveTimingConnection onStatus={handleLiveStatus} />}
				{replayMode === "replay" && <ReplayProvider />}
				{children}
			</SyncContext.Provider>
		</OledModeProvider>
	);
}

export function TimingPane({ path, children }: { path: string; children: ReactNode }) {
	const { syncing, ended, connected } = useContext(SyncContext);
	const delay = useSettingsStore((state) => state.delay);
	const allow = path.startsWith("/dashboard/raw") || path.startsWith("/dashboard/replay") || !path.startsWith("/dashboard");
	const show = !syncing || ended || allow;

	return (
		<TabPathProvider path={path}>
			<div className="timing-stage">
				<div className="mb-2 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-zinc-800 p-2">
					<ConnectionStatus connected={connected} />
					<div className="hidden lg:block">
						<WeatherInfo />
					</div>
					<DelayInput saveDelay={500} />
					<DelayTimer />
					{show && <DataAvailability />}
					{show && <TrackInfo />}
				</div>
				{show ? (
					children
				) : (
					<div className="flex h-64 flex-col items-center justify-center gap-2">
						<h1 className="text-3xl font-bold">Syncing...</h1>
						<p>Please wait for {Math.max(delay, 0)} seconds of timing history.</p>
						<p>Or make the delay smaller.</p>
					</div>
				)}
			</div>
		</TabPathProvider>
	);
}

function LiveTimingConnection({ onStatus }: { onStatus: (status: { connected: boolean; maxDelay: number }) => void }) {
	const stores = useStores();
	const { handleInitial, handleUpdate, maxDelay } = useDataEngine(stores);
	const { connected } = useSocket({ handleInitial, handleUpdate });

	useEffect(() => {
		onStatus({ connected, maxDelay });
	}, [connected, maxDelay, onStatus]);

	return null;
}
