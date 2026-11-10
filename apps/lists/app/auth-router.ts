import {
  createIdentityClient,
  createLoginTransaction,
  validLoginTransaction,
  type LoginTransaction,
} from "@tea/identity";
import { and, eq } from "drizzle-orm";
import { render } from "remix/middleware/render";
import { createController, createRouter } from "remix/router";

import { createSession } from "../src/auth.ts";
import type { Config } from "../src/config.ts";
import type { Db } from "../src/db/index.ts";
import { schema } from "../src/db/index.ts";
import { routes } from "./routes.ts";
import type { AppContext } from "./router.tsx";

const cookieName = "lists_oauth";

function safeReturnTo(value: unknown) {
  return typeof value === "string" &&
    /^\/admin(?:\/|$)/.test(value) &&
    !value.includes("\\") &&
    !value.startsWith("//")
    ? value
    : "/admin/";
}

function cookie(value: string, secure: boolean, maxAge: number) {
  return `${cookieName}=${value}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function readCookie(
  request: Request,
): (LoginTransaction & { returnTo?: string }) | null {
  const raw = request.headers
    .get("Cookie")
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  if (!raw || raw.length > 4096) return null;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as LoginTransaction & { returnTo?: string })
      : null;
  } catch {
    return null;
  }
}

function redirect(location: string, setCookie?: string) {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "no-store",
  });
  if (setCookie) headers.set("Set-Cookie", setCookie);
  return new Response(null, { status: 303, headers });
}

export function createAuthRouter(
  db: Db,
  config: Config,
  fetcher: typeof fetch = fetch,
) {
  if (!config.identity) throw new Error("Central identity is not configured");
  const identity = createIdentityClient(config.identity, fetcher);
  const secure = new URL(config.baseUrl).protocol === "https:";
  const callbackUri = `${config.baseUrl}/auth/callback`;
  const router = createRouter<AppContext>({ middleware: [render()] });
  router.map(
    routes.auth,
    createController(routes.auth, {
      actions: {
        async login(context) {
          const transaction = createLoginTransaction();
          const returnTo = safeReturnTo(
            context.url.searchParams.get("returnTo"),
          );
          const authorization = await identity.authorizationUrl(
            transaction,
            callbackUri,
          );
          const state = Buffer.from(
            JSON.stringify({ ...transaction, returnTo }),
          ).toString("base64url");
          return redirect(authorization, cookie(state, secure, 600));
        },
        async callback(context) {
          const transaction = readCookie(context.request);
          const cleared = cookie("", secure, 0);
          const state = context.url.searchParams.get("state");
          const code = context.url.searchParams.get("code");
          if (
            !transaction ||
            !validLoginTransaction(transaction, state) ||
            !code ||
            context.url.searchParams.has("error")
          ) {
            return new Response("Sign-in could not be completed", {
              status: 400,
              headers: { "Set-Cookie": cleared, "Cache-Control": "no-store" },
            });
          }
          try {
            const profile = await identity.exchange(
              code,
              transaction,
              callbackUri,
            );
            const user = db
              .select()
              .from(schema.users)
              .where(
                and(
                  eq(schema.users.authSubject, profile.subject),
                  eq(schema.users.authPrincipalType, "user"),
                ),
              )
              .get();
            if (
              !user ||
              (user.role === "owner" || user.role === "admin"
                ? !profile.roles.has("admin")
                : !profile.roles.has("member") && !profile.roles.has("admin"))
            ) {
              return new Response("Lists access has not been assigned", {
                status: 403,
                headers: { "Set-Cookie": cleared, "Cache-Control": "no-store" },
              });
            }
            const session = createSession(db, user.id, profile.expiresAt);
            const response = redirect(
              safeReturnTo(transaction.returnTo),
              cleared,
            );
            response.headers.append(
              "Set-Cookie",
              `session=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600${secure ? "; Secure" : ""}`,
            );
            return response;
          } catch (error) {
            const status =
              error &&
              typeof error === "object" &&
              "status" in error &&
              typeof error.status === "number"
                ? error.status
                : 503;
            return new Response("Sign-in could not be completed", {
              status,
              headers: { "Set-Cookie": cleared, "Cache-Control": "no-store" },
            });
          }
        },
      },
    }),
  );
  return router;
}
