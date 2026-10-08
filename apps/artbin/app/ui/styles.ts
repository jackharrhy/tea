import { css } from "remix/component";

export const theme = {
  color: {
    background: "#fff",
    page: "#f0f0f0",
    hover: "#f5f5f5",
    subtle: "#eee",
    text: "#111",
    muted: "#666",
    faint: "#999",
    border: "#222",
    borderLight: "#ccc",
    danger: "#c00",
    success: "#080",
  },
  font: {
    body: '"Times New Roman", Georgia, serif',
    mono: '"Courier New", Courier, monospace',
  },
} as const;

export const documentStyle = css({
  backgroundColor: theme.color.page,
  color: theme.color.text,
  fontFamily: theme.font.body,
  minHeight: "100%",
  "&, & *": { boxSizing: "border-box" },
  "& body": {
    backgroundColor: theme.color.page,
    color: theme.color.text,
    fontFamily: theme.font.body,
    margin: 0,
    minHeight: "100vh",
  },
  "& button, & input, & select, & textarea": { font: "inherit" },
  "& a": { color: theme.color.text, textDecoration: "underline" },
  "& a:hover": { color: "#000" },
  "& ::selection": {
    backgroundColor: theme.color.text,
    color: theme.color.background,
  },
  "& ::-webkit-scrollbar": { height: "8px", width: "8px" },
  "& ::-webkit-scrollbar-track": { background: theme.color.page },
  "& ::-webkit-scrollbar-thumb": { background: theme.color.borderLight },
  "& ::-webkit-scrollbar-thumb:hover": { background: theme.color.faint },
});

export const pageStyle = css({
  backgroundColor: theme.color.background,
  marginInline: "auto",
  maxWidth: "1400px",
  minHeight: "calc(100vh - 48px)",
  padding: "1rem",
});

export const narrowPageStyle = css({
  backgroundColor: theme.color.background,
  marginInline: "auto",
  maxWidth: "600px",
  minHeight: "calc(100vh - 48px)",
  padding: "1rem",
});

export const mutedTextStyle = css({ color: theme.color.muted });
export const faintTextStyle = css({ color: theme.color.faint });
export const dangerTextStyle = css({ color: theme.color.danger });
export const smallTextStyle = css({ fontSize: "0.875rem" });
export const tinyTextStyle = css({ fontSize: "0.75rem" });
export const monoTextStyle = css({ fontFamily: theme.font.mono });

export const buttonStyle = css({
  backgroundColor: theme.color.background,
  border: `1px solid ${theme.color.border}`,
  color: theme.color.text,
  cursor: "pointer",
  display: "inline-block",
  fontSize: "0.875rem",
  padding: "0.375rem 0.75rem",
  textDecoration: "none",
  transition: "background-color 150ms",
  "&:hover": { backgroundColor: theme.color.hover, textDecoration: "none" },
  "&:disabled": { cursor: "default", opacity: 0.6 },
});

export const primaryButtonStyle = css({
  backgroundColor: theme.color.text,
  borderColor: theme.color.text,
  color: theme.color.background,
  "&:hover": { backgroundColor: "#333", color: theme.color.background },
});

export const smallButtonStyle = css({
  fontSize: "0.75rem",
  padding: "0.25rem 0.5rem",
});

export const dangerButtonStyle = css({
  borderColor: theme.color.danger,
  color: theme.color.danger,
  "&:hover": {
    backgroundColor: theme.color.danger,
    color: theme.color.background,
  },
});

export const inputStyle = css({
  backgroundColor: theme.color.background,
  border: `1px solid ${theme.color.borderLight}`,
  color: theme.color.text,
  fontFamily: "inherit",
  fontSize: "0.875rem",
  padding: "0.5rem",
  "&:focus": { borderColor: theme.color.border, outline: "none" },
});

export const cardStyle = css({
  backgroundColor: theme.color.background,
  border: `1px solid ${theme.color.borderLight}`,
  padding: "1rem",
});

export const alertStyle = css({
  border: `1px solid ${theme.color.borderLight}`,
  fontSize: "0.875rem",
  marginBottom: "1rem",
  padding: "0.75rem",
});

export const errorAlertStyle = css({
  background: "#fff0f0",
  borderColor: theme.color.danger,
});

export const successAlertStyle = css({
  background: "#f0fff0",
  borderColor: theme.color.success,
});

export const adminBadgeStyle = css({
  background: theme.color.text,
  color: theme.color.background,
  fontSize: "0.625rem",
  letterSpacing: "0.05em",
  padding: "0.125rem 0.25rem",
  textTransform: "uppercase",
});

export const visuallyHiddenStyle = css({
  border: 0,
  clip: "rect(0, 0, 0, 0)",
  height: "1px",
  margin: "-1px",
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: "1px",
});

export const modalOverlayStyle = css({
  alignItems: "center",
  background: "rgba(0, 0, 0, 0.5)",
  display: "flex",
  inset: 0,
  justifyContent: "center",
  position: "fixed",
  zIndex: 1000,
});

export const modalStyle = css({
  background: theme.color.background,
  border: `1px solid ${theme.color.border}`,
  margin: "1rem",
  maxHeight: "90vh",
  maxWidth: "500px",
  overflow: "auto",
  width: "100%",
});

export const modalHeaderStyle = css({
  alignItems: "center",
  borderBottom: `1px solid ${theme.color.borderLight}`,
  display: "flex",
  justifyContent: "space-between",
  padding: "0.75rem 1rem",
});

export const modalTitleStyle = css({
  fontSize: "1rem",
  fontWeight: 500,
  margin: 0,
});

export const modalCloseStyle = css({
  background: "none",
  border: "none",
  color: theme.color.muted,
  cursor: "pointer",
  fontSize: "1.5rem",
  lineHeight: 1,
  padding: 0,
  "&:hover": { color: theme.color.text },
});

export const modalBodyStyle = css({ padding: "1rem" });
export const modalActionsStyle = css({
  display: "flex",
  gap: "0.5rem",
  marginTop: "1rem",
});
export const modalFooterStyle = css({
  background: "#fafafa",
  borderTop: `1px solid ${theme.color.borderLight}`,
  display: "flex",
  gap: "0.5rem",
  justifyContent: "flex-end",
  padding: "0.75rem 1rem",
});
