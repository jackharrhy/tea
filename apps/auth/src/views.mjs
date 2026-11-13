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

export function login({ csrf, returnTo, error }) {
  return page(
    "auth",
    `
    <h1 class="login-title">auth</h1>
    <form method="post" action="/login" class="form-stack">
      ${hidden("csrf", csrf)}${hidden("returnTo", returnTo)}
      <label>Username or email<input name="username" autocomplete="username" required autofocus maxlength="250" autocapitalize="none" spellcheck="false"></label>
      <label>Password<input type="password" name="password" autocomplete="current-password" required maxlength="1000"></label>
      <button class="primary">Sign in</button>
    </form>
    <a class="text-link" href="/forgot-password">Forgot password?</a>`,
    { error, narrow: true },
  );
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

export function emailForm(mode, context) {
  const title = {
    verify: "Verify email",
    forgot: "Reset password",
    reset: "New password",
  }[mode];
  const action = {
    verify: "/verify-email",
    forgot: "/forgot-password",
    reset: "/reset-password",
  }[mode];
  const policy = context.passwordPolicy;
  const composition = policy
    ? [
        policy.hasUppercase && "an uppercase letter",
        policy.hasLowercase && "a lowercase letter",
        policy.hasNumber && "a number",
        policy.hasSymbol && "a symbol",
      ].filter(Boolean)
    : [];
  const requirements = policy
    ? `Use ${policy.minLength}–200 characters${composition.length ? "; include " + composition.join(", ") : ""}.`
    : "";
  const fields =
    mode === "forgot"
      ? '<label>Username or email<input name="username" autocomplete="username" required maxlength="250" autocapitalize="none" spellcheck="false"></label>'
      : mode === "reset"
        ? `<p id="password-requirements">${h(requirements)}</p><label>New password<input name="password" type="password" autocomplete="new-password" aria-describedby="password-requirements" required minlength="${policy?.minLength || 12}" maxlength="200"></label><label>Confirm password<input name="confirmation" type="password" autocomplete="new-password" required minlength="${policy?.minLength || 12}" maxlength="200"></label>`
        : "<p>Confirm this email address for your account.</p>";
  const button = {
    verify: "Verify email",
    forgot: "Send recovery link",
    reset: "Save password",
  }[mode];
  return page(
    title,
    `<h1>${title}</h1><form method="post" action="${action}" class="form-stack">${hidden("csrf", context.csrf)}${fields}<button class="primary">${button}</button></form>`,
    { ...context, narrow: true },
  );
}

export function emailResult(title, message, context) {
  return page(
    title,
    `<h1>${h(title)}</h1><p>${h(message)}</p><a class="text-link" href="${context.user ? "/account" : "/login"}">${context.user ? "Account" : "Sign in"}</a>`,
    { ...context, narrow: true },
  );
}

export function account(profile, context, _applications = []) {
  const name = profile.human?.profile?.displayName || profile.userName;
  const email = profile.human?.email;
  const address =
    email?.email && !email.email.endsWith(".invalid") ? email.email : "Not set";
  return page(
    "Account",
    `
    <section class="account-panel">
      <h1>Account</h1>
      ${context.enrollment ? '<a class="text-link" href="/enroll">Continue joining 4orm</a>' : ""}
      <dl class="profile">
        <div><dt>Name</dt><dd>${h(name)}</dd></div>
        <div><dt>Username</dt><dd>${h(profile.userName)}</dd></div>
        <div><dt>Email</dt><dd>${h(address)}${email?.isEmailVerified ? '<span class="muted"> (verified)</span>' : ""}</dd></div>
      </dl>
      <details class="create-user">
        <summary>${address === "Not set" ? "Add email" : "Change email"}</summary>
        <form action="/account/email" method="post" class="form-stack">
          ${hidden("csrf", context.csrf)}
          <label>Email<input name="email" type="email" autocomplete="email" maxlength="200" required></label>
          <label>Current password<input name="currentPassword" type="password" autocomplete="current-password" maxlength="200" required></label>
          <button class="primary">Send verification link</button>
        </form>
      </details>
      ${address !== "Not set" && !email?.isEmailVerified ? `<form method="post" action="/account/email/resend">${hidden("csrf", context.csrf)}<button>Resend verification link</button></form>` : ""}
      <details class="create-user">
        <summary>Change password</summary>
        <form action="/account/password" method="post" class="form-stack">
          ${hidden("csrf", context.csrf)}
          <label>Current password<input name="currentPassword" type="password" autocomplete="current-password" maxlength="200" required></label>
          <label>New password<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="200" required></label>
          <label>Confirm password<input name="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="200" required></label>
          <button class="primary">Change password</button>
        </form>
      </details>
      <p><a class="text-link" href="/account/sessions">Review central sessions</a></p>
      <p><a class="text-link" href="/">Your apps and access details</a></p>
    </section>`,
    { ...context, active: "account" },
  );
}

export function authorization(intent, id, context) {
  const details = [
    ...(intent.request.scope.includes("profile") ? ["Name and profile"] : []),
    ...(intent.request.scope.includes("email") ? ["Email address"] : []),
    ...(intent.selfEnrollment
      ? [
          "Join Radio: list, join and create rooms, upload tracks, and use room controls.",
        ]
      : []),
    ...(intent.offline ? ["Stay connected until access is revoked"] : []),
  ];
  return page(
    intent.selfEnrollment ? "Join Radio?" : "Allow access?",
    `<h1>${intent.selfEnrollment ? "Join Radio?" : "Allow access?"}</h1>
    <dl class="profile"><div><dt>Application</dt><dd>${h(intent.application.name)}</dd></div><div><dt>Client</dt><dd>${h(intent.clientOrigin)}</dd></div><div><dt>Permission</dt><dd>${h(intent.roles.map((role) => (role === "admin" ? "Administrator" : role)).join(", "))}</dd></div></dl>
    ${details.length ? `<div class="permissions"><ul>${details.map((detail) => `<li>${h(detail)}</li>`).join("")}</ul></div>` : ""}
    <form method="post" action="/authorize">${hidden("csrf", context.csrf)}${hidden("authRequest", id)}
      <div class="actions"><button name="decision" value="deny">Deny</button><button class="primary" name="decision" value="approve">Allow</button></div>
    </form>`,
    { ...context, narrow: true },
  );
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
