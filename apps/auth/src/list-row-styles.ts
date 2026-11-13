import { css } from "remix/component";

export const listRowStyles = css({
  display: "grid",
  gridTemplateColumns: "38px minmax(180px, 1fr) 110px 90px 92px",
  gap: "16px",
  alignItems: "center",
  minHeight: "85px",
  padding: "18px 12px",
  borderBottom: "1px solid var(--line)",
  color: "var(--ink)",
  textDecoration: "none",
  "&:hover": { background: "#eef1f3" },
  "& strong": { display: "block", fontSize: "14px" },
  "& .muted": { display: "block", fontSize: "12px", marginTop: "4px" },
});

export const groupRowStyles = css({
  gridTemplateColumns: "minmax(200px, 1fr) 100px 180px",
  "& > span:not(:first-child)": {
    fontSize: "12px",
    color: "var(--muted)",
  },
});

export const operationRowStyles = css({
  gridTemplateColumns: "minmax(200px, 1fr) auto",
});

export const personInitialStyles = css({
  fontSize: "18px",
  color: "#586d7b",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "32px",
  height: "36px",
});
