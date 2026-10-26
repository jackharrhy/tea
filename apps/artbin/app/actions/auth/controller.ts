import { nanoid } from "nanoid";
import { createController } from "remix/router";
import { and, eq, gt } from "drizzle-orm";
import { createRequestLogger } from "evlog";

import { db } from "#db/connection.server";
import { cliLoginHandoffs, sessions, users, type User } from "#db";
import { getSessionCookie } from "#lib/auth.server";
import {
  identityClient,
  createLoginTransaction,
  validLoginTransaction,
  browserRedirectUri,
  getCliRedirectUri,
  type LoginTransaction,
} from "#lib/oauth.server";

import { routes } from "../../routes.ts";

const SESSION_MAX_AGE = 60 * 60;
const CLI_HANDOFF_MAX_AGE_MS = 2 * 60 * 1_000;

export default createController(routes.auth, {
  actions: {
    async login() {
      const transaction = createLoginTransaction();
      return redirectWithHeaders(
        await identityClient().authorizationUrl(
          transaction,
          browserRedirectUri(),
        ),
        {
          "Set-Cookie": oauthCookie(
            "artbin_oauth",
            JSON.stringify(transaction),
            600,
          ),
        },
      );
    },

    async callback(context) {
      const log = createRequestLogger();
      const code = context.url.searchParams.get("code");
      const state = context.url.searchParams.get("state");
      const oauthError = context.url.searchParams.get("error");

      const oauthData = readOauthCookie<LoginTransaction>(
        context.request,
        "artbin_oauth",
      );
      if (!oauthData)
        return terminalLoginError("missing_oauth_state", "artbin_oauth");
      if (!validLoginTransaction(oauthData, state)) {
        return terminalLoginError("state_mismatch", "artbin_oauth");
      }
      if (oauthError) return terminalLoginError(oauthError, "artbin_oauth");
      if (!code) return terminalLoginError("missing_code", "artbin_oauth");

      try {
        const identity = await identityClient().exchange(
          code,
          oauthData,
          browserRedirectUri(),
        );
        const user = await upsertUser({
          sub: identity.subject,
          username: identity.username,
          is_admin: identity.roles.has("admin"),
        });
        const sessionId = await createSession(user.id, identity.expiresAt);

        log.set({
          auth: {
            userId: user.id,
            username: user.username,
            authSubject: identity.subject,
          },
        });
        log.emit();

        const headers = new Headers();
        headers.append("Set-Cookie", clearOauthCookie("artbin_oauth"));
        headers.append("Set-Cookie", getSessionCookie(sessionId));
        return redirectWithHeaders(routes.folders.href(), headers);
      } catch (error) {
        log.error(error instanceof Error ? error : new Error(String(error)), {
          step: "oauth-callback",
        });
        log.emit();
        return terminalLoginError("oauth_failed", "artbin_oauth");
      }
    },

    async cliAuthorize(context) {
      const cliPort = parseCliPort(context.url.searchParams.get("port"));
      if (!cliPort)
        return new Response("Invalid or missing port parameter", {
          status: 400,
        });

      const transaction = createLoginTransaction();
      return redirectWithHeaders(
        await identityClient().authorizationUrl(
          transaction,
          getCliRedirectUri(),
        ),
        {
          "Set-Cookie": oauthCookie(
            "artbin_cli_oauth",
            JSON.stringify({ ...transaction, cliPort }),
            600,
          ),
        },
      );
    },

    async cliCallback(context) {
      const log = createRequestLogger();
      const code = context.url.searchParams.get("code");
      const state = context.url.searchParams.get("state");
      const oauthError = context.url.searchParams.get("error");
      const oauthData = readOauthCookie<LoginTransaction & { cliPort: number }>(
        context.request,
        "artbin_cli_oauth",
      );
      if (!oauthData || !parseCliPort(String(oauthData.cliPort))) {
        return terminalCliError("Missing or invalid OAuth state");
      }
      if (!validLoginTransaction(oauthData, state))
        return terminalCliError("State mismatch");
      if (oauthError) return terminalCliError(`OAuth error: ${oauthError}`);
      if (!code) return terminalCliError("Missing code or state");

      try {
        const identity = await identityClient().exchange(
          code,
          oauthData,
          getCliRedirectUri(),
        );
        const user = await upsertUser({
          sub: identity.subject,
          username: identity.username,
          is_admin: identity.roles.has("admin"),
        });
        const handoffCode = nanoid(48);
        await db.insert(cliLoginHandoffs).values({
          code: handoffCode,
          userId: user.id,
          sessionExpiresAt: new Date(identity.expiresAt * 1000),
          expiresAt: new Date(Date.now() + CLI_HANDOFF_MAX_AGE_MS),
        });

        log.set({
          auth: {
            channel: "cli",
            userId: user.id,
            username: user.username,
            authSubject: identity.subject,
          },
        });
        log.emit();

        return redirectWithHeaders(
          `http://127.0.0.1:${oauthData.cliPort}/callback?code=${encodeURIComponent(handoffCode)}`,
          { "Set-Cookie": clearOauthCookie("artbin_cli_oauth") },
        );
      } catch (error) {
        log.error(error instanceof Error ? error : new Error(String(error)), {
          step: "oauth-callback",
          channel: "cli",
        });
        log.emit();
        return terminalCliError("OAuth callback failed", 500);
      }
    },

    async cliRedeem(context) {
      let body: unknown;
      try {
        body = await context.request.json();
      } catch {
        return jsonError(
          "invalid_request",
          "A JSON body containing a code is required",
          400,
        );
      }
      const code =
        body &&
        typeof body === "object" &&
        typeof (body as { code?: unknown }).code === "string"
          ? (body as { code: string }).code
          : null;
      if (!code)
        return jsonError("invalid_request", "A handoff code is required", 400);

      const handoff = db
        .delete(cliLoginHandoffs)
        .where(
          and(
            eq(cliLoginHandoffs.code, code),
            gt(cliLoginHandoffs.expiresAt, new Date()),
            gt(cliLoginHandoffs.sessionExpiresAt, new Date()),
          ),
        )
        .returning({
          userId: cliLoginHandoffs.userId,
          sessionExpiresAt: cliLoginHandoffs.sessionExpiresAt,
        })
        .get();
      if (!handoff) {
        return jsonError(
          "invalid_grant",
          "Handoff code is invalid, expired, or already used",
          400,
        );
      }

      const sessionId = await createSession(
        handoff.userId,
        Math.floor(handoff.sessionExpiresAt.getTime() / 1000),
      );
      return Response.json(
        { session: sessionId },
        { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
      );
    },
  },
});

async function upsertUser(userinfo: {
  sub: string;
  username: string;
  is_admin: boolean;
}): Promise<User> {
  let user = await db.query.users.findFirst({
    where: eq(users.authSubject, userinfo.sub),
  });

  if (!user) {
    const [created] = await db
      .insert(users)
      .values({
        id: nanoid(),
        username: userinfo.username,
        authSubject: userinfo.sub,
        isAdmin: userinfo.is_admin,
      })
      .returning();
    if (!created) throw new Error("Failed to create the local user");
    return created;
  }

  if (
    user.username !== userinfo.username ||
    user.isAdmin !== userinfo.is_admin
  ) {
    const [updated] = await db
      .update(users)
      .set({ username: userinfo.username, isAdmin: userinfo.is_admin })
      .where(eq(users.id, user.id))
      .returning();
    if (updated) user = updated;
  }

  return user;
}

async function createSession(
  userId: string,
  identityExpiresAt: number,
): Promise<string> {
  if (identityExpiresAt <= Date.now() / 1000)
    throw new Error("Sign-in expired; try again");
  const sessionId = nanoid(32);
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt: new Date(
      Math.min(identityExpiresAt * 1000, Date.now() + SESSION_MAX_AGE * 1_000),
    ),
  });
  return sessionId;
}

function oauthCookie(name: string, value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clearOauthCookie(name: string): string {
  return oauthCookie(name, "", 0);
}

function readOauthCookie<value>(request: Request, name: string): value | null {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1]!)) as value;
  } catch {
    return null;
  }
}

function redirectWithHeaders(
  href: string,
  headersInit?: HeadersInit,
  status = 302,
): Response {
  const headers = new Headers(headersInit);
  headers.set("Location", href);
  return new Response(null, { status, headers });
}

function terminalLoginError(code: string, cookieName: string): Response {
  return redirectWithHeaders(
    `${routes.login.href()}?error=${encodeURIComponent(code)}`,
    {
      "Set-Cookie": clearOauthCookie(cookieName),
    },
  );
}

function terminalCliError(message: string, status = 400): Response {
  return new Response(message, {
    status,
    headers: { "Set-Cookie": clearOauthCookie("artbin_cli_oauth") },
  });
}

function jsonError(code: string, message: string, status: number): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function parseCliPort(value: string | null): number | null {
  if (!value || !/^\d{1,5}$/.test(value)) return null;
  const port = Number(value);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535
    ? port
    : null;
}
