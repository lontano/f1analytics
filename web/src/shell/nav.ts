export type ViewKind =
  | "dashboard"
  | "track-map"
  | "standings"
  | "weather"
  | "stint"
  | "review"
  | "replay"
  | "raw"
  | "schedule"
  | "help"
  | "session";

export type NavItem = { kind: ViewKind; label: string; path: string };
export type Section = { id: string; label: string; icon: string; items: NavItem[] };

export const SECTIONS: Section[] = [
  {
    id: "timing",
    label: "Timing",
    icon: "M4 12h16M12 4v16M5 5l14 14",
    items: [
      { kind: "dashboard", label: "Dashboard", path: "/dashboard" },
      { kind: "track-map", label: "Track Map", path: "/dashboard/track-map" },
      { kind: "standings", label: "Standings", path: "/dashboard/standings" },
      { kind: "weather", label: "Weather", path: "/dashboard/weather" },
      { kind: "session", label: "Session", path: "/dashboard/settings" },
    ],
  },
  {
    id: "analysis",
    label: "Analysis",
    icon: "M4 19V10M10 19V5M16 19v-7M4 19h16",
    items: [
      { kind: "stint", label: "Stint graph", path: "/dashboard/stint-graph" },
      { kind: "review", label: "Review", path: "/dashboard/review" },
      { kind: "replay", label: "Replay", path: "/dashboard/replay" },
    ],
  },
  {
    id: "data",
    label: "Data",
    icon: "M4 6h16M4 12h16M4 18h10",
    items: [
      { kind: "raw", label: "Raw", path: "/dashboard/raw" },
      { kind: "schedule", label: "Schedule", path: "/schedule" },
      { kind: "help", label: "Help", path: "/help" },
    ],
  },
];

export const SETTINGS_ICON = "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM12 3v2.2M12 18.8V21M4.9 6.5l1.6 1.6M17.5 15.9l1.6 1.6M3 12h2.2M18.8 12H21M4.9 17.5l1.6-1.6M17.5 8.1l1.6-1.6";

export function findItem(kind: ViewKind): NavItem | undefined {
  for (const section of SECTIONS) {
    const item = section.items.find((entry) => entry.kind === kind);
    if (item) return item;
  }
  return undefined;
}

export function findSection(kind: ViewKind): Section | undefined {
  return SECTIONS.find((section) => section.items.some((entry) => entry.kind === kind));
}

export function kindForPath(href: string): ViewKind | undefined {
  const path = href.split("?")[0].replace(/\/$/, "") || "/";
  for (const section of SECTIONS) {
    const item = section.items.find((entry) => entry.path === path);
    if (item) return item.kind;
  }
  return undefined;
}
