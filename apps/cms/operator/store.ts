import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createAuthStore, type User } from "../app/data/auth.ts";
import { transaction } from "../app/data/transaction.ts";
import type { OperatorAccess } from "../app/operator-access.ts";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export type OperatorStore = ReturnType<typeof createOperatorStore>;

export function createOperatorStore(path: string, central = false) {
  if (path !== ":memory:")
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const sqlite = new DatabaseSync(path);
  sqlite.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tickets (
        hash TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        site_id TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS site_sessions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        site_id TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
  const columns = sqlite.prepare("PRAGMA table_info(users)").all() as {
    name: string;
  }[];
  if (!columns.some((column) => column.name === "auth_subject"))
    sqlite.exec("ALTER TABLE users ADD COLUMN auth_subject TEXT");
  sqlite.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS users_auth_subject_unique ON users(auth_subject) WHERE auth_subject IS NOT NULL",
  );
  const sessionColumns = sqlite
    .prepare("PRAGMA table_info(sessions)")
    .all() as { name: string }[];
  if (!sessionColumns.some((column) => column.name === "auth_subject"))
    sqlite.exec("ALTER TABLE sessions ADD COLUMN auth_subject TEXT");
  const auth = createAuthStore(sqlite, central);

  function issueTicket(operatorSessionId: string, siteId: string) {
    if (!auth.resolve(operatorSessionId)) return null;
    const token = randomBytes(32).toString("hex");
    sqlite
      .prepare(
        "INSERT INTO tickets(hash,session_id,site_id,expires_at) VALUES (?,?,?,?)",
      )
      .run(
        digest(token),
        operatorSessionId,
        siteId,
        new Date(Date.now() + 30_000).toISOString(),
      );
    return token;
  }

  function redeemTicket(siteId: string, ticket: string) {
    if (!/^[a-f0-9]{64}$/.test(ticket)) return null;
    return transaction(sqlite, () => {
      const row = sqlite
        .prepare(
          "DELETE FROM tickets WHERE hash=? AND site_id=? AND expires_at>? RETURNING session_id",
        )
        .get(digest(ticket), siteId, new Date().toISOString());
      if (!row) return null;
      const operatorSessionId = String(row.session_id);
      if (!auth.resolve(operatorSessionId)) return null;
      const id = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 8 * 60 * 60_000);
      sqlite
        .prepare(
          "INSERT INTO site_sessions(id,session_id,site_id,expires_at) VALUES (?,?,?,?)",
        )
        .run(id, operatorSessionId, siteId, expiresAt.toISOString());
      return { id, expiresAt };
    });
  }

  function resolveSiteSession(siteId: string, id: string): User | null {
    if (!/^[a-f0-9]{64}$/.test(id)) return null;
    const row = sqlite
      .prepare(
        `SELECT u.id,u.email FROM site_sessions ss
         JOIN sessions s ON s.id=ss.session_id
         JOIN users u ON u.id=s.user_id
         WHERE ss.id=? AND ss.site_id=? AND ss.expires_at>? AND s.expires_at>?
           ${central ? "AND s.auth_subject=u.auth_subject AND s.auth_subject IS NOT NULL" : ""}`,
      )
      .get(id, siteId, new Date().toISOString(), new Date().toISOString());
    return row ? { id: Number(row.id), email: String(row.email) } : null;
  }

  function revokeSiteSession(siteId: string, id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) return;
    sqlite
      .prepare("DELETE FROM site_sessions WHERE id=? AND site_id=?")
      .run(id, siteId);
  }

  function close() {
    sqlite.close();
  }
  const store = {
    auth,
    sqlite,
    issueTicket,
    redeemTicket,
    resolveSiteSession,
    revokeSiteSession,
    close,
  };
  return store satisfies OperatorAccess;
}
