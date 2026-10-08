export const PUBLIC_ENV_KEY = "__ENV";

const liveUrl = import.meta.env.VITE_LIVE_URL || "/timing-live";
const scheduleUrl = import.meta.env.VITE_SCHEDULE_URL || "/timing-api";

export const env = {
	NEXT_PUBLIC_LIVE_URL: liveUrl,
	API_URL: scheduleUrl,
	NODE_ENV: import.meta.env.MODE,
	TRACKING_ID: undefined as string | undefined,
	TRACKING_URL: undefined as string | undefined,
	DISABLE_IFRAME: undefined as string | undefined,
};

export function livePath(path: string, params?: Record<string, string | number | undefined>) {
	const root = env.NEXT_PUBLIC_LIVE_URL.replace(/\/$/, "");
	const suffix = path.startsWith("/") ? path : `/${path}`;
	const url = new URL(`${root}${suffix}`, window.location.origin);
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined) url.searchParams.set(key, String(value));
		}
	}
	return url.toString();
}
