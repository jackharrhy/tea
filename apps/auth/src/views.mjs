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

export function enrollment(context, profile) {
  const verified =
    profile?.human?.email?.isEmailVerified &&
    !profile.human.email.email.endsWith(".invalid");
  const content = !profile
    ? `
    <form method="post" action="/enroll" class="form-stack">
      ${hidden("csrf", context.csrf)}
      <label>Username<input name="username" autocomplete="username" pattern="[a-z0-9_-]{3,32}" minlength="3" maxlength="32" autocapitalize="none" spellcheck="false" required autofocus><span class="muted">3–32 lowercase letters, numbers, underscores or hyphens.</span></label>
      <label>Email<input name="email" type="email" autocomplete="email" maxlength="200" required></label>
      <label>Password<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="200" required></label>
      <label>Confirm password<input name="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="200" required></label>
      <button class="primary">Create account</button>
    </form>
    <a class="text-link" href="/login?returnTo=/enroll">Sign in instead</a>`
    : verified
      ? `
    <p>Join as ${h(profile.userName)}.</p>
    <form method="post" action="/enroll/continue">${hidden("csrf", context.csrf)}<button class="primary">Join 4orm</button></form>`
      : `
    <p>Verify your email to join.</p>
    <a class="text-link" href="/account">Open account</a>`;
  return page("Join 4orm", `<h1>Join 4orm</h1>${content}`, {
    ...context,
    narrow: true,
  });
}

export function device(request, csrf, context, userCode) {
  return page(
    "Approve sign-in",
    `
    <h1>Approve sign-in</h1>
    <p class="application-name">${h(request.appName || "Application")}</p>
    <p class="muted">Approve only if you started this sign-in.</p>
    <form method="post" action="/device" class="actions">
      ${hidden("csrf", csrf)}${hidden("userCode", userCode)}
      <button class="primary" name="decision" value="approve">Approve</button>
      <button name="decision" value="deny">Deny</button>
    </form>
    <details class="permissions"><summary>Permissions</summary><ul>${(request.scope || []).map((scope) => `<li>${h(scope)}</li>`).join("")}</ul></details>`,
    { ...context, narrow: true },
  );
}

export function deviceResult(approved, context) {
  return page(
    "Device sign-in",
    `
    <h1>${approved ? "Connected" : "Request denied"}</h1>
    <p class="muted">You can return to Lore.</p>
    <a class="text-link" href="/account">Account</a>`,
    { ...context, narrow: true },
  );
}

export function deviceCode(csrf, context) {
  return page(
    "Device code",
    `
    <h1>Device code</h1>
    <form action="/device" method="get" class="form-stack">
      <label>Code<input name="user_code" required maxlength="30" placeholder="XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
      <button class="primary">Continue</button>
    </form>`,
    { ...context, narrow: true },
  );
}
