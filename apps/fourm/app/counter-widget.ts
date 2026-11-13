import type { Row } from "./data/community.ts";
function escape(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&#34;")
    .replaceAll("'", "&#39;");
}
export function counterJSON(owner: Row, totalViews: number) {
  return { username: String(owner.username), total_views: totalViews };
}
export function counterDocument(owner: Row, totalViews: number) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escape(owner.username)} counter</title>
    <style>
      @layer base {
        body { background: transparent; padding: 0; margin: 0; }
        .counter-box {
          width: 100%;
          height: 100vh;
          box-sizing: border-box;
          border: 2px outset #999;
          background: #fff8a6;
          padding: 8px 10px;
          font-family: Verdana, Tahoma, Arial, sans-serif;
        }
        .counter-label { font-size: 12px; }
        .counter-number { font-size: 20px; font-weight: 700; letter-spacing: 1px; }
      }
      ${owner.counter_css ?? ""}
    </style>
  </head>
  <body>
    <div class="counter-box">
      <div class="counter-label">${escape(owner.username)} visitors</div>
      <div class="counter-number">${totalViews}</div>
    </div>
    ${owner.counter_html ?? ""}
  </body>
</html>
`;
}
