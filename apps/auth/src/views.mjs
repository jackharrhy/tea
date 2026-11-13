import { escapeHtml as h } from "./security.mjs";
import { dailyArtwork } from "./appearance.mjs";

const hidden = (name, value) =>
  `<input type="hidden" name="${h(name)}" value="${h(value)}">`;

export function page(
  title,
  content,
  { user, admin, csrf, error, narrow = false, active, preview } = {},
) {
  const navLink = (path, label, key) =>
    `<a href="${path}"${active === key ? ' aria-current="page"' : ""}>${label}</a>`;
  const navigation = preview
    ? `${navLink(preview.base, "Your apps", "apps")}${navLink(preview.base + "/account", "Account", "account")}`
    : user
      ? `${navLink("/", "Your apps", "apps")}${navLink("/account", "Account", "account")}${admin ? `${navLink("/manage/people", "People", "people")}${navLink("/manage/groups", "Groups", "groups")}${navLink("/manage/services", "Services", "services")}${navLink("/manage/activity", "Activity", "activity")}` : ""}<form method="post" action="/logout">${hidden("csrf", csrf)}<button class="nav-button">Sign out</button></form>`
      : title !== "auth"
        ? navLink("/login", "Sign in")
        : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f6f7f8"><title>${h(title)}${title === "auth" ? "" : " · auth"}</title><link rel="preload" href="/assets/fonts/inter-variable.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/assets/style.css">${title === "auth" && !user ? '<script type="module" src="/assets/doodle-motion.mjs"></script>' : ""}</head>
<body class="${narrow ? "authentication" : ""}"><a class="skip-link" href="#main">Skip to content</a>
${narrow ? dailyArtwork() : ""}
${preview ? `<aside class="preview-banner"><strong>Viewing ${h(preview.name)}</strong><span>Temporary Auth preview · Read only</span><a href="${h(preview.exit)}">Exit preview</a></aside>` : ""}
${title === "auth" && !user ? "" : `<header class="site-header"><a class="brand" href="${h(preview?.base || "/")}" aria-label="auth">auth<span class="brand-dot" aria-hidden="true">.</span></a><nav class="desktop-nav" aria-label="Main">${navigation}</nav>${navigation ? `<details class="mobile-nav"><summary>Menu</summary><nav aria-label="Mobile">${navigation}</nav></details>` : ""}</header>`}
<main id="main" class="${narrow ? "auth-page" : "workspace"}">${error ? `<p role="alert" class="error">${h(error)}</p>` : ""}${content}</main>
</body></html>`;
}
