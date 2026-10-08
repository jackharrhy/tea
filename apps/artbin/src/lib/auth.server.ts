import { db } from "#db/connection.server";
import { users, sessions } from "#db";
import { eq } from "drizzle-orm";

const SESSION_COOKIE = "artbin_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const isProduction = process.env.NODE_ENV === "production";
const secureSuffix = isProduction ? "; Secure" : "";

const DEVELOPMENT_USER = {
  id: "local-development-user",
  username: "local",
  fourmId: "local-development",
  isAdmin: true,
} as const;

export function isDevelopmentAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.ARTBIN_REQUIRE_AUTH !== "1"
  );
}

async function getDevelopmentUser() {
  const [user] = await db
    .insert(users)
    .values(DEVELOPMENT_USER)
    .onConflictDoUpdate({
      target: users.id,
      set: { isAdmin: true },
    })
    .returning();

  if (!user) throw new Error("Failed to provision the local development user");
  return user;
}

export async function logout(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function getSession(sessionId: string | undefined) {
  if (!sessionId) return null;

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });

  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  return session;
}

export async function getUserFromSession(sessionId: string | undefined) {
  const session = await getSession(sessionId);
  if (!session) return null;

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  return user;
}

export async function getUserFromRequest(request: Request) {
  if (isDevelopmentAuthEnabled()) {
    return getDevelopmentUser();
  }

  const sessionId = parseSessionCookie(request.headers.get("Cookie"));
  return (await getUserFromSession(sessionId)) ?? null;
}

export function getSessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secureSuffix}`;
}

export function getClearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureSuffix}`;
}

export function parseSessionCookie(
  cookieHeader: string | null,
): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match?.[1];
}
