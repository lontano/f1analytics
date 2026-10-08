import { useEffect, useState } from "react";

import Round from "@/components/schedule/Round";

import type { Round as RoundType } from "@/types/schedule.type";

import { env } from "@/env";

export default function Schedule() {
	const [schedule, setSchedule] = useState<RoundType[] | null | undefined>(undefined);

	useEffect(() => {
		let cancelled = false;
		fetch(`${env.API_URL}/api/schedule`)
			.then((res) => res.json())
			.then((rows: RoundType[]) => {
				if (!cancelled) setSchedule(rows);
			})
			.catch(() => {
				if (!cancelled) setSchedule(null);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	if (schedule === undefined) return <div className="h-44 animate-pulse rounded-md bg-zinc-800" />;
	if (!schedule) {
		return (
			<div className="flex h-44 flex-col items-center justify-center">
				<p>Schedule not found</p>
			</div>
		);
	}

	const next = schedule.filter((round) => !round.over)[0];
	return (
		<div className="mb-20 grid grid-cols-1 gap-8 md:grid-cols-2">
			{schedule.map((round, roundI) => (
				<Round nextName={next?.name} round={round} key={`round.${roundI}`} />
			))}
		</div>
	);
}
