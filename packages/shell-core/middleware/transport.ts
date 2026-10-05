import type { Middleware } from "remix/router";
import { json } from "./security.ts";

export function limitConcurrency(maxConcurrent: number): Middleware {
  let active = 0;
  return async (_context, next) => {
    if (active >= maxConcurrent)
      return json({ error: "busy" }, 429, { "retry-after": "1" });
    active++;
    try {
      return await next();
    } finally {
      active--;
    }
  };
}

export function limitMcpBody(maxBytes: number): Middleware {
  return async (context, next) => {
    if (context.method !== "POST") return next();
    const request = context.request;
    const contentLength = request.headers.get("content-length");
    if (
      contentLength !== null &&
      (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)
    )
      return json({ error: "body_too_large" }, 413);

    const reader = request.body?.getReader();
    if (!reader) return json({ error: "missing_body" }, 400);

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("deadline")), 5_000);
    });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const item = await Promise.race([reader.read(), deadline]);
        if (item.done) break;
        size += item.value.byteLength;
        if (size > maxBytes) return json({ error: "body_too_large" }, 413);
        chunks.push(item.value);
      }
    } catch {
      return json({ error: "body_unreadable" }, 400);
    } finally {
      clearTimeout(timeout);
      void reader.cancel().catch(() => {});
    }

    context.request = new Request(request, {
      method: request.method,
      body: Buffer.concat(chunks),
    });
    return next();
  };
}
