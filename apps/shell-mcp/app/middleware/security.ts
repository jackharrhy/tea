import { createContextKey, type Middleware } from "remix/router";
import type { ShellConfig } from "../config-types.ts";
import { type IdentityProvider, type Principal } from "../auth/types.ts";
export const Identity = createContextKey<Principal>();
export function json(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}
export const privateResponses: Middleware = async (_ctx, next) => {
  const response = await next();
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set(
    "content-security-policy",
    "default-src 'none'; frame-ancestors 'none'",
  );
  return response;
};
export function authenticate(
  provider: IdentityProvider,
  config: ShellConfig,
): Middleware {
  return async (ctx, next) => {
    // Host/origin checks complement bearer authentication; they do not fix provider-origin XSS.
    if (ctx.url.origin !== config.publicOrigin)
      return json({ error: "invalid_origin" }, 403);
    const origin = ctx.request.headers.get("origin");
    if (origin !== null && origin !== config.publicOrigin)
      return json({ error: "invalid_origin" }, 403);
    if (config.mode === "locked") return json({ error: "not_configured" }, 503);
    const match = /^Bearer ([A-Za-z0-9._~+/-]+={0,2})$/i.exec(
      ctx.request.headers.get("authorization") ?? "",
    );
    try {
      if (!match?.[1] || match[1].length > 4096) throw new Error();
      const identity = await provider.verify(match[1]);
      if (
        !config.allowedUsernames.includes(identity.username) ||
        identity.admin !== true ||
        !identity.issuer ||
        !identity.subject ||
        identity.expiresAt <= Date.now()
      )
        throw new Error();
      ctx.set(Identity, identity);
    } catch {
      return json({ error: "invalid_token" }, 401, {
        "www-authenticate": `Bearer resource_metadata="${config.publicOrigin}/.well-known/oauth-protected-resource/mcp"`,
      });
    }
    return next();
  };
}
