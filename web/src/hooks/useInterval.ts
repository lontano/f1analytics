"use client";

import { useEffect, useRef } from "react";

/**
 * Runs a callback on a fixed interval (ms).
 * The callback ref is updated on every render so it always sees the latest
 * closures — the interval itself is only created/destroyed when intervalMs changes.
 */
export function useInterval(callback: () => void, intervalMs: number) {
	const savedCallback = useRef(callback);

	useEffect(() => {
		savedCallback.current = callback;
	}, [callback]);

	useEffect(() => {
		const id = setInterval(() => savedCallback.current(), intervalMs);
		return () => clearInterval(id);
	}, [intervalMs]);
}
