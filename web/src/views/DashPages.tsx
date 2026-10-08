import type { ReactNode } from "react";

import DashboardPage from "@/app/dashboard/page";
import RawPage from "@/app/dashboard/raw/page";
import ReplayPage from "@/app/dashboard/replay/page";
import ReviewPage from "@/app/dashboard/review/page";
import SettingsPage from "@/app/dashboard/settings/page";
import StandingsPage from "@/app/dashboard/standings/page";
import StintPage from "@/app/dashboard/stint-graph/page";
import TrackMapPage from "@/app/dashboard/track-map/page";
import WeatherPage from "@/app/dashboard/weather/page";
import HelpPage from "@/app/(nav)/help/page";
import SchedulePage from "@/app/(nav)/schedule/page";
import type { ViewKind } from "@/shell/nav";

const pages: Record<ViewKind, () => ReactNode> = {
	dashboard: () => <DashboardPage />,
	"track-map": () => <TrackMapPage />,
	standings: () => <StandingsPage />,
	weather: () => <WeatherPage />,
	stint: () => <StintPage />,
	review: () => <ReviewPage />,
	replay: () => <ReplayPage />,
	raw: () => <RawPage />,
	schedule: () => <SchedulePage />,
	help: () => <HelpPage />,
	session: () => <SettingsPage />,
};

export function DashPage({ kind }: { kind: ViewKind }) {
	const render = pages[kind];
	return render ? render() : null;
}
