import { randomBytes } from "node:crypto";
import type { Database } from "bun:sqlite";

export const SESSION_COOKIE_NAME = "burger_session";
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export type Session = {
  id: string;
  userId: string;
  expiresAt: number;
};

export const createSession = (db: Database, userId: string): string => {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  db.run("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", [
    id,
    userId,
    expiresAt,
  ]);
  return id;
};

export const getSession = (db: Database, id: string): Session | null => {
  const row = db
    .query("SELECT id, user_id, expires_at FROM sessions WHERE id = ?")
    .get(id) as { id: string; user_id: string; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.run("DELETE FROM sessions WHERE id = ?", [id]);
    return null;
  }
  return { id: row.id, userId: row.user_id, expiresAt: row.expires_at };
};

export const deleteSession = (db: Database, id: string): void => {
  db.run("DELETE FROM sessions WHERE id = ?", [id]);
};

export const parseSessionCookie = (
  cookieHeader: string | null | undefined,
): string | undefined => {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`),
  );
  return match?.[1];
};

export const getSessionCookie = (id: string, secure: boolean): string => {
  const secureFlag = secure ? "; Secure" : "";
  const maxAgeSec = Math.floor(SESSION_MAX_AGE_MS / 1000);
  return `${SESSION_COOKIE_NAME}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secureFlag}`;
};

export const getClearSessionCookie = (secure: boolean): string => {
  const secureFlag = secure ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
};
