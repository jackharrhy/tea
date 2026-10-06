import type { Handle, RemixNode } from "remix/component";
import { ImportMap } from "remix/component/server";
import { entryScript } from "../assets.ts";

export function Document(
  handle: Handle<{
    title: string;
    children: RemixNode;
    head?: RemixNode;
    admin?: boolean;
    background?: string;
    static?: boolean;
    publicScript?: string;
    visualEditing?: boolean;
    editorSession?: boolean;
    visualSlug?: string;
  }>,
) {
  return () => (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{handle.props.title}</title>
        {handle.props.admin && (
          <link
            rel="preload"
            href="/fonts/InterVariable.woff2"
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
        )}
        <link
          rel="stylesheet"
          href={handle.props.admin ? "/admin.css" : "/site.css"}
        />
        {!handle.props.admin &&
          !handle.props.static &&
          handle.props.publicScript && (
            <script src={handle.props.publicScript} defer></script>
          )}
        {handle.props.editorSession && (
          <script
            src="/tea-visual.js"
            data-slug={handle.props.visualSlug}
            data-active={handle.props.visualEditing ? "1" : "0"}
            defer
          ></script>
        )}
        {handle.props.head}
        {handle.props.admin && !handle.props.static && (
          <ImportMap value={entryScript.importMap} />
        )}
        {handle.props.admin &&
          !handle.props.static &&
          entryScript.preloads.map((href) => (
            <link rel="modulepreload" href={href} />
          ))}
        {handle.props.admin && !handle.props.static && (
          <script type="module" src={entryScript.href}></script>
        )}
      </head>
      <body
        className={handle.props.admin ? "cms" : "site"}
        style={{ backgroundColor: handle.props.background }}
      >
        {handle.props.children}
      </body>
    </html>
  );
}
