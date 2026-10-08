import type { Handle, RemixNode } from "remix/component";
import { ImportMap } from "remix/component/server";

import { documentImportMap, entryScript } from "../assets.ts";
import { documentStyle } from "../ui/styles.ts";

export interface DocumentProps {
  children?: RemixNode;
  head?: RemixNode;
  title?: string;
}

export function Document(handle: Handle<DocumentProps>) {
  return () => {
    const {
      children,
      head,
      title = "artbin: texture and asset repository",
    } = handle.props;

    return (
      <html lang="en" mix={documentStyle}>
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link
            rel="icon"
            type="image/svg+xml"
            href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎨</text></svg>"
          />
          <title>{title}</title>
          {head}
          <ImportMap value={documentImportMap} />
          {entryScript.preloads.map((href) => (
            <link key={href} rel="modulepreload" href={href} />
          ))}
          <script type="module" src={entryScript.href}></script>
        </head>
        <body>{children}</body>
      </html>
    );
  };
}
