import { css } from "remix/component";

export interface UiTheme {
  ink: string;
  line: string;
  controlSurface: string;
  controlHover: string;
  muted: string;
  focus: string;
  actionSurface: string;
  actionHover: string;
  actionInk: string;
  controlRadius?: string;
}

export function createUiTheme(theme: UiTheme) {
  return css({
    "--ui-ink": theme.ink,
    "--ui-line": theme.line,
    "--ui-control-surface": theme.controlSurface,
    "--ui-control-hover": theme.controlHover,
    "--ui-muted": theme.muted,
    "--ui-focus": theme.focus,
    "--ui-action-surface": theme.actionSurface,
    "--ui-action-hover": theme.actionHover,
    "--ui-action-ink": theme.actionInk,
    "--ui-control-radius": theme.controlRadius ?? "5px",
  });
}

export const uiControlStyles = css({
  "& button, & input, & select, & textarea": { font: "inherit" },
  "& button": {
    cursor: "pointer",
    border: "1px solid var(--ui-line)",
    borderRadius: "var(--ui-control-radius, 5px)",
    background: "var(--ui-control-surface)",
    color: "var(--ui-ink)",
    padding: "9px 14px",
  },
  "& button:hover:not(:disabled)": {
    background: "var(--ui-control-hover)",
  },
  "& button:disabled": {
    cursor: "not-allowed",
    opacity: "0.55",
  },
  "& input, & select, & textarea": {
    border: "1px solid var(--ui-line)",
    borderRadius: "var(--ui-control-radius, 5px)",
    background: "var(--ui-control-surface)",
    color: "var(--ui-ink)",
    minWidth: "0",
    padding: "10px 12px",
  },
  "& input::placeholder, & textarea::placeholder": {
    color: "var(--ui-muted)",
  },
  "& button:focus-visible, & input:focus-visible, & select:focus-visible, & textarea:focus-visible, & a:focus-visible, & summary:focus-visible":
    {
      outline: "2px solid var(--ui-focus)",
      outlineOffset: "2px",
    },
});

export const uiPrimaryActionStyles = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--ui-action-surface)",
  borderColor: "var(--ui-action-surface)",
  color: "var(--ui-action-ink)",
  fontWeight: "600",
  textDecoration: "none",
  "&:hover": {
    background: "var(--ui-action-hover)",
    borderColor: "var(--ui-action-hover)",
  },
});
