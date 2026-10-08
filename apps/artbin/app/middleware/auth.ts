import { createContextKey, type Middleware } from "remix/router";
import { redirect } from "remix/response/redirect";

import type { User } from "#db";
import { getUserFromRequest } from "#lib/auth.server";

import { routes } from "../routes.ts";

export const userContext = createContextKey<User | null>();
const userProperty = { property: "user" } as const;

export function loadUser(): Middleware<{
  key: typeof userContext;
  value: User | null;
  property: "user";
}> {
  return async (context, next) => {
    context.set(
      userContext,
      await getUserFromRequest(context.request),
      userProperty,
    );
    return next();
  };
}

export function requireUser(): Middleware {
  return (context, next) => {
    if (!context.get(userContext)) {
      const returnTo = encodeURIComponent(
        context.url.pathname + context.url.search,
      );
      return redirect(`${routes.login.href()}?returnTo=${returnTo}`, 303);
    }
    return next();
  };
}

export function requireAdmin(): Middleware {
  return (context, next) => {
    const user = context.get(userContext);
    if (!user) return redirect(routes.login.href(), 303);
    if (!user.isAdmin) return new Response("Forbidden", { status: 403 });
    return next();
  };
}
