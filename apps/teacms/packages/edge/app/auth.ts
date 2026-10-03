import type { Bindings } from "./types.ts";

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

export function requireSecrets(env: Bindings, passwordLogin = true) {
  if (
    !env.TEA_PREVIEW_SECRET ||
    (passwordLogin && (!env.TEA_ADMIN_PASSWORD || !env.TEA_SESSION_SECRET))
  )
    throw new Error(
      "TEA_ADMIN_PASSWORD, TEA_SESSION_SECRET and TEA_PREVIEW_SECRET are required.",
    );
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

export async function isEditor(request: Request, env: Bindings) {
  const cookies = request.headers.get("cookie") ?? "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
  if (!match) return false;
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
