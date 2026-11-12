import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  createIdentityClient,
  projectAudienceScope,
  PROJECT_ROLES_SCOPE,
  type ActedAccessToken,
  type TokenPrincipal,
} from "@harrhy/identity";
import { readRequestBody } from "@harrhy/request-body";

import type { User } from "#db";
import { db } from "#db/connection.server";
import { users } from "#db";
import { eq } from "drizzle-orm";

import { identityConfig } from "./oauth.server.ts";

const STATE_COOKIE = "artbin_support_state";
const SESSION_COOKIE = "artbin_support";
const START_TTL_MS = 120_000;
const SESSION_TTL_MS = 600_000;
const AUTH_TIMEOUT_MS = 5_000;
const MAX_JSON_BYTES = 16_384;
const opaquePattern = /^[A-Za-z0-9_-]{32,128}$/;
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export interface SupportIdentity {
  readonly actorSubject: string;
  readonly targetSubject: string;
  readonly targetUsername: string;
  readonly role: "member" | "admin";
  readonly csrfToken: string;
}

export type SupportUser = User & { readonly support?: SupportIdentity };

interface Transaction {
  readonly verifier: string;
  readonly nonce: string;
  readonly expiresAt: number;
}

interface SupportSession {
  readonly token: string;
  readonly supportId: string;
  readonly endSecret: string;
  readonly actorSubject: string;
  readonly targetSubject: string;
  readonly targetUserId: string;
  readonly role: "member" | "admin";
  readonly csrfToken: string;
  readonly expiresAt: number;
}

interface SupportConfig {
  readonly issuer: string;
  readonly supportOrigin: string;
  readonly publicOrigin: string;
  readonly clientId: string;
  readonly transportSecret: string;
  readonly resourceClientId: string;
  readonly resourceSecret: string;
}

const pending = new Map<string, Transaction>();
const sessions = new Map<string, SupportSession>();
const resolution = new WeakMap<Request, Promise<SupportUser | null>>();

const random = () => randomBytes(32).toString("base64url");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function serviceOrigin(input: string): string | null {
  try {
    const url = new URL(input);
    const localHttp =
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      (url.protocol !== "https:" && !localHttp) ||
      (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

function supportConfig(): SupportConfig | null {
  if (process.env.ARTBIN_SUPPORT_LOGIN_ENABLED !== "1") return null;
  const identity = identityConfig();
  const publicOrigin = serviceOrigin(process.env.ARTBIN_URL ?? "");
  const supportOrigin = serviceOrigin(process.env.AUTH_SUPPORT_ORIGIN ?? "");
  const clientId = process.env.AUTH_SUPPORT_CLIENT_ID ?? "";
  const transportSecret = process.env.AUTH_SUPPORT_TRANSPORT_SECRET ?? "";
  const resourceClientId = process.env.AUTH_INTROSPECTION_CLIENT_ID ?? "";
  const resourceSecret = process.env.AUTH_INTROSPECTION_SECRET ?? "";
  if (
    !clientId ||
    !transportSecret ||
    !resourceClientId ||
    !resourceSecret ||
    !identity.clientId ||
    !identity.projectId ||
    !identity.organizationId ||
    !publicOrigin ||
    !supportOrigin ||
    (process.env.NODE_ENV === "production" &&
      !identity.issuer.startsWith("https://"))
  )
    throw new Response("Support login unavailable", { status: 503 });
  return {
    issuer: identity.issuer,
    supportOrigin,
    publicOrigin,
    clientId,
    transportSecret,
    resourceClientId,
    resourceSecret,
  };
}

function pruneExpired() {
  const now = Date.now();
  for (const [key, transaction] of pending)
    if (transaction.expiresAt <= now) pending.delete(key);
  for (const [key, session] of sessions)
    if (session.expiresAt <= now) sessions.delete(key);
}

function cookie(request: Request, name: string): string | null {
  const entry = request.headers
    .get("Cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return entry?.slice(name.length + 1) ?? null;
}

function supportCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function stateCookie(value: string, maxAge: number): string {
  return `${STATE_COOKIE}=${value}; Path=/auth/support; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function basic(config: SupportConfig): string {
  return `Basic ${Buffer.from(`${encodeURIComponent("artbin")}:${encodeURIComponent(config.transportSecret)}`).toString("base64")}`;
}

async function authPost(
  config: SupportConfig,
  path: "/support/redeem" | "/support/session" | "/support/end",
  body: Record<string, string>,
): Promise<Response> {
  return fetch(`${config.supportOrigin}${path}`, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    headers: {
      Authorization: basic(config),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function responseJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const value = await response.text();
  if (value.length > MAX_JSON_BYTES)
    throw new Error("Support response too large");
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid support response");
  return parsed as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const entry = record[key];
  if (typeof entry !== "string" || !entry || entry.length > 32_768)
    throw new Error("Invalid support response");
  return entry;
}

function supportRecord(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const support = input.support;
  if (!support || typeof support !== "object" || Array.isArray(support))
    throw new Error("Invalid support response");
  return support as Record<string, unknown>;
}

function browserRole(
  jwt: ActedAccessToken,
  introspection: TokenPrincipal,
  local: User,
): "member" | "admin" {
  const required = [
    "openid",
    "profile",
    projectAudienceScope(identityConfig().projectId),
    PROJECT_ROLES_SCOPE,
  ];
  if (
    required.some((scope) => !introspection.scopes.has(scope)) ||
    jwt.subject !== introspection.subject ||
    jwt.actor.subject !== introspection.actor?.subject ||
    jwt.actor.issuer !== introspection.actor.issuer ||
    introspection.principalType !== "user" ||
    jwt.expiresAt > introspection.expiresAt + 5
  )
    throw new Error("Support token claims do not match");
  if (jwt.roles.has("admin") && introspection.roles.has("admin")) {
    if (!local.isAdmin)
      throw new Error("Local administrator access is missing");
    return "admin";
  }
  if (jwt.roles.has("member") && introspection.roles.has("member"))
    return "member";
  throw new Error("Target application role is missing");
}

async function targetUser(subject: string): Promise<User | null> {
  return (
    (await db.query.users.findFirst({
      where: eq(users.authSubject, subject),
    })) ?? null
  );
}

export async function supportTargetEligibility(
  request: Request,
): Promise<Response> {
  const settings = supportConfig();
  if (!settings) return new Response("Not Found", { status: 404 });
  const headers = { "Cache-Control": "no-store" };
  const authorization = request.headers.get("Authorization") ?? "";
  if (!sameSecret(authorization, basic(settings)))
    return new Response("Unauthorized", { status: 401, headers });
  if (
    request.headers.get("Content-Type")?.split(";", 1)[0] !== "application/json"
  )
    return new Response("Invalid support target", { status: 400, headers });
  const body = await readRequestBody(request, {
    maxBytes: 1024,
    timeoutMs: 2_000,
  });
  if (!body.ok)
    return new Response("Invalid support target", { status: 400, headers });
  let input: unknown;
  try {
    input = JSON.parse(Buffer.from(body.bytes).toString("utf8"));
  } catch {
    return new Response("Invalid support target", { status: 400, headers });
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !("targetSubject" in input) ||
    typeof input.targetSubject !== "string" ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(input.targetSubject)
  )
    return new Response("Invalid support target", { status: 400, headers });
  const linked = Boolean(await targetUser(input.targetSubject));
  return Response.json({ linked }, { headers });
}

function supportSessionAllowedPath(pathname: string): boolean {
  return (
    !pathname.startsWith("/api/cli/") &&
    !pathname.startsWith("/api/assets") &&
    !pathname.startsWith("/api/asset/") &&
    pathname !== "/mcp" &&
    !pathname.startsWith("/.well-known/oauth-protected-resource/")
  );
}

export function hasSupportCookie(request: Request): boolean {
  return cookie(request, SESSION_COOKIE) !== null;
}

export async function beginSupportLogin(request: Request): Promise<Response> {
  const settings = supportConfig();
  if (!settings) return new Response("Not Found", { status: 404 });
  pruneExpired();
  if (pending.size >= 1_000 || sessions.size >= 1_000)
    return new Response("Support login busy", { status: 503 });
  const requestRef = new URL(request.url).searchParams.get("request");
  if (!requestRef || !opaquePattern.test(requestRef))
    return new Response("Invalid support request", { status: 400 });
  const state = random();
  const verifier = randomBytes(48).toString("base64url");
  const nonce = random();
  pending.set(digest(state), {
    verifier,
    nonce,
    expiresAt: Date.now() + START_TTL_MS,
  });
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL(`${settings.supportOrigin}/support/handoff`);
  url.search = new URLSearchParams({
    request: requestRef,
    consumer_id: "artbin",
    redirect_uri: `${settings.publicOrigin}/auth/support/callback`,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return new Response(null, {
    status: 303,
    headers: {
      Location: url.href,
      "Set-Cookie": stateCookie(state, START_TTL_MS / 1000),
      "Cache-Control": "no-store",
    },
  });
}

export async function completeSupportLogin(
  request: Request,
): Promise<Response> {
  const settings = supportConfig();
  if (!settings) return new Response("Not Found", { status: 404 });
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const cookieState = cookie(request, STATE_COOKIE);
  const headers = new Headers({
    "Set-Cookie": stateCookie("", 0),
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  if (!state || !cookieState || state !== cookieState)
    return new Response("Invalid support callback", { status: 400, headers });
  const transaction = pending.get(digest(state));
  pending.delete(digest(state));
  if (!transaction || transaction.expiresAt <= Date.now() || !code)
    return new Response("Invalid support callback", { status: 400, headers });
  let failure: "account" | "general" = "general";
  let stage = "redeem";
  let cleanup: Pick<
    SupportSession,
    "supportId" | "endSecret" | "expiresAt"
  > | null = null;
  try {
    const response = await authPost(settings, "/support/redeem", {
      code,
      code_verifier: transaction.verifier,
      redirect_uri: `${settings.publicOrigin}/auth/support/callback`,
      consumer_id: "artbin",
    });
    if (!response.ok) throw new Error("Support redemption failed");
    const redeemed = await responseJson(response);
    const support = supportRecord(redeemed);
    cleanup = {
      supportId: requiredString(support, "id"),
      endSecret: requiredString(support, "endSecret"),
      expiresAt: Date.parse(requiredString(support, "expiresAt")),
    };
    const token = requiredString(redeemed, "access_token");
    if (redeemed.token_type !== "Bearer")
      throw new Error("Invalid support token type");
    stage = "signed-token";
    const proof =
      await createIdentityClient(identityConfig()).verifyActedAccessToken(
        token,
      );
    stage = "introspection";
    const principal = await createIdentityClient(identityConfig()).introspect(
      token,
      {
        clientId: settings.resourceClientId,
        clientSecret: settings.resourceSecret,
      },
    );
    const actorSubject = requiredString(support, "actorSubject");
    const targetSubject = requiredString(support, "targetSubject");
    stage = "identity";
    if (
      support.nonce !== transaction.nonce ||
      proof.actor.subject !== actorSubject ||
      proof.subject !== targetSubject ||
      principal.actor?.subject !== actorSubject ||
      principal.actor.issuer !== settings.issuer ||
      principal.subject !== targetSubject ||
      principal.clientId !== settings.clientId
    )
      throw new Error("Support identity mismatch");
    stage = "local-target";
    const local = await targetUser(targetSubject);
    if (!local) {
      failure = "account";
      throw new Error("Target user is not linked in Artbin");
    }
    stage = "role";
    const role = browserRole(proof, principal, local);
    stage = "expiry";
    const expiresAt = Date.parse(requiredString(support, "expiresAt"));
    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() ||
      expiresAt > Date.now() + SESSION_TTL_MS ||
      expiresAt > proof.expiresAt * 1000 ||
      expiresAt > principal.expiresAt * 1000
    )
      throw new Error("Support expiry is invalid");
    stage = "session";
    const sessionId = random();
    sessions.set(digest(sessionId), {
      token,
      supportId: cleanup.supportId,
      endSecret: cleanup.endSecret,
      actorSubject,
      targetSubject,
      targetUserId: local.id,
      role,
      csrfToken: random(),
      expiresAt,
    });
    headers.append(
      "Set-Cookie",
      supportCookie(
        SESSION_COOKIE,
        sessionId,
        Math.ceil((expiresAt - Date.now()) / 1000),
      ),
    );
    headers.set("Location", "/folders");
    return new Response(null, { status: 303, headers });
  } catch {
    let cleanupOutcome = "not-issued";
    if (cleanup) {
      try {
        await endRemote(settings, cleanup);
        cleanupOutcome = "ended";
      } catch {
        cleanupOutcome = "pending";
        if (Number.isFinite(cleanup.expiresAt)) retryEnd(settings, cleanup);
      }
    }
    console.warn(
      JSON.stringify({
        event: "artbin_support_callback_failed",
        stage,
        cleanupOutcome,
      }),
    );
    headers.set("Location", `/auth/support/problem?reason=${failure}`);
    return new Response(null, { status: 303, headers });
  }
}

async function statusActive(settings: SupportConfig, session: SupportSession) {
  const response = await authPost(settings, "/support/session", {
    supportId: session.supportId,
    endSecret: session.endSecret,
  });
  if (!response.ok) return false;
  const status = await responseJson(response);
  return (
    status.active === true &&
    status.supportId === session.supportId &&
    status.actorSubject === session.actorSubject &&
    status.targetSubject === session.targetSubject &&
    Date.parse(String(status.expiresAt)) === session.expiresAt
  );
}

async function resolveSupportUser(
  request: Request,
): Promise<SupportUser | null> {
  const sessionId = cookie(request, SESSION_COOKIE);
  if (!sessionId) return null;
  const settings = supportConfig();
  if (!settings) throw endedSupportResponse(request);
  pruneExpired();
  if (!supportSessionAllowedPath(new URL(request.url).pathname))
    throw new Response("Support session cannot authorize this route", {
      status: 403,
    });
  const sessionKey = digest(sessionId);
  const session = sessions.get(sessionKey);
  if (!session || session.expiresAt <= Date.now())
    throw endedSupportResponse(request);
  try {
    const [active, principal] = await Promise.all([
      statusActive(settings, session),
      createIdentityClient(identityConfig()).introspect(session.token, {
        clientId: settings.resourceClientId,
        clientSecret: settings.resourceSecret,
      }),
    ]);
    if (
      !active ||
      principal.clientId !== settings.clientId ||
      principal.principalType !== "user" ||
      principal.subject !== session.targetSubject ||
      principal.actor?.subject !== session.actorSubject ||
      principal.actor.issuer !== settings.issuer ||
      principal.expiresAt * 1000 < session.expiresAt
    ) {
      sessions.delete(sessionKey);
      throw endedSupportResponse(request);
    }
    const local = await targetUser(session.targetSubject);
    if (!local || local.id !== session.targetUserId) {
      sessions.delete(sessionKey);
      throw new Response("Support target is unavailable", { status: 403 });
    }
    const role = browserRole(
      {
        subject: session.targetSubject,
        actor: { issuer: settings.issuer, subject: session.actorSubject },
        audiences: principal.audiences,
        roles: principal.roles,
        expiresAt: principal.expiresAt,
      },
      principal,
      local,
    );
    if (role !== session.role) {
      sessions.delete(sessionKey);
      throw new Response("Support target role changed", { status: 403 });
    }
    if (
      sessions.get(sessionKey) !== session ||
      session.expiresAt <= Date.now()
    ) {
      if (sessions.get(sessionKey) === session) sessions.delete(sessionKey);
      throw endedSupportResponse(request);
    }
    return {
      ...local,
      isAdmin: role === "admin" && local.isAdmin,
      support: {
        actorSubject: session.actorSubject,
        targetSubject: session.targetSubject,
        targetUsername: local.username,
        role,
        csrfToken: session.csrfToken,
      },
    };
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response("Support verification unavailable", { status: 503 });
  }
}

export function supportUserForRequest(
  request: Request,
): Promise<SupportUser | null> {
  let existing = resolution.get(request);
  if (!existing) {
    existing = resolveSupportUser(request);
    resolution.set(request, existing);
  }
  return existing;
}

function sameSecret(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function endedSupportResponse(request: Request): Response {
  if (
    request.method === "GET" &&
    request.headers.get("Accept")?.includes("text/html")
  ) {
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/auth/support/recover",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  return new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>Support session ended</title><main><h1>Support session ended</h1><p>This support session is no longer available.</p><a href="/auth/support/recover">Exit support session</a></main></html>',
    {
      status: 401,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

export function supportRecoveryToken(request: Request): string | null {
  const sessionId = cookie(request, SESSION_COOKIE);
  if (!sessionId) return null;
  return sessions.get(digest(sessionId))?.csrfToken ?? digest(sessionId);
}

async function endRemote(
  settings: SupportConfig,
  session: Pick<SupportSession, "supportId" | "endSecret">,
) {
  const response = await authPost(settings, "/support/end", {
    supportId: session.supportId,
    endSecret: session.endSecret,
  });
  if (!response.ok) throw new Error("Support end was not accepted");
  const ended = await responseJson(response);
  if (ended.active !== false) throw new Error("Support end was not accepted");
}

function retryEnd(
  settings: SupportConfig,
  session: Pick<SupportSession, "supportId" | "endSecret" | "expiresAt">,
  attempt = 0,
) {
  if (Date.now() >= session.expiresAt) return;
  const delays = [1000, 5000, 30_000, 60_000];
  const timer = setTimeout(
    async () => {
      try {
        await endRemote(settings, session);
      } catch {
        retryEnd(settings, session, attempt + 1);
      }
    },
    delays[Math.min(attempt, delays.length - 1)],
  );
  timer.unref();
}

export async function exitSupportLogin(request: Request): Promise<Response> {
  const headers = new Headers({
    Location: "/",
    "Set-Cookie": supportCookie(SESSION_COOKIE, "", 0),
    "Cache-Control": "no-store",
  });
  const origin = process.env.ARTBIN_URL;
  if (!origin) return new Response("Forbidden", { status: 403 });
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(origin).origin;
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
  if (request.headers.get("Origin") !== expectedOrigin)
    return new Response("Forbidden", { status: 403 });
  const sessionId = cookie(request, SESSION_COOKIE);
  const session = sessionId ? sessions.get(digest(sessionId)) : undefined;
  const csrf = supportRecoveryToken(request);
  if (
    request.headers.get("Content-Type")?.split(";", 1)[0] !==
    "application/x-www-form-urlencoded"
  )
    return new Response("Invalid support exit", { status: 400 });
  const body = await readRequestBody(request, {
    maxBytes: 1024,
    timeoutMs: 2_000,
  });
  if (!body.ok) return new Response("Invalid support exit", { status: 400 });
  const form = new URLSearchParams(Buffer.from(body.bytes).toString("utf8"));
  if (!csrf || !sameSecret(form.get("csrf") ?? "", csrf))
    return new Response("Forbidden", { status: 403 });
  if (sessionId) sessions.delete(digest(sessionId));
  if (session) {
    let settings: SupportConfig | null;
    try {
      settings = supportConfig();
    } catch {
      settings = null;
    }
    if (settings) {
      try {
        await endRemote(settings, session);
      } catch {
        retryEnd(settings, session);
      }
    }
  }
  return new Response(null, { status: 303, headers });
}

export function auditSupportMutation(
  request: Request,
  user: SupportUser | null,
  status: number,
): void {
  if (!user?.support || safeMethods.has(request.method)) return;
  console.info(
    JSON.stringify({
      event: "artbin_support_mutation",
      actorSubject: user.support.actorSubject,
      targetSubject: user.support.targetSubject,
      targetUserId: user.id,
      method: request.method,
      path: new URL(request.url).pathname,
      status,
    }),
  );
}
