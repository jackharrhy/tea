import { zipSync, strToU8 } from "fflate";
import type { Row } from "./data/community.ts";
import type { Bindings, Runtime } from "./runtime.ts";
import { content } from "./rendering.ts";
function escape(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}
function rewrite(value: unknown, username: string, prefix: string) {
  return String(value ?? "")
    .split(`/uploads/${username}/`)
    .join(prefix + "/");
}
export function exportPage(
  title: string,
  body: string,
  profile: Row,
  layout: string,
  cssPath: string,
  siteURL: string,
) {
  const prefix = cssPath === "style.css" ? "uploads" : "../uploads";
  const rendered = rewrite(body, String(profile.username), prefix),
    css = rewrite(profile.custom_css, String(profile.username), prefix),
    html = rewrite(profile.custom_html, String(profile.username), prefix);
  if (layout === "raw")
    return (
      rendered +
      (css ? `\n<style>${css}</style>` : "") +
      (html ? `\n${html}` : "")
    );
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📒</text></svg>" />
    <link rel="stylesheet" href="${cssPath}" />
    ${css ? `<style>${css}</style>` : ""}
  </head>
  <body>
    <header class="topbar">
      <a href="${siteURL}" class="logo">4orm</a>
    </header>
    <main class="wrap">
      ${rendered}
    </main>
    ${html}
  </body>
</html>`;
}
export function userExportHTML(profile: Row, pages: Row[], siteURL: string) {
  const files: Record<string, string> = {};
  const layout = String(profile.layout || "default");
  const rendered = content(
    String(profile.content ?? ""),
    String(profile.content_format),
  );
  const pageLinks = pages.length
    ? `<h2>pages</h2><ul>${pages.map((p) => `<li><a href="pages/${p.slug}.html">${escape(p.title)}</a></li>`).join("")}</ul>`
    : "";
  const body =
    layout === "default"
      ? `<section class="panel"><h1>${escape(profile.display_name)}</h1>${rendered}${pageLinks}</section>`
      : layout === "cssonly"
        ? ""
        : rendered;
  files["index.html"] = exportPage(
    escape(profile.display_name),
    body,
    profile,
    layout,
    "style.css",
    siteURL,
  );
  for (const p of pages) {
    const pageLayout = String(p.layout || "default");
    const pageRendered = content(
      String(p.content ?? ""),
      String(p.content_format),
    );
    const pageBody =
      pageLayout === "default"
        ? `<article class="panel content-html"><h1>${escape(p.title)}</h1><p class="muted">by <a href="../index.html">${escape(profile.display_name)}</a></p><hr />${pageRendered}</article>`
        : pageLayout === "cssonly"
          ? ""
          : pageRendered;
    files[`pages/${p.slug}.html`] = exportPage(
      escape(p.title),
      pageBody,
      profile,
      pageLayout,
      "../style.css",
      siteURL,
    );
  }
  return files;
}
export async function exportUserSite(
  request: Request,
  env: Bindings,
  store: Runtime,
  actorId: number | null,
  username: string,
) {
  const data = await store.call("userSiteExport", actorId, username);
  const prefix = username + "-export/";
  const files: Record<string, Uint8Array> = {};
  for (const [path, html] of Object.entries(
    userExportHTML(data.profile, data.pages, "https://4orm.harrhy.xyz"),
  ))
    files[prefix + path] = strToU8(html);
  for (const row of data.media) {
    const path = String(row.storage_path);
    const object = await env.MEDIA.get(path);
    if (object)
      files[prefix + "uploads/" + path.split("/").at(-1)] = new Uint8Array(
        await object.arrayBuffer(),
      );
  }
  const asset = new URL(request.url);
  asset.pathname = "/static/style.css";
  asset.search = "";
  const css = await env.ASSETS.fetch(new Request(asset));
  if (css.ok)
    files[prefix + "style.css"] = new Uint8Array(await css.arrayBuffer());
  const bytes = zipSync(files);
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${username}-export.zip"`,
    },
  });
}
