import { zipSync, strToU8, Zip, ZipDeflate } from "fflate";
import type { Row } from "./data/community.ts";
import type { Bindings, Runtime } from "./runtime.ts";
import { content, postContent } from "./rendering.ts";
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
export function userExportHTML(
  profile: Row,
  pages: Row[],
  siteURL: string,
  styles = { index: "style.css", page: "../style.css" },
) {
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
    styles.index,
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
      styles.page,
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

function forumMedia(value: unknown) {
  return String(value ?? "").replace(
    /\/uploads\/([^/]+)\//g,
    "../users/$1/uploads/",
  );
}
function timestamp(value: unknown, dateOnly = false) {
  return value
    ? String(value)
        .replace("T", " ")
        .slice(0, dateOnly ? 10 : 16)
    : "";
}
export function forumExportHTML(threads: Row[], posts: Row[], siteURL: string) {
  const files: Record<string, string> = {};
  if (threads.length) {
    const rows = threads
      .map(
        (t) =>
          `<tr><td>${t.is_pinned ? "📌 " : ""}${t.is_locked ? "🔒 " : ""}<a href="${t.id}.html">${escape(t.title)}</a></td><td><a href="../users/${t.author_username}/index.html">${escape(t.author_display_name || t.author_username)}</a></td><td>${t.reply_count ?? 0}</td><td>${timestamp(t.created_at, true)}</td></tr>`,
      )
      .join("");
    files["forum/index.html"] = exportPage(
      "4orm · forum",
      `<section class="panel"><h1>forum</h1><table class="forum-table"><thead><tr><th>thread</th><th>author</th><th>replies</th><th>date</th></tr></thead><tbody>${rows}</tbody></table></section>`,
      {},
      "default",
      "../style.css",
      siteURL,
    );
  }
  for (const thread of threads) {
    const blocks = posts
      .filter((p) => p.thread_id === thread.id)
      .map((p) => {
        const rendered = postContent(
          String(p.content ?? ""),
          String(p.content_format),
        );
        const signature = p.author_signature
          ? postContent(String(p.author_signature), "bbcode")
          : "";
        const quote = p.quoted_content
          ? `<blockquote class="forum-quote"><strong>${escape(p.quoted_author || "someone")} wrote:</strong><br />${escape(p.quoted_content)}</blockquote>`
          : "";
        return `<div class="forum-post" id="post-${p.id}"><div class="forum-post-meta"><a href="../users/${p.author_username}/index.html"><strong>${escape(p.author_display_name || p.author_username)}</strong></a> · ${timestamp(p.created_at)}${p.is_edited ? " · <em>(edited)</em>" : ""}</div>${quote}<div class="forum-post-content">${rendered}</div>${signature ? `<div class="forum-signature">${signature}</div>` : ""}</div>`;
      })
      .join("\n");
    const title = escape(thread.title),
      author = escape(thread.author_display_name || thread.author_username);
    const header = `<h1>${title}</h1><p class="muted">by ${author} · ${timestamp(thread.created_at)}${thread.is_pinned ? " · 📌 pinned" : ""}${thread.is_locked ? " · 🔒 locked" : ""}</p>`;
    files[`forum/${thread.id}.html`] = exportPage(
      "4orm · " + title,
      header + forumMedia(blocks),
      {
        custom_css: forumMedia(thread.custom_css),
        custom_html: forumMedia(thread.custom_html),
      },
      "default",
      "../style.css",
      siteURL,
    );
  }
  return files;
}
interface ZipEntry {
  name: string;
  body: Uint8Array | ReadableStream<Uint8Array>;
}
export function streamedZIP(entries: AsyncIterable<ZipEntry>) {
  let resume: (() => void) | undefined;
  let cancelled = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let zip: Zip;
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        zip = new Zip((error, bytes, final) => {
          if (cancelled) return;
          if (error) {
            controller.error(error);
            cancelled = true;
            return;
          }
          if (bytes.length) controller.enqueue(bytes);
          if (final) controller.close();
        });
        const capacity = async () => {
          while (true) {
            if (cancelled || (controller.desiredSize ?? 0) > 0) return;
            await new Promise<void>((accept) => {
              resume = accept;
            });
          }
        };
        void (async () => {
          for await (const entry of entries) {
            await capacity();
            if (cancelled) break;
            const file = new ZipDeflate(entry.name);
            zip.add(file);
            if (entry.body instanceof Uint8Array) {
              file.push(entry.body, true);
            } else {
              reader = entry.body.getReader();
              try {
                while (true) {
                  await capacity();
                  if (cancelled) break;
                  const chunk = await reader.read();
                  if (chunk.done) {
                    file.push(new Uint8Array(), true);
                    break;
                  }
                  file.push(chunk.value, false);
                }
              } finally {
                if (cancelled) await reader.cancel();
                reader.releaseLock();
                reader = undefined;
              }
            }
          }
          if (!cancelled) zip.end();
        })().catch((error) => {
          if (!cancelled) {
            cancelled = true;
            controller.error(error);
          }
          zip.terminate();
        });
      },
      pull() {
        const ready = resume;
        resume = undefined;
        ready?.();
      },
      async cancel() {
        cancelled = true;
        resume?.();
        zip.terminate();
        await reader?.cancel();
      },
    },
    { highWaterMark: 1024 * 1024, size: (chunk) => chunk.byteLength },
  );
}
export async function exportFullSite(
  request: Request,
  env: Bindings,
  store: Runtime,
  actorId: number | null,
) {
  const data = await store.call("fullSiteExport", actorId);
  const prefix = "4orm-export/",
    siteURL = "https://4orm.harrhy.xyz";
  async function* entries(): AsyncGenerator<ZipEntry> {
    const asset = new URL(request.url);
    asset.pathname = "/static/style.css";
    asset.search = "";
    const css = await env.ASSETS.fetch(new Request(asset));
    if (css.ok && css.body)
      yield { name: prefix + "style.css", body: css.body };
    for (const user of data.users) {
      const userPrefix = prefix + "users/" + user.profile.username + "/";
      for (const [path, html] of Object.entries(
        userExportHTML(user.profile, user.pages, siteURL, {
          index: "../../style.css",
          page: "../../../style.css",
        }),
      ))
        yield { name: userPrefix + path, body: strToU8(html) };
      for (const row of user.media) {
        const path = String(row.storage_path);
        const object = await env.MEDIA.get(path);
        if (object)
          yield {
            name: userPrefix + "uploads/" + path.split("/").at(-1),
            body: object.body,
          };
      }
    }
    for (const [path, html] of Object.entries(
      forumExportHTML(data.threads, data.posts, siteURL),
    ))
      yield { name: prefix + path, body: strToU8(html) };
  }
  return new Response(streamedZIP(entries()), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="4orm-export.zip"',
    },
  });
}
