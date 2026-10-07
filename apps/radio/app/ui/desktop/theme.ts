import { css } from "remix/component";

export const DESKTOP_FONT_FAMILY =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const desktopColor = {
  ink: "var(--desktop-ink)",
  line: "var(--desktop-line)",
  paper: "var(--desktop-paper)",
  wash: "var(--desktop-wash)",
  stripe: "var(--desktop-stripe)",
  accent: "var(--desktop-accent)",
  accentSoft: "var(--desktop-accent-soft)",
} as const;

export const desktopThemeStyle = css({
  "--desktop-ink": "#1f2a31",
  "--desktop-line": "#7b878c",
  "--desktop-paper": "#f8fbfb",
  "--desktop-wash": "#dce4e7",
  "--desktop-stripe": "#c7d0d4",
  "--desktop-accent": "#2aa7b8",
  "--desktop-accent-soft": "#c9f4f8",
  color: desktopColor.ink,
  fontFamily: DESKTOP_FONT_FAMILY,
});
