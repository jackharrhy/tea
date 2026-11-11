import { BoardCell } from "./app/data/board-cell.ts";
import { DirectoryCell } from "./app/data/directory-cell.ts";
import { createRuntime } from "./app/data/runtime.ts";
import { readSessionCookie } from "./app/middleware/session.ts";
import { createAppRouter } from "./app/router.ts";
import {
  createIdentityClient,
  IdentityError,
  requireTokenRole,
} from "@tea/identity";

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

    const central = Boolean(env.AUTH_ISSUER);
    if (!central && !env.REF_PASSWORD)
      return new Response("REF_PASSWORD is not configured", { status: 503 });
    let publicOrigin: URL | null = null;
    if (central && env.AUTH_PUBLIC_ORIGIN) {
      try {
        publicOrigin = new URL(env.AUTH_PUBLIC_ORIGIN);
      } catch {
        return new Response("Central Auth is not configured", { status: 503 });
      }
    }
    if (
      central &&
      (!env.AUTH_CLIENT_ID ||
        !env.AUTH_PROJECT_ID ||
        !env.AUTH_ORGANIZATION_ID ||
        !publicOrigin ||
        publicOrigin.protocol !== "https:" ||
        publicOrigin.origin !== env.AUTH_PUBLIC_ORIGIN)
    )
      return new Response("Central Auth is not configured", { status: 503 });

    try {
      const runtime = createRuntime(env);
      const token = readSessionCookie(request);
      let authenticated = token
        ? await runtime.directory.session(token)
        : false;
      const bearer = request.headers.get("Authorization");
      if (
        central &&
        !authenticated &&
        bearer?.startsWith("Bearer ") &&
        (url.pathname.startsWith("/api/archive/") ||
          url.pathname.startsWith("/media/") ||
          url.pathname.startsWith("/previews/"))
      ) {
        if (!env.AUTH_INTROSPECTION_CLIENT_ID || !env.AUTH_INTROSPECTION_SECRET)
          return new Response("Archive authentication is unavailable", {
            status: 503,
          });
        try {
          const principal = await createIdentityClient({
            issuer: env.AUTH_ISSUER,
            clientId: env.AUTH_CLIENT_ID,
            projectId: env.AUTH_PROJECT_ID,
            organizationId: env.AUTH_ORGANIZATION_ID,
          }).introspect(bearer.slice(7), {
            clientId: env.AUTH_INTROSPECTION_CLIENT_ID,
            clientSecret: env.AUTH_INTROSPECTION_SECRET,
          });
          if (principal.principalType !== "user")
            return new Response("Human archive authorization required", {
              status: 403,
            });
          requireTokenRole(principal, env.AUTH_PROJECT_ID, "admin");
          authenticated = true;
        } catch (error) {
          return new Response("Archive authorization failed", {
            status: error instanceof IdentityError ? error.status : 503,
          });
        }
      }
      const router = createAppRouter(
        runtime,
        authenticated,
        token,
        env.REF_PASSWORD,
        central
          ? {
              config: {
                issuer: env.AUTH_ISSUER,
                clientId: env.AUTH_CLIENT_ID,
                projectId: env.AUTH_PROJECT_ID,
                organizationId: env.AUTH_ORGANIZATION_ID,
              },
              origin: env.AUTH_PUBLIC_ORIGIN,
            }
          : null,
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
