import { runtime, readCookie, hash } from "./app/runtime.ts";
import type { Bindings } from "./app/runtime.ts";
import { CommunityError } from "./app/data/community.ts";
import { createAppRouter } from "./app/router.tsx";
import { WorkerEntrypoint } from "cloudflare:workers";
export { CommunityCell } from "./app/data/community-cell.ts";

export class CommunityPublicDirectory extends WorkerEntrypoint<Bindings> {
  async listPublicMembers() {
    const members = await runtime(this.env).call("members");
    return members.map(
      ({ username, display_name, status_text, status_emoji }) => ({
        username,
        displayName: display_name,
        statusText: status_text,
        statusEmoji: status_emoji,
      }),
    );
  }
}

export default {
  async fetch(
    request: Request,
    env: Bindings,
    context: ExecutionContext,
  ): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/health")
        return Response.json({ ok: true, app: "fourm" });
      if (url.pathname.startsWith("/assets/")) return env.ASSETS.fetch(request);
      const canonical = new URL(env.AUTH_PUBLIC_ORIGIN);
      if (
        canonical.origin !== env.AUTH_PUBLIC_ORIGIN ||
        (canonical.protocol !== "https:" &&
          !["localhost", "127.0.0.1", "[::1]"].includes(canonical.hostname))
      )
        throw new CommunityError(503, "The public origin is not configured");
      const origin = request.headers.get("Origin");
      if (origin && origin !== env.AUTH_PUBLIC_ORIGIN)
        throw new CommunityError(403, "Cross-origin request denied");
      const session = readCookie(request, "fourm_session");
      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        session &&
        !origin &&
        !request.headers.has("Authorization")
      )
        throw new CommunityError(403, "A same-origin request is required");
      if (Number(request.headers.get("Content-Length") ?? 0) > 21 * 1024 * 1024)
        throw new CommunityError(413, "Request is too large");
      const store = runtime(env);
      if (url.pathname === "/ready") {
        await store.call("members");
        return Response.json({ ready: true });
      }
      const sessionHash =
        session && /^[0-9a-f]{64}$/.test(session) ? await hash(session) : null;
      const viewer = {
        member: sessionHash ? await store.call("session", sessionHash) : null,
        sessionHash,
      };
      const response = await createAppRouter(env, store, viewer, (operation) =>
        context.waitUntil(operation),
      ).fetch(request);
      const secured = new Response(response.body, response);
      secured.headers.set("X-Content-Type-Options", "nosniff");
      secured.headers.set("Referrer-Policy", "same-origin");
      secured.headers.set("Cache-Control", "no-store");
      secured.headers.set(
        "Content-Security-Policy",
        "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
      );
      return secured;
    } catch (error) {
      const status =
        error instanceof CommunityError
          ? error.status
          : error &&
              typeof error === "object" &&
              "status" in error &&
              typeof error.status === "number"
            ? error.status
            : 503;
      return Response.json(
        {
          error:
            error instanceof CommunityError
              ? error.message
              : "Request failed. Try again.",
        },
        { status },
      );
    }
  },
} satisfies ExportedHandler<Bindings>;
