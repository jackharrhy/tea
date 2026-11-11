import { eq, and, inArray } from "drizzle-orm";
import type { Db } from "./db";
import { schema } from "./db";
import { hashToken } from "./services/api-tokens";

type SessionData = { userId: number; expiry: number };

export function createSession(
  db: Db,
  userId: number,
  centralExpiresAt?: number,
): string {
  const token = crypto.randomUUID();
  const expiry = Math.min(
    Date.now() + 24 * 60 * 60 * 1000,
    centralExpiresAt ? centralExpiresAt * 1000 : Infinity,
  );
  db.insert(schema.sessions)
    .values({
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(expiry).toISOString(),
    })
    .run();
  return token;
}

export function destroySession(db: Db, token: string) {
  db.delete(schema.sessions)
    .where(eq(schema.sessions.tokenHash, hashToken(token)))
    .run();
}

function getValidSession(db: Db, token: string): SessionData | null {
  const session = db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.tokenHash, hashToken(token)))
    .get();
  if (!session) return null;
  const expiry = Date.parse(session.expiresAt);
  if (Date.now() > expiry) {
    destroySession(db, token);
    return null;
  }
  return { userId: session.userId, expiry };
}

export function getSessionUser(db: Db, token: string | undefined) {
  const session = token ? getValidSession(db, token) : null;
  return session
    ? (db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, session.userId))
        .get() ?? null)
    : null;
}

export function canAccessList(
  db: Db,
  user: { id: number; role: string },
  listId: number,
): boolean {
  if (user.role === "owner" || user.role === "admin") return true;
  const access = db
    .select()
    .from(schema.userLists)
    .where(
      and(
        eq(schema.userLists.userId, user.id),
        eq(schema.userLists.listId, listId),
      ),
    )
    .get();

  return Boolean(access);
}

export function getAccessibleListIds(
  db: Db,
  user: { id: number; role: string },
): "all" | number[] {
  if (user.role === "owner" || user.role === "admin") return "all";

  const rows = db
    .select({ listId: schema.userLists.listId })
    .from(schema.userLists)
    .where(eq(schema.userLists.userId, user.id))
    .all();

  return rows.map((r) => r.listId);
}

export function getAccessibleLists(db: Db, user: { id: number; role: string }) {
  const listIds = getAccessibleListIds(db, user);
  if (listIds === "all") return db.select().from(schema.lists).all();
  if (listIds.length === 0) return [];
  return db
    .select()
    .from(schema.lists)
    .where(inArray(schema.lists.id, listIds))
    .all();
}
