import { utc } from "@/compat/moment";

export const utcToLocalMs = (utcDateString: string): number => {
	return utc(utcDateString).local().valueOf();
};
