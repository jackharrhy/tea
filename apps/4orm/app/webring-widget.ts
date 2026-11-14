import type { Row } from "./data/community.ts";
interface Ring {
  previous: Row | null;
  next: Row | null;
}
function escape(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&#34;")
    .replaceAll("'", "&#39;");
}
const neighbor = (row: Row | null) =>
  row
    ? {
        username: String(row.username),
        display_name: String(row.display_name),
      }
    : null;
export function webringJSON(username: string, ring: Ring) {
  return { username, prev: neighbor(ring.previous), next: neighbor(ring.next) };
}
export function webringDocument(ring: Ring) {
  const previous = ring.previous
    ? `<a href="/u/${escape(ring.previous.username)}" target="_parent">← ${escape(ring.previous.display_name)}</a>`
    : "";
  const next = ring.next
    ? `<a href="/u/${escape(ring.next.username)}" target="_parent">${escape(ring.next.display_name)} →</a>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
      body {
        margin: 0;
        padding: 0;
        font-family: Verdana, Tahoma, sans-serif;
        font-size: 12px;
        background: transparent;
      }
      .webring {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 6px;
        background: #f0f0f0;
        border: 1px solid #ccc;
        width: 100%;
        height: 100vh;
        box-sizing: border-box;
      }
      a {
        color: #0000ee;
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      .label {
        font-weight: 700;
      }
    </style></head><body><div class="webring">${previous}
<span class="label">🔗 <a href="/webring/random" target="_parent">4orm webring</a></span>
${next}</div></body></html>`;
}
