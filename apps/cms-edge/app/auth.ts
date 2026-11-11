import type { Bindings } from "./types.ts";
import {
  createIdentityClient,
  createLoginTransaction,
  IdentityError,
  validLoginTransaction,
  type IdentityConfig,
  type LoginTransaction,
} from "@harrhy/identity";

const encoder = new TextEncoder();
const cookieName = "tea_edge_session";

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function digest(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++)
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

async function signature(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export function centralAuth(
  env: Bindings,
): { config: IdentityConfig; origin: string; ownerSubject: string } | null {
  if (!env.TEA_AUTH_ISSUER) return null;
  const origin = env.TEA_EDITOR_ORIGIN;
  if (
    !env.TEA_AUTH_CLIENT_ID ||
    !env.TEA_AUTH_PROJECT_ID ||
    !env.TEA_AUTH_ORGANIZATION_ID ||
    !env.TEA_AUTH_OWNER_SUBJECT ||
    !origin ||
    new URL(origin).origin !== origin
  )
    throw new Error("CMS Edge Central Auth is incomplete");
  return {
    config: {
      issuer: env.TEA_AUTH_ISSUER,
      clientId: env.TEA_AUTH_CLIENT_ID,
      projectId: env.TEA_AUTH_PROJECT_ID,
      organizationId: env.TEA_AUTH_ORGANIZATION_ID,
    },
    origin,
    ownerSubject: env.TEA_AUTH_OWNER_SUBJECT,
  };
}

export function requireSecrets(
  env: Bindings,
  passwordLogin = true,
  signedSession = true,
  previewSecret = true,
) {
  if (
    (previewSecret && !env.TEA_PREVIEW_SECRET) ||
    (signedSession && !env.TEA_SESSION_SECRET) ||
    (passwordLogin && !env.TEA_ADMIN_PASSWORD)
  )
    throw new Error(
      "CMS Edge authentication and preview secrets are incomplete.",
    );
}

const transactionName = "tea_edge_oauth";
const transactionCookie = (value: string, secure: boolean, maxAge: number) =>
  `${transactionName}=${value}; Path=/tea; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;

export async function beginCentralLogin(request: Request, env: Bindings) {
  const central = centralAuth(env);
  if (!central) return new Response("Not found", { status: 404 });
  if (new URL(request.url).origin !== central.origin)
    return new Response("Wrong editor origin", { status: 403 });
  const transaction = createLoginTransaction();
  const target = await createIdentityClient(central.config).authorizationUrl(
    transaction,
    `${central.origin}/tea/auth/callback`,
  );
  const encoded = btoa(JSON.stringify(transaction))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return new Response(null, {
    status: 303,
    headers: {
      Location: target,
      "Set-Cookie": transactionCookie(
        encoded,
        central.origin.startsWith("https:"),
        600,
      ),
      "Cache-Control": "no-store",
    },
  });
}

export async function finishCentralLogin(request: Request, env: Bindings) {
  const central = centralAuth(env);
  if (!central) return new Response("Not found", { status: 404 });
  if (new URL(request.url).origin !== central.origin)
    return new Response("Wrong editor origin", { status: 403 });
  const secure = central.origin.startsWith("https:");
  const cleared = transactionCookie("", secure, 0);
  const encoded =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${transactionName}=`))
      ?.slice(transactionName.length + 1) ?? "";
  let transaction: LoginTransaction | null = null;
  if (encoded && encoded.length < 4096) {
    try {
      transaction = JSON.parse(
        atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
      );
    } catch {
      transaction = null;
    }
  }
  const params = new URL(request.url).searchParams;
  if (
    !transaction ||
    !validLoginTransaction(transaction, params.get("state")) ||
    !params.get("code")
  )
    return new Response("Invalid sign-in transaction", {
      status: 400,
      headers: { "Set-Cookie": cleared },
    });
  try {
    const profile = await createIdentityClient(central.config).exchange(
      params.get("code")!,
      transaction,
      `${central.origin}/tea/auth/callback`,
    );
    if (profile.subject !== central.ownerSubject || !profile.roles.has("admin"))
      return new Response("Editor access is not assigned", {
        status: 403,
        headers: { "Set-Cookie": cleared },
      });
    const session = await centralSessionCookie(request, env, profile.subject);
    const headers = new Headers({
      Location: "/tea",
      "Cache-Control": "no-store",
      "Set-Cookie": cleared,
    });
    headers.append("Set-Cookie", session);
    return new Response(null, { status: 303, headers });
  } catch (error) {
    return new Response("Sign-in could not be completed", {
      status: error instanceof IdentityError ? error.status : 503,
      headers: { "Set-Cookie": cleared },
    });
  }
}

export async function passwordMatches(input: string, env: Bindings) {
  return equal(await digest(input), await digest(env.TEA_ADMIN_PASSWORD));
}

export async function sessionCookie(request: Request, env: Bindings) {
  const expiry = String(Date.now() + 12 * 60 * 60 * 1000);
  const value = `${expiry}.${await signature(expiry, env.TEA_SESSION_SECRET)}`;
  const secure =
    env.TEA_EDITOR_ORIGIN?.startsWith("https://") ||
    new URL(request.url).protocol === "https:";
  return `${cookieName}=${value}; Path=/tea; HttpOnly; SameSite=Strict; Max-Age=43200${secure ? "; Secure" : ""}`;
}

export async function centralSessionCookie(
  request: Request,
  env: Bindings,
  subject: string,
) {
  const expiry = String(Date.now() + 60 * 60_000);
  const identity = btoa(subject)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const value = `v2.${identity}.${expiry}`;
  const signatureValue = await signature(value, env.TEA_SESSION_SECRET);
  const secure =
    env.TEA_EDITOR_ORIGIN?.startsWith("https://") ||
    new URL(request.url).protocol === "https:";
  return `${cookieName}=${value}.${signatureValue}; Path=/tea; HttpOnly; SameSite=Lax; Max-Age=3600${secure ? "; Secure" : ""}`;
}

export async function isEditor(request: Request, env: Bindings) {
  const cookies = request.headers.get("cookie") ?? "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
  if (!match) return false;
  const central = centralAuth(env);
  if (central) {
    const [version, encoded, expiry, mac, extra] = match[1].split(".");
    if (
      version !== "v2" ||
      !encoded ||
      !expiry ||
      !mac ||
      extra ||
      !/^\d+$/.test(expiry) ||
      Number(expiry) <= Date.now()
    )
      return false;
    let subject: string;
    try {
      subject = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    } catch {
      return false;
    }
    if (subject !== central.ownerSubject) return false;
    return equal(
      mac,
      await signature(`v2.${encoded}.${expiry}`, env.TEA_SESSION_SECRET),
    );
  }
  const [expiry, mac] = match[1].split(".");
  return (
    !!expiry &&
    !!mac &&
    Number(expiry) > Date.now() &&
    equal(mac, await signature(expiry, env.TEA_SESSION_SECRET))
  );
}

export function clearedSessionCookie() {
  return `${cookieName}=; Path=/tea; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function sameOrigin(request: Request, env: Bindings) {
  const origin = request.headers.get("origin");
  return (
    !!origin &&
    (origin === new URL(request.url).origin || origin === env.TEA_EDITOR_ORIGIN)
  );
}

export function previewAllowed(request: Request, env: Bindings) {
  return (
    request.headers.get("authorization") === `Bearer ${env.TEA_PREVIEW_SECRET}`
  );
}
