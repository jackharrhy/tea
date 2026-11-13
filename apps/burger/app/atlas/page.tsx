import { css, type Handle } from "remix/component";
import { AtlasEditor } from "./editor";

const pageStyle = css({
  color: "#eee6cd",
  background: "#111713",
  font: "14px/1.5 system-ui, sans-serif",
  "min-height": "100%",
  "& *": { "box-sizing": "border-box" },
  "& body": { margin: "0" },
  "& a": { color: "#e5c47e" },
});

export function AtlasPage(handle: Handle<{ nonce?: string }>) {
  return () => (
    <html lang="en" mix={pageStyle}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Burger atlas · Tea</title>
      </head>
      <body>
        <AtlasEditor />
        <script
          type="module"
          src="/assets/game.js"
          nonce={handle.props.nonce}
        />
      </body>
    </html>
  );
}
