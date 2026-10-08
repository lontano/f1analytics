'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { usePathname } from "@/compat/navigation";

import { useDataEngine } from '@/hooks/useDataEngine';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useStores } from '@/hooks/useStores';
import { useSocket } from '@/hooks/useSocket';
import { useSegmentWeightUpdater } from '@/hooks/useSegmentWeightUpdater';

import { useSettingsStore } from '@/stores/useSettingsStore';
import { useSidebarStore } from '@/stores/useSidebarStore';
import { useDataStore } from '@/stores/useDataStore';
import { useReplayStore } from '@/stores/useReplayStore';

import Sidebar from '@/components/Sidebar';
import SidenavButton from '@/components/SidenavButton';
import SessionInfo from '@/components/SessionInfo';
import WeatherInfo from '@/components/WeatherInfo';
import TrackInfo from '@/components/TrackInfo';
import DelayInput from '@/components/DelayInput';
import DelayTimer from '@/components/DelayTimer';
import ConnectionStatus from '@/components/ConnectionStatus';
import DataAvailability from '@/components/DataAvailability';
import ReplayProvider from '@/components/ReplayProvider';
import ReplayControlsBar from '@/components/ReplayControlsBar';

type Props = {
	children: ReactNode;
};

export default function DashboardLayout({ children }: Props) {
	const replayMode = useReplayStore((s) => s.mode);

	const [liveConnected, setLiveConnected] = useState<boolean>(false);
	const [maxDelay, setMaxDelay] = useState<number>(0);

	const handleLiveStatus = useCallback((s: { connected: boolean; maxDelay: number }) => {
		setLiveConnected(s.connected);
		setMaxDelay(s.maxDelay);
	}, []);

	const connected = replayMode === 'live' ? liveConnected : true;

	const delay = useSettingsStore((state) => state.delay);
	const syncing = replayMode === 'live' ? delay > maxDelay : false;

	useWakeLock();
	useSegmentWeightUpdater();

	const ended = useDataStore(({ state }) => state?.SessionStatus?.Status === 'Ends');
	const pathname = usePathname();
	const allowWhileSyncing = pathname.startsWith('/dashboard/raw') || pathname.startsWith('/dashboard/replay');

	return (
		<div className="flex h-screen w-full md:pt-2 md:pr-2 md:pb-2">
			<Sidebar key="sidebar" connected={connected} />

			<motion.div layout="size" className="flex h-full w-full flex-1 flex-col md:gap-2">
				{replayMode === 'live' && <LiveTimingConnection onStatus={handleLiveStatus} />}
				{replayMode === 'replay' && <ReplayProvider />}

				<DesktopStaticBar show={!syncing || ended || allowWhileSyncing} />
				<MobileStaticBar show={!syncing || ended || allowWhileSyncing} connected={connected} />
				{replayMode === 'replay' && <ReplayControlsBar />}

				<div
					className={
						!syncing || ended || allowWhileSyncing
							? 'no-scrollbar w-full flex-1 overflow-auto md:rounded-lg'
							: 'hidden'
					}
				>
					<MobileDynamicBar />
					{children}
				</div>

				<div
					className={
						syncing && !ended && !allowWhileSyncing
							? 'flex h-full flex-1 flex-col items-center justify-center gap-2 border-zinc-800 md:rounded-lg md:border'
							: 'hidden'
					}
				>
					<h1 className="my-20 text-center text-5xl font-bold">Syncing...</h1>
					<p>Please wait for {delay - maxDelay} seconds.</p>
					<p>Or make your delay smaller.</p>
				</div>
			</motion.div>
		</div>
	);
}

function LiveTimingConnection({ onStatus }: { onStatus: (s: { connected: boolean; maxDelay: number }) => void }) {
	const stores = useStores();
	const { handleInitial, handleUpdate, maxDelay } = useDataEngine(stores);
	const { connected } = useSocket({ handleInitial, handleUpdate });

	useEffect(() => {
		onStatus({ connected, maxDelay });
	}, [connected, maxDelay, onStatus]);

	return null;
}

function MobileDynamicBar() {
	return (
		<div className="flex flex-col divide-y divide-zinc-800 border-b border-zinc-800 md:hidden">
			<div className="p-2">
				<SessionInfo />
			</div>
			<div className="p-2">
				<WeatherInfo />
			</div>
		</div>
	);
}

function MobileStaticBar({ show, connected }: { show: boolean; connected: boolean }) {
	const open = useSidebarStore((state) => state.open);

	return (
		<div className="flex w-full items-center justify-between overflow-hidden border-b border-zinc-800 p-2 md:hidden">
			<div className="flex items-center gap-2">
				<SidenavButton key="mobile" onClick={() => open()} />

				<DelayInput saveDelay={500} />
				<DelayTimer />

				<ConnectionStatus connected={connected} />
			</div>

			{show && (
				<div className="flex items-center gap-2">
					<DataAvailability />
					<TrackInfo />
				</div>
			)}
		</div>
	);
}

function DesktopStaticBar({ show }: { show: boolean }) {
	const pinned = useSidebarStore((state) => state.pinned);
	const pin = useSidebarStore((state) => state.pin);

	return (
		<div className="hidden w-full flex-row justify-between overflow-hidden rounded-lg border border-zinc-800 p-2 md:flex">
			<div className="flex items-center gap-2">
				<AnimatePresence>
					{!pinned && <SidenavButton key="desktop" className="shrink-0" onClick={() => pin()} />}

					<motion.div key="session-info" layout="position">
						<SessionInfo />
					</motion.div>
				</AnimatePresence>
			</div>

			<div className="hidden md:items-center lg:flex">{show && <WeatherInfo />}</div>

			<div className="flex items-center justify-end gap-3">
				{show && <DataAvailability />}
				{show && <TrackInfo />}
			</div>
		</div>
	);
}
