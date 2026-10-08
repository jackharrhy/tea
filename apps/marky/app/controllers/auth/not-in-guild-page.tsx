import { css } from "remix/component";

import { routes } from "../../routes.ts";

const containerStyle = css({
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--bg, #fffcf0)",
  fontFamily:
    "'Source Code Pro', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
  padding: "24px",
});

const cardStyle = css({
  maxWidth: "480px",
  padding: "32px",
  border: "1px solid #cecdc3",
  borderRadius: "8px",
  background: "#f2f0e5",
  textAlign: "center",
});

const linkStyle = css({
  color: "#205ea6",
  textDecoration: "underline",
});

export function NotInGuildPage() {
  return () => (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>tea/marky: access required</title>
      </head>
      <body mix={containerStyle}>
        <main mix={cardStyle}>
          <h1>You're not in the right Discord server.</h1>
          <p>
            tea/marky is gated to members of a specific Discord server. Sign in
            with a Discord account that's a member there to continue.
          </p>
          <p>
            <a mix={linkStyle} href={routes.auth.signIn.href()}>
              Try signing in again
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}
