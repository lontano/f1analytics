import { useEffect, useState } from "react";
import { utc } from "@/compat/moment";

import Countdown from "@/components/schedule/Countdown";
import Round from "@/components/schedule/Round";

import { env } from "@/env";
import type { Round as RoundType } from "@/types/schedule.type";

export default function NextRound() {
	const [next, setNext] = useState<RoundType | null | undefined>(undefined);

	useEffect(() => {
		let cancelled = false;
		fetch(`${env.API_URL}/api/schedule/next`)
			.then((res) => res.json())
			.then((row: RoundType) => {
				if (!cancelled) setNext(row);
			})
			.catch(() => {
				if (!cancelled) setNext(null);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	if (next === undefined) return <div className="h-44 animate-pulse rounded-md bg-zinc-800" />;
	if (!next) {
		return (
			<div className="flex h-44 flex-col items-center justify-center">
				<p>No upcoming weekend found</p>
			</div>
		);
	}

	const nextSession = next.sessions.filter((session) => utc(session.start) > utc() && session.kind.toLowerCase() !== "race")[0];
	const nextRace = next.sessions.find((session) => session.kind.toLowerCase() === "race");

	return (
		<div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
			{nextSession || nextRace ? (
				<div className="flex flex-col gap-4">
					{nextSession && <Countdown next={nextSession} type="other" />}
					{nextRace && <Countdown next={nextRace} type="race" />}
				</div>
			) : (
				<div className="flex flex-col items-center justify-center">
					<p>No upcoming sessions found</p>
				</div>
			)}
			<Round round={next} />
		</div>
	);
}
