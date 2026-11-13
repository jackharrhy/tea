import { css, unsafeHTML, type Handle, type RemixNode } from "remix/component";
import { createUiTheme, uiControlStyles } from "@harrhy/ui";
import { dailyArtwork } from "./appearance.mjs";

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

export const fullWidthAction = css({
  "& .form-stack > button": {
    width: "100%",
    "min-height": "44px",
  },
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
          mix={[theme, uiControlStyles, login ? fullWidthAction : null]}
        >
          <a class="skip-link" href="#main">
            Skip to content
          </a>
          {narrow ? <div innerHTML={unsafeHTML(dailyArtwork())} /> : null}
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
