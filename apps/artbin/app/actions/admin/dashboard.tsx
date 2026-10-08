import { css, type Handle } from "remix/component";
import { adminSections } from "../../ui/admin-sections.ts";
import { theme } from "../../ui/styles.ts";

const directoryStyle = css({
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "2.5rem",
  paddingTop: "0.5rem",
  "@media (max-width: 767px)": { gridTemplateColumns: "1fr", gap: "1.5rem" },
  "& h2": { fontSize: "1rem", margin: "0 0 0.5rem" },
});
const destinationStyle = css({
  display: "block",
  padding: "1.25rem 0",
  borderBottom: `1px solid ${theme.color.borderLight}`,
  "&": { textDecoration: "none", color: theme.color.text },
  "&:hover strong": { textDecoration: "underline" },
  "&:focus-visible": {
    outline: `2px solid ${theme.color.text}`,
    outlineOffset: "4px",
  },
  "& strong": { fontSize: "1.125rem", fontWeight: 600 },
  "& p": {
    fontSize: "0.875rem",
    color: theme.color.muted,
    lineHeight: 1.6,
    margin: "0.5rem 0 0",
    maxWidth: "48ch",
  },
});
const statusStyle = css({
  display: "block",
  fontSize: "0.75rem",
  fontWeight: 600,
  marginTop: "0.75rem",
});

export function Dashboard(
  handle: Handle<{
    running: number;
    queued: number;
    failed: number;
    pendingFiles: number;
  }>,
) {
  return () => (
    <div mix={directoryStyle}>
      {adminSections.map((section) => (
        <section key={section.label} aria-label={section.label}>
          <h2>{section.label}</h2>
          {section.items.map((item) => (
            <a key={item.id} href={item.href} mix={destinationStyle}>
              <strong>{item.label}</strong>
              <p>{item.description}</p>
              {item.id === "jobs" ? (
                <span mix={statusStyle}>
                  {handle.props.running} running, {handle.props.queued} queued,{" "}
                  {handle.props.failed} failed
                </span>
              ) : null}
              {item.id === "inbox" ? (
                <span mix={statusStyle}>
                  {handle.props.pendingFiles}{" "}
                  {handle.props.pendingFiles === 1 ? "file" : "files"} awaiting
                  review
                </span>
              ) : null}
            </a>
          ))}
        </section>
      ))}
    </div>
  );
}
