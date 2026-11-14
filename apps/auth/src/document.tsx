import { css, unsafeHTML, type Handle, type RemixNode } from "remix/component";
import { createUiTheme, uiControlStyles } from "@harrhy/ui";
import { dailyArtwork } from "./appearance.mjs";
import { sharedPageStyles } from "./shared-page-styles.ts";
import { managementStyles } from "./management-styles.ts";
import { responsiveStyles } from "./responsive-styles.ts";

const theme = createUiTheme({
  ink: "#1b2025",
  line: "#a9b2b9",
  controlSurface: "#ffffff",
  controlHover: "#edf0f2",
  muted: "#59636c",
  focus: "#3675be",
  actionSurface: "#20282f",
  actionHover: "#36424b",
  actionInk: "#ffffff",
  controlRadius: "6px",
});

const fullWidthAction = css({
  "& .form-stack > button": {
    width: "100%",
    "min-height": "44px",
  },
});

const layoutStyles = css({
  "& .primary": {
    background: "#20282f",
    color: "#fff",
    borderColor: "#20282f",
  },
  "& .primary:hover": {
    background: "#36424b",
    color: "#fff",
    borderColor: "#36424b",
  },
  "& input, & textarea, & select": {
    font: "inherit",
    width: "100%",
    border: "1px solid var(--control)",
    borderRadius: "6px",
    background: "var(--surface)",
    color: "var(--ink)",
    padding: "10px 12px",
    minHeight: "44px",
    caretColor: "var(--blue)",
    lineHeight: 1.5,
  },
  "& textarea": { resize: "vertical", minHeight: "80px" },
  "& input::placeholder, & textarea::placeholder": {
    color: "#66727c",
    opacity: 1,
  },
  "& input[type='checkbox']": {
    width: "18px",
    minHeight: "18px",
    height: "18px",
    accentColor: "#303c46",
  },
  "& label": { display: "grid", gap: "7px", fontWeight: 500 },
  "& fieldset": { border: 0, padding: 0, margin: 0 },
  "& legend": { fontWeight: 600, marginBottom: "12px" },
  "& h1": {
    fontSize: "28px",
    lineHeight: 1.2,
    letterSpacing: "-0.03em",
    fontWeight: 600,
    margin: "0 0 12px",
  },
  "& h2": {
    fontSize: "17px",
    lineHeight: 1.4,
    fontWeight: 600,
    margin: "0 0 13px",
  },
  "& h3": { fontSize: "15px", margin: "0 0 12px" },
  "& p": { margin: "0 0 16px", maxWidth: "76ch" },
  "& strong": { fontWeight: 600 },
  "& code": {
    fontFamily: "ui-monospace, monospace",
    fontSize: "12px",
    overflowWrap: "anywhere",
  },
  "& a": { color: "var(--blue)", textUnderlineOffset: "4px" },
  "& button": { cursor: "pointer" },
  "& button:disabled": { cursor: "not-allowed", opacity: 0.5 },
  "& button, & .button": {
    display: "inline-flex",
    minHeight: "42px",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "8px 15px",
    border: "1px solid #b9c1c6",
    borderRadius: "6px",
    background: "var(--surface)",
    color: "var(--ink)",
    font: "inherit",
    fontWeight: 500,
    textDecoration: "none",
    whiteSpace: "nowrap",
    lineHeight: 1.4,
  },
  "& button:hover, & .button:hover": {
    background: "#edf0f2",
    borderColor: "#919da6",
  },
  "& button:active, & .button:active": { background: "#e2e7eb" },
  "& .brand": {
    fontSize: "29px",
    fontWeight: 700,
    letterSpacing: "-0.035em",
    color: "#202a32",
    textDecoration: "none",
    lineHeight: 1,
  },
  "& .brand-dot": { color: "#547b9a" },
  "& .desktop-nav": {
    display: "flex",
    alignItems: "center",
    gap: "3px",
  },
  "& .desktop-nav > a, & .nav-button": {
    border: 0,
    background: "transparent",
    color: "#4a555f",
    padding: "9px 12px",
    textDecoration: "none",
    borderRadius: "5px",
    minHeight: "44px",
    display: "flex",
    alignItems: "center",
  },
  "& .desktop-nav > a:hover, & .nav-button:hover, & .desktop-nav > a[aria-current='page']":
    {
      background: "#e7eaed",
      color: "#1d2932",
    },
  "& .desktop-nav > a[aria-current='page']": { fontWeight: 600 },
  "& .mobile-nav": { display: "none" },
  "&.authentication": { overflowX: "hidden" },
  "&.authentication:has(.login-title)": {
    display: "grid",
    minHeight: "100svh",
    placeItems: "center",
    padding: "32px 0",
  },
  "& .auth-page": {
    position: "relative",
    zIndex: 1,
    maxWidth: "420px",
    margin: "clamp(24px, 8vh, 90px) auto 50px",
    padding: "32px",
    background: "rgba(255, 255, 255, 0.97)",
    border: "1px solid #e3e8eb",
    borderRadius: "12px",
  },
  "& .auth-page h1": { fontSize: "29px", marginBottom: "9px" },
  "& .auth-page:has(.login-title)": {
    width: "calc(100% - 40px)",
    margin: "0 auto",
  },
  "& .auth-page .login-title": { marginBottom: "24px" },
  "& .auth-page .form-stack > button": {
    width: "100%",
    marginTop: "4px",
  },
  "& .auth-page .text-link": { fontSize: "13px" },
  "& .auth-art": {
    position: "fixed",
    inset: 0,
    width: "100%",
    height: "100%",
    opacity: 0.55,
    pointerEvents: "none",
    "--doodle-ink": "#c7d5df",
    "--doodle-fill": "#dce7ee",
    "--doodle-wash": "#eef3f6",
  },
  "& .artwork-layer": { position: "fixed", inset: 0, pointerEvents: "none" },
  "& .desktop-nav > form": {
    margin: "0 0 0 12px",
    paddingLeft: "12px",
    borderLeft: "1px solid var(--line)",
  },
  "& .site-header": {
    position: "relative",
    zIndex: 2,
    margin: "auto",
    minHeight: "78px",
    maxWidth: "1184px",
    width: "100%",
    padding: "0 28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "28px",
    borderBottom: "1px solid var(--line)",
  },
  "& .workspace": {
    maxWidth: "1184px",
    padding: "0 28px",
    margin: "44px auto 80px",
  },
  "& .page-heading": {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "22px",
    marginBottom: "30px",
  },
  "& .page-heading > div > p": { marginBottom: 0, maxWidth: "68ch" },
  "& .section": { marginTop: "48px" },
  "& .detail-section": {
    margin: "32px 0",
    padding: "26px 0 0",
    borderTop: "1px solid var(--line)",
  },
  "& .detail-section > p": { maxWidth: "75ch" },
  "& .section-heading": {
    display: "flex",
    justifyContent: "space-between",
    gap: "18px",
    alignItems: "center",
    marginBottom: "16px",
  },
  "& .form-stack": { display: "grid", gap: "18px", maxWidth: "600px" },
  "& .form-stack > button": { justifySelf: "start" },
  "& .form-stack + .form-stack": { marginTop: "25px" },
});

export type DocumentProps = {
  title: string;
  children: RemixNode;
  user?: unknown;
  admin?: boolean;
  csrf?: string;
  error?: string;
  narrow?: boolean;
  active?: string;
  preview?: { base: string; name: string; exit: string };
};

function Navigation(handle: Handle<DocumentProps>) {
  return () => {
    const { user, admin, csrf, active, preview } = handle.props;
    const base = preview?.base || "";
    const link = (path: string, label: string, key?: string) => (
      <a href={path} aria-current={active === key ? "page" : undefined}>
        {label}
      </a>
    );
    if (preview)
      return (
        <>
          {link(base, "Your apps", "apps")}
          {link(base + "/account", "Account", "account")}
        </>
      );
    if (!user)
      return handle.props.title === "auth" ? null : link("/login", "Sign in");
    return (
      <>
        {link("/", "Your apps", "apps")}
        {link("/account", "Account", "account")}
        {admin ? (
          <>
            {link("/manage/people", "People", "people")}
            {link("/manage/groups", "Groups", "groups")}
            {link("/manage/services", "Services", "services")}
            {link("/manage/activity", "Activity", "activity")}
          </>
        ) : null}
        <form method="post" action="/logout">
          <input type="hidden" name="csrf" value={csrf || ""} />
          <button class="nav-button">Sign out</button>
        </form>
      </>
    );
  };
}

export function Document(handle: Handle<DocumentProps>) {
  return () => {
    const { title, user, narrow, preview, error, children } = handle.props;
    const login = title === "auth" && !user;
    const showNavigation = !login;
    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <meta name="theme-color" content="#f6f7f8" />
          <title>
            {title}
            {title === "auth" ? "" : " · auth"}
          </title>
          <link
            rel="preload"
            href="/assets/fonts/inter-variable.woff2"
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
          <link rel="stylesheet" href="/assets/style.css" />
          {login ? (
            <script type="module" src="/assets/doodle-motion.mjs" />
          ) : null}
        </head>
        <body
          class={narrow ? "authentication" : ""}
          mix={[
            theme,
            uiControlStyles,
            layoutStyles,
            sharedPageStyles,
            managementStyles,
            responsiveStyles,
            login ? fullWidthAction : null,
          ]}
        >
          <a class="skip-link" href="#main">
            Skip to content
          </a>
          {narrow ? (
            <div class="artwork-layer" innerHTML={unsafeHTML(dailyArtwork())} />
          ) : null}
          {preview ? (
            <aside class="preview-banner">
              <strong>Viewing {preview.name}</strong>
              <span>Temporary Auth preview · Read only</span>
              <a href={preview.exit}>Exit preview</a>
            </aside>
          ) : null}
          {showNavigation ? (
            <header class="site-header">
              <a class="brand" href={preview?.base || "/"} aria-label="auth">
                auth
                <span class="brand-dot" aria-hidden="true">
                  .
                </span>
              </a>
              <nav class="desktop-nav" aria-label="Main">
                <Navigation {...handle.props} />
              </nav>
              <details class="mobile-nav">
                <summary>Menu</summary>
                <nav aria-label="Mobile">
                  <Navigation {...handle.props} />
                </nav>
              </details>
            </header>
          ) : null}
          <main id="main" class={narrow ? "auth-page" : "workspace"}>
            {error ? (
              <p role="alert" class="error">
                {error}
              </p>
            ) : null}
            {children}
          </main>
        </body>
      </html>
    );
  };
}
