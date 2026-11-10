import { randomBytes } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { AuthIdentity } from "./oauth";

export type User = {
  id: string;
  authSubject: string | null;
  username: string;
  displayName: string | null;
  isAdmin: boolean;
};

const rowToUser = (row: {
  id: string;
  auth_subject: string | null;
  username: string;
  display_name: string | null;
  is_admin: number;
}): User => ({
  id: row.id,
  authSubject: row.auth_subject,
  username: row.username,
  displayName: row.display_name,
  isAdmin: row.is_admin === 1,
});

export const upsertUserFromIdentity = (
  db: Database,
  identity: AuthIdentity,
): User => {
  const existing = db
    .query(
      "SELECT id, auth_subject, username, display_name, is_admin FROM users WHERE auth_subject = ?",
    )
    .get(identity.subject) as
    | {
        id: string;
        auth_subject: string;
        username: string;
        display_name: string | null;
        is_admin: number;
      }
    | undefined;

  if (existing) {
    db.run(
      "UPDATE users SET username = ?, display_name = ?, is_admin = ? WHERE id = ?",
      [
        identity.username,
        identity.displayName,
        identity.isAdmin ? 1 : 0,
        existing.id,
      ],
    );
    return rowToUser({
      ...existing,
      username: identity.username,
      display_name: identity.displayName,
      is_admin: identity.isAdmin ? 1 : 0,
    });
  }

  const id = randomBytes(16).toString("base64url");
  db.run(
    "INSERT INTO users (id, auth_subject, fourm_id, username, display_name, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      identity.subject,
      null,
      identity.username,
      identity.displayName,
      identity.isAdmin ? 1 : 0,
      Date.now(),
    ],
  );
  return {
    id,
    authSubject: identity.subject,
    username: identity.username,
    displayName: identity.displayName,
    isAdmin: identity.isAdmin,
  };
};

export const getUserById = (db: Database, id: string): User | null => {
  const row = db
    .query(
      "SELECT id, auth_subject, username, display_name, is_admin FROM users WHERE id = ?",
    )
    .get(id) as
    | {
        id: string;
        auth_subject: string | null;
        username: string;
        display_name: string | null;
        is_admin: number;
      }
    | undefined;
  return row ? rowToUser(row) : null;
};
