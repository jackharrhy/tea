// Shared color palette used by both browser and server. Browser uses it for
// anonymous-user color assignment; server uses it as the deterministic
// fallback when no Discord role color is available.

export const PALETTE_COLORS = [
  "#205ea6", // blue
  "#24837b", // cyan
  "#66800b", // green
  "#ad8301", // yellow
  "#bc5215", // orange
  "#af3029", // red
  "#5e409d", // purple
  "#a02f6f", // magenta
] as const;
