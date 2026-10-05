import { json } from "./middleware/security.ts";
/** Bounded transport envelope before Remix/MCP parses JSON; no reliance on Content-Length. */
export function limitedFetch(
  handler: (request: Request) => Promise<Response>,
  maxConcurrent = 8,
) {
  let active = 0;
  return async (request: Request): Promise<Response> => {
    if (active >= maxConcurrent)
      return json({ error: "busy" }, 429, { "retry-after": "1" });
    active++;
    try {
      const url = new URL(request.url);
      // Remix decodes route escapes. Refuse aliases before either auth or body parsing.
      // Matching only raw '/mcp' in middleware would otherwise miss '/%6dcp'.
      if (
        ![
          "/mcp",
          "/healthz",
          "/.well-known/oauth-protected-resource/mcp",
        ].includes(url.pathname)
      )
        return json({ error: "not_found" }, 404);
      if (url.pathname === "/mcp" && request.method === "POST") {
        const rawLength = request.headers.get("content-length");
        if (
          rawLength !== null &&
          (!/^\d+$/.test(rawLength) || Number(rawLength) > 16_384)
        )
          return json({ error: "body_too_large" }, 413);
        const reader = request.body?.getReader();
        if (!reader) return json({ error: "missing_body" }, 400);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("deadline")), 5_000);
        });
        const parts: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const item = await Promise.race([reader.read(), deadline]);
            if (item.done) break;
            size += item.value.byteLength;
            if (size > 16_384) return json({ error: "body_too_large" }, 413);
            parts.push(item.value);
          }
          request = new Request(request, {
            method: request.method,
            body: Buffer.concat(parts),
          });
        } catch {
          return json({ error: "body_unreadable" }, 400);
        } finally {
          clearTimeout(timeout);
          void reader.cancel().catch(() => {});
        }
      }
      return await handler(request);
    } finally {
      active--;
    }
  };
}
