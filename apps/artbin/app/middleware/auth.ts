import { createContextKey, type Middleware } from "remix/router";
import { redirect } from "remix/response/redirect";

import { getUserFromRequest, type RequestUser } from "#lib/auth.server";
import { auditSupportMutation } from "#lib/support-login.server";

import { routes } from "../routes.ts";

export const userContext = createContextKey<RequestUser | null>();
const userProperty = { property: "user" } as const;

export function loadUser(): Middleware<{
  key: typeof userContext;
  value: RequestUser | null;
  property: "user";
}> {
  return async (context, next) => {
    const user = await getUserFromRequest(context.request);
    context.set(userContext, user, userProperty);
    let status = 500;
    try {
      const response = await next();
      status = response.status;
      return response;
    } finally {
      auditSupportMutation(context.request, user, status);
    }
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
