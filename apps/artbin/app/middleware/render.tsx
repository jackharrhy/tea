import * as path from "node:path";

import { renderWith } from "remix/middleware/render";
import { getCspNonce, inheritCspNonce } from "remix/middleware/csp";
import { createHtmlResponse } from "remix/response/html";
import type { Router } from "remix/router";
import type { RemixNode } from "remix/component";
import { renderToStream } from "remix/component/server";

import { assetServer } from "../assets.ts";

export function render() {
  return renderWith(
    (context) =>
      function renderResponse(node: RemixNode, init?: ResponseInit) {
        const { request, router } = context;
        const nonce = getCspNonce(context);
        const stream = renderToStream(node, {
          frameSrc: request.url,
          signal: request.signal,
          nonce,
          resolveFrame: (src) => resolveFrame(router, request, src, nonce),
          async resolveClientEntry(entryId, component) {
            if (!entryId.startsWith("file://")) {
              throw new Error(
                `Expected import.meta.url for clientEntry ID, received '${entryId}'`,
              );
            }

            const { href, importMap, preloads } =
              await assetServer.getScriptEntry(entryId);

            return {
              href,
              importMap,
              exportName:
                entryId.split("#")[1] ||
                component.name ||
                titleCaseFileName(entryId),
              preloads,
            };
          },
        });

        return createHtmlResponse(stream, init);
      },
  );
}

async function resolveFrame(
  router: Router,
  request: Request,
  src: string,
  nonce?: string,
) {
  const url = new URL(src, request.url);
  const headers = new Headers({ Accept: "text/html" });
  const cookie = request.headers.get("Cookie");
  if (cookie) headers.set("Cookie", cookie);

  const frameRequest = new Request(url, {
    method: "GET",
    headers,
    signal: request.signal,
  });
  if (nonce) inheritCspNonce(frameRequest, nonce);
  const response = await router.fetch(frameRequest);

  if (!response.ok) {
    return `<pre>Frame error: ${response.status} ${response.statusText}</pre>`;
  }

  return response.body ?? (await response.text());
}

function titleCaseFileName(fileUrl: string): string {
  const url = new URL(fileUrl);
  const fileName = path.basename(url.pathname, path.extname(url.pathname));
  return fileName
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment[0]!.toUpperCase() + segment.slice(1))
    .join("");
}
