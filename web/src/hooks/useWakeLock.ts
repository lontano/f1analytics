import { useEffect, useRef } from "react";

export const useWakeLock = () => {
	const wakeLock = useRef<null | WakeLockSentinel>(null);

	useEffect(() => {
		const host = window.location.hostname;
		if (!window.isSecureContext) return;
		if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return;
		if (!("wakeLock" in navigator)) return;

		let cancelled = false;
		navigator.wakeLock
			.request("screen")
			.then((wl) => {
				if (cancelled) {
					void wl.release();
					return;
				}
				wakeLock.current = wl;
			})
			.catch(() => {});

		return () => {
			cancelled = true;
			if (wakeLock.current) void wakeLock.current.release();
			wakeLock.current = null;
		};
	}, []);
};
