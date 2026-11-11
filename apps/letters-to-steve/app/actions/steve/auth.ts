import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { IdentityConfig } from "@tea/identity";
import type { SqliteDatabase } from "remix/data-table/sqlite";

import { steveSessions } from "../../data/schema.ts";

export type SteveAccess = "authorized" | "unauthorized" | "unconfigured";

export function centralAuthConfig(): {
  identity: IdentityConfig;
  origin: string;
  ownerSubject: string;
} | null {
  const issuer = process.env.AUTH_ISSUER;
  if (!issuer) return null;
  const clientId = process.env.AUTH_CLIENT_ID;
  const projectId = process.env.AUTH_PROJECT_ID;
  const organizationId = process.env.AUTH_ORGANIZATION_ID;
  const origin = process.env.AUTH_PUBLIC_ORIGIN;
  const ownerSubject = process.env.AUTH_OWNER_SUBJECT;
  if (!clientId || !projectId || !organizationId || !origin || !ownerSubject)
    throw new Error("Central authentication is incomplete");
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid public origin");
  return {
    identity: { issuer, clientId, projectId, organizationId },
    origin: url.origin,
    ownerSubject,
  };
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionCookie(token: string, maxAge: number): string {
  return `steve_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function cookieToken(request: Request): string | null {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("steve_session="))
    ?.slice("steve_session=".length);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export async function createSteveSession(
  database: SqliteDatabase,
  subject: string,
  expiresAt: number,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await database.create(steveSessions, {
    token_hash: tokenHash(token),
    subject,
    expires_at: Math.min(expiresAt * 1000, Date.now() + 3600000),
  });
  return token;
}

export async function destroySteveSession(
  database: SqliteDatabase,
  request: Request,
): Promise<void> {
  const token = cookieToken(request);
  if (token)
    await database.deleteMany(steveSessions, {
      where: { token_hash: tokenHash(token) },
    });
}

export async function getSteveAccess(
  request: Request,
  database: SqliteDatabase,
): Promise<SteveAccess> {
  const central = centralAuthConfig();
  if (central) {
    const token = cookieToken(request);
    if (!token) return "unauthorized";
    const session = await database.findOne(steveSessions, {
      where: { token_hash: tokenHash(token) },
    });
    return session?.subject === central.ownerSubject &&
      session.expires_at > Date.now()
      ? "authorized"
      : "unauthorized";
  }

  const expectedPassword = process.env.STEVE_ADMIN_PASSWORD;
  if (!expectedPassword) return "unconfigured";
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) return "unauthorized";
  let decoded: string;
  try {
    decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  } catch {
    return "unauthorized";
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return "unauthorized";
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  const actualBytes = Buffer.from(password);
  const expectedBytes = Buffer.from(expectedPassword);
  return username === "steve" &&
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
    ? "authorized"
    : "unauthorized";
}

export function challengeSteve(): Response {
  if (centralAuthConfig()) {
    return new Response(null, {
      status: 303,
      headers: { Location: "/auth/login", "Cache-Control": "no-store" },
    });
  }
  return new Response("Steve only.", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'Basic realm="Letters to Steve", charset="UTF-8"',
    },
  });
}
