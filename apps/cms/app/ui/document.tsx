import { css, type Handle, type RemixNode } from "remix/component";
import { ImportMap } from "remix/component/server";
import { entryScript } from "../assets.ts";
import { adminCoreStyles } from "./admin-core-styles.ts";
import { adminEditorStyles } from "./admin-editor-styles.ts";
import { adminLibraryStyles } from "./admin-library-styles.ts";
import { adminWorkspaceStyles } from "./admin-workspace-styles.ts";

export function Document(
  handle: Handle<{
    title: string;
    children: RemixNode;
    head?: RemixNode;
    styles?: ReturnType<typeof css>[];
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
    <html
      lang="en"
      mix={
        handle.props.admin
          ? [
              adminCoreStyles,
              adminEditorStyles,
              adminLibraryStyles,
              adminWorkspaceStyles,
              ...(handle.props.styles ?? []),
            ]
          : handle.props.styles
      }
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{handle.props.title}</title>
        {handle.props.admin && (
          <>
            <link
              rel="preload"
              href="/fonts/InterVariable.woff2"
              as="font"
              type="font/woff2"
              crossOrigin="anonymous"
            />
            <link rel="stylesheet" href="/fonts.css" />
          </>
        )}
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
