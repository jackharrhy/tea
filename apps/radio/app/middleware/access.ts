import { createContextKey, type Middleware } from "remix/router";
import { redirect } from "remix/response/redirect";
import { Session } from "remix/session";
import { createCookieSessionStorage } from "remix/session-storage/cookie";
import { session } from "remix/middleware/session";

import { routes } from "../routes.ts";
import { RadioSessionCookie } from "./session-cookie.ts";
import type { IdentityConfig } from "@harrhy/identity";

export type RadioIdentity = {
  name: string;
  authenticatedAt: number;
  subject: string;
  expiresAt: number;
};

export type RadioAccessConfig = {
  sessionSecret: string;
  secureCookies: boolean;
  identity: IdentityConfig;
  publicOrigin: string;
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
    let subject = currentSession.get("subject");
    let expiresAt = currentSession.get("expiresAt");
    context.set(
      RadioAccess,
      authenticated &&
        typeof name === "string" &&
        typeof authenticatedAt === "number" &&
        typeof subject === "string" &&
        subject.length > 0 &&
        typeof expiresAt === "number" &&
        expiresAt > Date.now()
        ? {
            name,
            authenticatedAt,
            subject,
            expiresAt,
          }
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

function requireConfig(config: RadioAccessConfig): void {
  if (
    new URL(config.publicOrigin).protocol !== "https:" ||
    new URL(config.publicOrigin).origin !== config.publicOrigin
  )
    throw new Error("AUTH_PUBLIC_ORIGIN must be an HTTPS origin");
  if (config.sessionSecret.length < 32) {
    throw new Error("RADIO_SESSION_SECRET must contain at least 32 characters");
  }
}
