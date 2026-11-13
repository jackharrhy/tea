import { css, unsafeHTML, type Handle } from "remix/component";
import { renderToString } from "remix/component/server";
import { createUiTheme, uiControlStyles, uiPrimaryActionStyles } from "@harrhy/ui";
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

const loginControls = css({
  "& .form-stack > button": {
    width: "100%",
    "min-height": "44px",
  },
});

type LoginProps = { csrf: string; returnTo: string; error?: string };

function LoginDocument(handle: Handle<LoginProps>) {
  return () => (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="theme-color" content="#f6f7f8" />
        <title>auth</title>
        <link
          rel="preload"
          href="/assets/fonts/inter-variable.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link rel="stylesheet" href="/assets/style.css" />
        <script type="module" src="/assets/doodle-motion.mjs" />
      </head>
      <body class="authentication" mix={[theme, uiControlStyles, loginControls]}>
        <a class="skip-link" href="#main">Skip to content</a>
        <div innerHTML={unsafeHTML(dailyArtwork())} />
        <main id="main" class="auth-page">
          {handle.props.error ? (
            <p role="alert" class="error">{handle.props.error}</p>
          ) : null}
          <h1 class="login-title">auth</h1>
          <form method="post" action="/login" class="form-stack">
            <input type="hidden" name="csrf" value={handle.props.csrf} />
            <input type="hidden" name="returnTo" value={handle.props.returnTo} />
            <label>
              Username or email
              <input
                name="username"
                autoComplete="username"
                required
                autoFocus
                maxLength={250}
                autoCapitalize="none"
                spellCheck={false}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                maxLength={1000}
              />
            </label>
            <button class="primary" mix={uiPrimaryActionStyles}>Sign in</button>
          </form>
          <a class="text-link" href="/forgot-password">Forgot password?</a>
        </main>
      </body>
    </html>
  );
}

export function renderLogin(props: LoginProps, nonce: string) {
  return renderToString(<LoginDocument {...props} />, { nonce });
}
