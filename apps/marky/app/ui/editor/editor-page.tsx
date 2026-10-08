import { css, type Handle } from "remix/component";
import { ImportMap } from "remix/component/server";
import { entryScript } from "../../assets.ts";

import { EditorApp } from "./editor-app.tsx";

const TITLE = "tea/marky";
const FONT_STACK =
  "'Source Code Pro', 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

export interface EditorPageProps {
  authMode:
    | { mode: "anonymous" }
    | { mode: "discord"; identity: { name: string; color: string } };
}

// Server-rendered shell for the editor. The interactive workspace is a single
// client entry (`EditorApp`) that owns the websocket, file list, and editor.
export function EditorPage(handle: Handle<EditorPageProps>) {
  return () => (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>{TITLE}</title>
        <ImportMap value={entryScript.importMap} />
        {entryScript.preloads.map((href) => (
          <link rel="modulepreload" href={href} />
        ))}
        <script type="module" src={entryScript.href} />
      </head>
      <body
        mix={css({
          margin: 0,
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          fontFamily: FONT_STACK,
          fontSize: "14px",
          background: "var(--bg)",
          color: "var(--tx)",
          "--bg": "#fffcf0",
          "--bg-2": "#f2f0e5",
          "--ui": "#e6e4d9",
          "--ui-2": "#dad8ce",
          "--ui-3": "#cecdc3",
          "--tx": "#100f0f",
          "--tx-2": "#6f6e69",
          "--tx-3": "#b7b5ac",
          "@media (prefers-color-scheme: dark)": {
            "--bg": "#100f0f",
            "--bg-2": "#1c1b1a",
            "--ui": "#282726",
            "--ui-2": "#343331",
            "--ui-3": "#403e3c",
            "--tx": "#cecdc3",
            "--tx-2": "#878580",
            "--tx-3": "#575653",
          },
          "& *, & *::before, & *::after": { boxSizing: "border-box" },
          "& .ProseMirror": { outline: "none", minHeight: "100%" },
          "& .ProseMirror p": { margin: 0 },
          "& .ProseMirror-yjs-cursor": {
            position: "relative",
            marginLeft: "-1px",
            marginRight: "-1px",
            borderLeft: "1px solid currentColor",
            borderRight: "1px solid currentColor",
            wordBreak: "normal",
            pointerEvents: "none",
          },
          "& .ProseMirror-yjs-cursor > div": {
            position: "absolute",
            top: "-1.05em",
            left: "-1px",
            fontSize: "11px",
            background: "currentColor",
            color: "var(--bg)",
            fontStyle: "normal",
            fontWeight: "normal",
            lineHeight: "normal",
            userSelect: "none",
            paddingLeft: "4px",
            paddingRight: "4px",
            whiteSpace: "nowrap",
            borderRadius: "2px",
          },
        })}
      >
        <EditorApp authMode={handle.props.authMode} />
      </body>
    </html>
  );
}
