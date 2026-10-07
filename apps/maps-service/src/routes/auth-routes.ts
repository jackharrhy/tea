import {
  HostedHealthResponseSchema,
  HostedSessionResponseSchema,
} from "@tea/maps-protocol";
import { z } from "zod";

import {
  AUTOMATION_COOKIE,
  cookie,
  OAUTH_COOKIE,
  publicSessionUser,
  sessionUser,
  SESSION_COOKIE,
} from "../service-http.js";
import { defineWebRoute } from "../service-routing.js";
import {
  appendWebCookie,
  rejectCrossOriginMutation,
  webError,
  webErrorFromUnknown,
  webJson,
  webOk,
  webRedirect,
  webRequestBody,
} from "../service-web-http.js";
import {
  beginAuthorization,
  completeAuthorization,
  consumeAuthorizationTransaction,
} from "../oauth.js";
import type { WorldviewServiceOptions } from "../service-options.js";

export function createAuthRoutes(
  options: Pick<WorldviewServiceOptions, "database" | "fetch" | "oauth">,
) {
  return [
    defineWebRoute("health", "GET", "/health", () =>
      webJson(200, HostedHealthResponseSchema, { status: "ok" }),
    ),
    defineWebRoute("oauth-login", "GET", "/auth/login", (context) => {
      const auth = beginAuthorization(
        options.database,
        { ...options.oauth, publicUrl: context.publicOrigin },
        context.url.searchParams.get("returnTo") ?? "/",
      );
      const headers = new Headers();
      appendWebCookie(
        headers,
        OAUTH_COOKIE,
        auth.state,
        600,
        context.secureCookies,
      );
      return webRedirect(auth.url, headers);
    }),
    defineWebRoute(
      "oauth-callback",
      "GET",
      "/auth/callback",
      async (context) => {
        const cookieState = cookie(context.request, OAUTH_COOKIE);
        const headers = new Headers();
        appendWebCookie(headers, OAUTH_COOKIE, "", 0, context.secureCookies);
        try {
          const error = context.url.searchParams.get("error");
          const state = context.url.searchParams.get("state");
          if (error) {
            if (!state)
              return webError(400, "OAuth state is required", headers);
            consumeAuthorizationTransaction({
              database: options.database,
              state,
              cookieState,
            });
            return webRedirect(
              `/?authError=${encodeURIComponent(error)}`,
              headers,
            );
          }
          const code = context.url.searchParams.get("code");
          if (!state || !code) {
            return webError(400, "OAuth code and state are required", headers);
          }
          const completed = await completeAuthorization({
            database: options.database,
            config: { ...options.oauth, publicUrl: context.publicOrigin },
            state,
            code,
            cookieState,
            fetch: options.fetch ?? globalThis.fetch,
          });
          const session = options.database.createSession(completed.user.id);
          appendWebCookie(
            headers,
            SESSION_COOKIE,
            session.token,
            (session.expiresAt - Date.now()) / 1000,
            context.secureCookies,
          );
          return webRedirect(completed.returnTo, headers);
        } catch (error) {
          return webErrorFromUnknown(error, headers);
        }
      },
    ),
    defineWebRoute("logout", "POST", "/auth/logout", (context) => {
      const denied = rejectCrossOriginMutation(context);
      if (denied) return denied;
      options.database.deleteSession(cookie(context.request, SESSION_COOKIE));
      const headers = new Headers();
      appendWebCookie(headers, SESSION_COOKIE, "", 0, context.secureCookies);
      return webOk(headers);
    }),
    defineWebRoute("session", "GET", "/api/session", (context) =>
      webJson(200, HostedSessionResponseSchema, {
        user: publicSessionUser(sessionUser(context, options.database)),
      }),
    ),
    defineWebRoute(
      "automation-redeem",
      "POST",
      "/api/automation/redeem",
      async (context) => {
        const denied = rejectCrossOriginMutation(context);
        if (denied) return denied;
        try {
          const input = await webRequestBody(
            context.request,
            z.strictObject({ code: z.string().min(32).max(256) }),
          );
          const grant = options.database.redeemAutomationGrant(input.code);
          if (!grant)
            return webError(401, "Browser grant is invalid or expired");
          const headers = new Headers();
          appendWebCookie(
            headers,
            AUTOMATION_COOKIE,
            grant.token,
            (grant.expiresAt - Date.now()) / 1000,
            context.secureCookies,
          );
          return webJson(
            200,
            z.strictObject({ projectId: z.string(), expiresAt: z.number() }),
            { projectId: grant.projectId, expiresAt: grant.expiresAt },
            headers,
          );
        } catch (error) {
          return webErrorFromUnknown(error);
        }
      },
    ),
  ] as const;
}
