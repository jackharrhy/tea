import { createContextKey, type Middleware } from "remix/router";
import type { ContentStore } from "../data/content.ts";
import type { AuthStore, User } from "../data/auth.ts";
import {
  cookieValue,
  operatorSiteCookieName,
  sessionId,
} from "../data/auth.ts";
import type { OperatorAccess } from "../operator-access.ts";

import type { SiteRuntime } from "../site.ts";
export const siteContext = createContextKey<SiteRuntime>();
export const contentContext = createContextKey<ContentStore>();
export const authContext = createContextKey<AuthStore>();
export const userContext = createContextKey<User | null>();
export function services(
  content: ContentStore,
  auth: AuthStore,
  site: SiteRuntime,
  operator?: OperatorAccess,
): Middleware<
  readonly [
    { key: typeof siteContext; value: SiteRuntime },
    { key: typeof contentContext; value: ContentStore },
    { key: typeof authContext; value: AuthStore },
    { key: typeof userContext; value: User | null },
  ]
> {
  return (context, next) => {
    context.set(siteContext, site);
    context.set(contentContext, content);
    context.set(authContext, auth);
    context.set(
      userContext,
      auth.resolve(sessionId(context.request, site.id)) ??
        operator?.resolveSiteSession(
          site.id,
          cookieValue(context.request, operatorSiteCookieName(site.id)),
        ) ??
        null,
    );
    return next();
  };
}
export const requireEditor: Middleware = (context, next) => {
  if (!context.get(userContext)) {
    if (context.method !== "GET")
      return Response.json(
        {
          error:
            "Your session expired. Sign in again; keep this tab open to preserve your edits.",
        },
        { status: 401 },
      );
    return new Response(null, {
      status: 303,
      headers: { Location: "/tea/login" },
    });
  }
  return next();
};
export const protectWrites =
  (site: SiteRuntime): Middleware =>
  async (context, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(context.request.method)) {
      const origin = context.request.headers.get("origin");
      const allowed = new Set(
        [context.url.origin, site.origin].filter(Boolean),
      );
      if (
        context.url.pathname !== "/tea/mcp" &&
        (!origin || !allowed.has(origin))
      )
        return Response.json(
          { error: "This request must come from the CMS." },
          { status: 403 },
        );
      const size = Number(context.request.headers.get("content-length") ?? 0);
      if (size > 26 * 1024 * 1024)
        return Response.json(
          { error: "Uploads must be smaller than 25 MB." },
          { status: 413 },
        );
    }
    const response = await next();
    if (response) {
      response.headers.set("X-Content-Type-Options", "nosniff");
      if (site.preview)
        response.headers.set("X-Robots-Tag", "noindex, nofollow");
      response.headers.set(
        "Referrer-Policy",
        "strict-origin-when-cross-origin",
      );
      if (
        context.url.pathname.startsWith("/tea/") &&
        !context.url.pathname.startsWith("/tea/api/media/file/")
      ) {
        response.headers.set("Cache-Control", "no-store");
        response.headers.set("X-Robots-Tag", "noindex, nofollow");
        response.headers.set("X-Frame-Options", "SAMEORIGIN");
      }
    }
    return response;
  };
