import type { Row } from "./data/community.ts";
const baseStyles =
  "\n      @layer base {\n        body {\n          margin: 0;\n          padding: 0;\n          font-family: Verdana, Tahoma, sans-serif;\n          font-size: 12px;\n          background: transparent;\n        }\n        .status {\n          display: inline-flex;\n          align-items: center;\n          gap: 6px;\n          padding: 4px 8px;\n        }\n        .status-emoji {\n          font-size: 16px;\n        }\n        .status-text {\n          color: #333;\n        }\n        .status-time {\n          color: #999;\n          font-size: 11px;\n        }\n      }\n      ";
function escape(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&#34;")
    .replaceAll("'", "&#39;");
}
export function statusJSON(owner: Row, now = Date.now()) {
  let relative = "";
  if (owner.status_updated_at) {
    const value = String(owner.status_updated_at).replace(" ", "T");
    const updated = new Date(
      /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value + "Z",
    ).getTime();
    if (!Number.isFinite(updated))
      throw new Error("Invalid persisted status timestamp");
    const seconds = Math.trunc((now - updated) / 1000);
    relative =
      seconds < 60
        ? "just now"
        : seconds < 3600
          ? `${Math.floor(seconds / 60)}m ago`
          : seconds < 86400
            ? `${Math.floor(seconds / 3600)}h ago`
            : `${Math.floor(seconds / 86400)}d ago`;
  }
  return {
    username: String(owner.username),
    status_emoji: String(owner.status_emoji ?? ""),
    status_text: String(owner.status_text ?? ""),
    relative_time: relative,
  };
}
export function statusDocument(owner: Row, now = Date.now()) {
  const data = statusJSON(owner, now);
  const body =
    data.status_text || data.status_emoji
      ? `<div class="status">${data.status_emoji ? `<span class="status-emoji">${escape(data.status_emoji)}</span>` : ""} ${data.status_text ? `<span class="status-text">${escape(data.status_text)}</span>` : ""} ${data.relative_time ? `<span class="status-time">· ${escape(data.relative_time)}</span>` : ""}</div>`
      : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>${baseStyles}${owner.status_css ?? ""}</style></head><body>
    ${body}
    ${owner.status_html ?? ""}
  </body></html>`;
}
