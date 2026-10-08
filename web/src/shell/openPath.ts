type Opener = (href: string) => void;

let opener: Opener | null = null;

export function setPathOpener(next: Opener | null) {
  opener = next;
}

export function openDashboardPath(href: string) {
  opener?.(href);
}
