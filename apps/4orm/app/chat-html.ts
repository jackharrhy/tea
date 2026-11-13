import type { Row } from "./data/community.ts";
function escape(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}
export function chatMessageHTML(message: Row, index = 0, total = 1) {
  const distance = total - index;
  const opacity =
    distance > 60 ? Math.max(0.05, 1 - ((distance - 60) / 40) * 0.95) : 1;
  const style = opacity < 1 ? `opacity: ${opacity.toFixed(2)}` : "";
  const username = escape(message.username);
  return `<div class="chat-msg" style="${style}"><a href="/u/${username}" class="chat-user">${username}</a><span class="chat-text">${escape(message.message)}</span></div>`;
}
export function chatPresenceHTML(
  people: { username: string; state: "active" | "idle" }[],
) {
  return people.length
    ? people
        .map(
          (p) =>
            `<span class="chat-present">${p.state === "active" ? "🟢" : "🟡"} ${escape(p.username)}</span>`,
        )
        .join(" ")
    : '<span class="muted">nobody here</span>';
}
