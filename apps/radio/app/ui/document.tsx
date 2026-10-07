import type { Handle, RemixNode } from "remix/component";
import { css } from "remix/component";
import { browserAssets } from "../assets/build-manifest.ts";

export interface DocumentProps {
  children?: RemixNode;
  head?: RemixNode;
  title?: string;
}

const DEFAULT_TITLE = "tea/radio";

export function Document(handle: Handle<DocumentProps>) {
  return () => {
    let { children, head, title = DEFAULT_TITLE } = handle.props;

    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
          <link rel="stylesheet" href="/fonts/material-symbols.css" />
          <title>{title}</title>
          {head}
        </head>
        <body
          mix={css({
            margin: 0,
            boxSizing: "border-box",
            "& *, & *::before, & *::after": { boxSizing: "border-box" },
          })}
        >
          {children}
          <script type="module" src={browserAssets.entry}></script>
        </body>
      </html>
    );
  };
}
