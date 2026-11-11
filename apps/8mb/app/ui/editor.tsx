import { readFileSync } from "node:fs";
import { css, type RemixNode } from "remix/component";
import { Fragment, jsx, jsxs } from "remix/component/jsx-runtime";
import { fromHtml } from "hast-util-from-html";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { legacyStyles } from "./legacy-styles.ts";

const source = readFileSync(new URL("./editor.html", import.meta.url), "utf8");
const bodySource = source.match(
  /<body>([\s\S]*?)<script type="module" src="\/src\/main\.ts"><\/script>[\s\S]*?<\/body>/,
)?.[1];
if (!bodySource) throw new Error("8mb editor document is incomplete");
const body = toJsxRuntime(fromHtml(bodySource, { fragment: true }), {
  Fragment,
  jsx,
  jsxs,
  elementAttributeNameCase: "html",
}) as RemixNode;

const page = css({ colorScheme: "light dark" });

export function editorDocument(script: string) {
  return (
    <html lang="en" mix={[...legacyStyles, page]}>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#fafaf9" />
        <meta
          name="description"
          content="Compress videos to under 8 MB in your browser. Trim the part you want to keep. Your video stays on your device."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://jackharrhy.dev/8mb/" />
        <meta property="og:site_name" content="8mb" />
        <meta property="og:title" content="8mb - shrink your video" />
        <meta
          property="og:description"
          content="semaglutide injection for your mp4s"
        />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="8mb - shrink your video" />
        <meta
          name="twitter:description"
          content="semaglutide injection for your mp4s"
        />
        <link rel="canonical" href="https://jackharrhy.dev/8mb/" />
        <link rel="icon" type="image/svg+xml" href="/8mb/icon.svg" />
        <link
          rel="preload"
          href="/8mb/fonts/inter-variable.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link rel="stylesheet" href="/8mb/properties.css" />
        <title>8mb - shrink your video</title>
      </head>
      <body>
        {body}
        <script type="module" src={script} />
      </body>
    </html>
  );
}
