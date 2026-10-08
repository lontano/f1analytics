export type Prefs = {
  delay: number;
  showSectors: boolean;
  compactBoard: boolean;
  playbackRate: number;
};

export const defaultPrefs: Prefs = {
  delay: 0,
  showSectors: true,
  compactBoard: false,
  playbackRate: 1,
};
