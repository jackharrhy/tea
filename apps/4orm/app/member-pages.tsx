import { unsafeHTML } from "remix/component";
import { renderToString } from "remix/component/server";
import type { Row } from "./data/community.ts";
import { content } from "./rendering.ts";

function assets(profile: Row) {
  return `${profile.custom_css ? `<style>${profile.custom_css}</style>` : ""}${profile.custom_html ?? ""}`;
}
export function rawMemberPage(
  record: Row,
  profile: Row,
  data?: Record<string, unknown>,
) {
  let html = content(
    String(record.content ?? ""),
    String(record.content_format),
  );
  if (data) {
    const snippet = `<script>window.__4ORM = ${JSON.stringify(data).replaceAll("<", "\\u003c")};</script>`;
    const head = ["<head>", "<HEAD>", "<head >"].find((tag) =>
      html.includes(tag),
    );
    const root = ["<html>", "<HTML>", "<html "].find((tag) =>
      html.includes(tag),
    );
    const index = head
      ? html.indexOf(head) + head.length
      : root
        ? html.indexOf(">", html.indexOf(root)) + 1
        : 0;
    html =
      html.slice(0, index) +
      (index ? "\n" : "") +
      snippet +
      "\n" +
      html.slice(index);
  }
  if (profile.custom_css) html += `\n<style>${profile.custom_css}</style>`;
  if (profile.custom_html) html += `\n${profile.custom_html}`;
  return html;
}
export async function profileBody(profile: Row, pages: Row[]) {
  const rendered = unsafeHTML(
    content(String(profile.content ?? ""), String(profile.content_format)),
  );
  if (profile.layout === "cssonly") return assets(profile);
  if (profile.layout === "simple")
    return (
      assets(profile) +
      (await renderToString(
        <div class="h-card">
          <a class="u-url" href={`/u/${profile.username}`} rel="me" hidden />
          <span class="p-name" hidden>
            {profile.display_name}
          </span>
          <div class="e-note" innerHTML={rendered} />
        </div>,
      ))
    );
  const header = await renderToString(
    <section class="panel h-card">
      <h1 class="p-name">{profile.display_name}</h1>
      <a class="u-url" href={`/u/${profile.username}`} rel="me" hidden />
      <div class="e-note" innerHTML={rendered} />
      <p>
        <a href={`/lineage#user-${profile.username}`}>view lineage</a>
      </p>
    </section>,
  );
  return (
    header +
    assets(profile) +
    (await renderToString(
      <section class="panel h-feed">
        <h2>pages</h2>
        <ul>
          {pages.length ? (
            pages.map((page) => (
              <li class="h-entry">
                <a
                  class="u-url p-name"
                  href={`/u/${profile.username}/page/${page.slug}`}
                >
                  {page.title}
                </a>
              </li>
            ))
          ) : (
            <li>no pages yet.</li>
          )}
        </ul>
      </section>,
    ))
  );
}
export async function pageBody(record: Row, profile: Row) {
  if (record.layout === "cssonly") return assets(profile);
  const rendered = unsafeHTML(
    content(String(record.content ?? ""), String(record.content_format)),
  );
  if (record.layout === "simple")
    return (
      assets(profile) +
      (await renderToString(
        <article class="h-entry">
          <span class="p-name" hidden>
            {record.title}
          </span>
          <a class="p-author h-card" href={`/u/${profile.username}`} hidden>
            {profile.display_name}
          </a>
          <a
            class="u-url"
            href={`/u/${profile.username}/page/${record.slug}`}
            hidden
          />
          <div class="e-content" innerHTML={rendered} />
        </article>,
      ))
    );
  return (
    assets(profile) +
    (await renderToString(
      <article class="panel content-html h-entry">
        <h1 class="p-name">{record.title}</h1>
        <p class="muted">
          by{" "}
          <a class="p-author h-card" href={`/u/${profile.username}`}>
            {profile.display_name}
          </a>
        </p>
        <a
          class="u-url"
          href={`/u/${profile.username}/page/${record.slug}`}
          hidden
        />
        <hr />
        <div class="e-content" innerHTML={rendered} />
      </article>,
    ))
  );
}
