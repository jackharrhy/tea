import { BoardCell } from "./app/data/board-cell.ts";
import { DirectoryCell } from "./app/data/directory-cell.ts";
import { createRuntime } from "./app/data/runtime.ts";
import { readSessionCookie } from "./app/middleware/session.ts";
import { createAppRouter } from "./app/router.ts";

export { BoardCell, DirectoryCell };

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) {
      return new Response("Cross-origin requests are not accepted", {
        status: 403,
      });
    }
    if (
      url.pathname === "/style.css" ||
      url.pathname === "/favicon.svg" ||
      url.pathname.startsWith("/assets/")
    ) {
      return withSecurityHeaders(await env.ASSETS.fetch(request));
    }

    if (!env.REF_PASSWORD)
      return new Response("REF_PASSWORD is not configured", { status: 503 });

    try {
      const runtime = createRuntime(env);
      const token = readSessionCookie(request);
      const authenticated = token
        ? await runtime.directory.session(token)
        : false;
      const router = createAppRouter(
        runtime,
        authenticated,
        token,
        env.REF_PASSWORD,
      );
      return withSecurityHeaders(await router.fetch(request), true);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "request_failed",
          message: errorMessage(error),
          path: url.pathname,
        }),
      );
      return new Response("Internal Server Error", { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

function withSecurityHeaders(
  response: Response,
  privateResponse = false,
): Response {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  if (privateResponse && !headers.has("Cache-Control"))
    headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}
