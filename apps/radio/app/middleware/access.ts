import { createContextKey, type Middleware } from "remix/router";
import { redirect } from "remix/response/redirect";
import { Session } from "remix/session";
import { createCookieSessionStorage } from "remix/session-storage/cookie";
import { session } from "remix/middleware/session";

import { routes } from "../routes.ts";
import { RadioSessionCookie } from "./session-cookie.ts";

export type RadioIdentity = {
  name: string;
  authenticatedAt: number;
};

export type RadioAccessConfig = {
  password: string;
  sessionSecret: string;
  secureCookies: boolean;
};

export const RadioAccess = createContextKey<RadioIdentity | null>();
export const AccessConfig = createContextKey<RadioAccessConfig>();

export function radioSession(config: RadioAccessConfig) {
  requireConfig(config);
  let cookie = new RadioSessionCookie("radio_session", config.sessionSecret, {
    httpOnly: true,
    sameSite: "Lax",
    secure: config.secureCookies,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return session(cookie, createCookieSessionStorage());
}

export function access(config: RadioAccessConfig): Middleware {
  return (context, next) => {
    context.set(AccessConfig, config);
    let currentSession = context.get(Session)!;
    let authenticated = currentSession.get("authenticated") === true;
    let name = currentSession.get("name");
    let authenticatedAt = currentSession.get("authenticatedAt");
    context.set(
      RadioAccess,
      authenticated &&
        typeof name === "string" &&
        typeof authenticatedAt === "number"
        ? { name, authenticatedAt }
        : null,
    );
    return next();
  };
}

export function requirePageAccess(): Middleware {
  return (context, next) => {
    if (context.get(RadioAccess)) return next();
    let roomSlug = context.params.roomSlug;
    let href = routes.home.href();
    if (roomSlug) href += `?room=${encodeURIComponent(roomSlug)}`;
    return redirect(href, 303);
  };
}

export function requireResourceAccess(): Middleware {
  return (context, next) =>
    context.get(RadioAccess)
      ? next()
      : new Response("Unauthorized", { status: 401 });
}

export async function passwordMatches(
  actual: string,
  expected: string,
): Promise<boolean> {
  let encoder = new TextEncoder();
  let [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  let left = new Uint8Array(actualHash);
  let right = new Uint8Array(expectedHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index++)
    difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

function requireConfig(config: RadioAccessConfig): void {
  if (!config.password) throw new Error("RADIO_PASSWORD is required");
  if (config.sessionSecret.length < 32) {
    throw new Error("RADIO_SESSION_SECRET must contain at least 32 characters");
  }
}
