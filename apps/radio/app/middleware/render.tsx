import type { Router } from "remix/router";
import { renderWith } from "remix/middleware/render";
import { createHtmlResponse } from "remix/response/html";
import type { RemixNode } from "remix/component";
import { renderToStream } from "remix/component/server";
import { browserAssets } from "../assets/build-manifest.ts";

export function render() {
  return renderWith(
    ({ request, router }) =>
      function renderResponse(node: RemixNode, init?: ResponseInit) {
        let stream = renderToStream(node, {
          frameSrc: request.url,
          signal: request.signal,
          resolveFrame: (src) => resolveFrame(router, request, src),
          // Server rendering turns client entries into browser module URLs.
          async resolveClientEntry(entryId) {
            let exportName =
              entryId === "radio-room#RadioRoom"
                ? "RadioRoom"
                : entryId === "radio-room#TrackListPreview"
                  ? "TrackListPreview"
                  : null;
            if (!exportName)
              throw new Error(`Unknown client entry '${entryId}'`);
            return { href: browserAssets.radioRoom, exportName };
          },
        });

        return createHtmlResponse(stream, init);
      },
  );
}

async function resolveFrame(router: Router, request: Request, src: string) {
  let url = new URL(src, request.url);

  let headers = new Headers();
  headers.set("Accept", "text/html");

  let cookie = request.headers.get("Cookie");
  if (cookie) headers.set("Cookie", cookie);

  let response = await router.fetch(
    new Request(url, {
      method: "GET",
      headers,
      signal: request.signal,
    }),
  );

  if (!response.ok) {
    return `<pre>Frame error: ${response.status} ${response.statusText}</pre>`;
  }

  if (response.body) return response.body;
  return await response.text();
}
