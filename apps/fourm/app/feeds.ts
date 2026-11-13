import type { Row } from "./data/community.ts";
function escape(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}
function sourceTimestamp(value: unknown) {
  if (value === null || value === undefined) return "None";
  return String(value)
    .replace("T", " ")
    .replace(/Z$/, "+00:00")
    .replace(/\.(\d+)(?=$|[+-]\d\d:\d\d$)/, (_match, digits: string) => {
      const micros = digits.slice(0, 6).padEnd(6, "0");
      return Number(micros) ? "." + micros : "";
    });
}
function pubDate(value: unknown) {
  const text = String(value ?? "").replace(" ", "T"),
    offset = /([+-])(\d{2}):?(\d{2})$/.exec(text);
  const minutes = offset
    ? (offset[1] === "-" ? -1 : 1) *
      (Number(offset[2]) * 60 + Number(offset[3]))
    : 0;
  const parsed = Date.parse(
    text + (/(?:Z|[+-]\d\d:?\d\d)$/.test(text) ? "" : "Z"),
  );
  const date = new Date(
    Number.isFinite(parsed) ? parsed + minutes * 60000 : Date.now(),
  );
  const zone =
    Number.isFinite(parsed) && offset
      ? offset[1] + offset[2] + offset[3]
      : "+0000";
  return date.toUTCString().replace("GMT", zone);
}
interface Item {
  title: string;
  link: string;
  guid: string;
  updated: unknown;
}
function feed(title: string, link: string, description: string, items: Item[]) {
  const entries = items
    .map(
      (item) =>
        `<item><title>${escape(item.title)}</title><link>${escape(item.link)}</link><guid>${escape(item.guid)}</guid><pubDate>${pubDate(item.updated)}</pubDate></item>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escape(title)}</title><link>${escape(link)}</link><description>${escape(description)}</description>${entries}</channel></rss>`;
}
export function pagesFeed(origin: string, rows: Row[], owner?: Row) {
  const base = origin.replace(/\/$/, "");
  return feed(
    owner ? `4orm updates from ${owner.display_name}` : "4orm updates",
    owner ? `${base}/u/${owner.username}` : base + "/",
    "Recent public page updates",
    rows.map((row) => {
      const link = `${base}/u/${row.username}/page/${row.slug}`;
      return {
        title: owner ? String(row.title) : `${row.display_name}: ${row.title}`,
        link,
        guid: `${link}#${sourceTimestamp(row.updated_at)}`,
        updated: row.updated_at,
      };
    }),
  );
}
export function forumFeed(origin: string, rows: Row[]) {
  const base = origin.replace(/\/$/, "");
  return feed(
    "4orm forum",
    base + "/forum",
    "Recent forum posts and replies",
    rows.map((row) => {
      const link = `${base}/forum/${row.thread_id}#post-${row.id}`;
      return {
        title: `${row.author_display_name} in ${row.thread_title}`,
        link,
        guid: link,
        updated: row.created_at,
      };
    }),
  );
}
