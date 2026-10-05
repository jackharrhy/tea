import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AuthStore, type User } from "@tea/cms-core/data/auth.ts";
import { transaction } from "@tea/cms-core/data/transaction.ts";
import type { OperatorAccess } from "@tea/cms-core/operator-access.ts";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class OperatorStore implements OperatorAccess {
  readonly auth: AuthStore;
  readonly sqlite: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec(`
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
    this.auth = new AuthStore(this.sqlite);
  }

  issueTicket(operatorSessionId: string, siteId: string) {
    if (!this.auth.resolve(operatorSessionId)) return null;
    const token = randomBytes(32).toString("hex");
    this.sqlite
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

  redeemTicket(siteId: string, ticket: string) {
    if (!/^[a-f0-9]{64}$/.test(ticket)) return null;
    return transaction(this.sqlite, () => {
      const row = this.sqlite
        .prepare(
          "DELETE FROM tickets WHERE hash=? AND site_id=? AND expires_at>? RETURNING session_id",
        )
        .get(digest(ticket), siteId, new Date().toISOString());
      if (!row) return null;
      const operatorSessionId = String(row.session_id);
      if (!this.auth.resolve(operatorSessionId)) return null;
      const id = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 8 * 60 * 60_000);
      this.sqlite
        .prepare(
          "INSERT INTO site_sessions(id,session_id,site_id,expires_at) VALUES (?,?,?,?)",
        )
        .run(id, operatorSessionId, siteId, expiresAt.toISOString());
      return { id, expiresAt };
    });
  }

  resolveSiteSession(siteId: string, id: string): User | null {
    if (!/^[a-f0-9]{64}$/.test(id)) return null;
    const row = this.sqlite
      .prepare(
        `SELECT u.id,u.email FROM site_sessions ss
         JOIN sessions s ON s.id=ss.session_id
         JOIN users u ON u.id=s.user_id
         WHERE ss.id=? AND ss.site_id=? AND ss.expires_at>? AND s.expires_at>?`,
      )
      .get(id, siteId, new Date().toISOString(), new Date().toISOString());
    return row ? { id: Number(row.id), email: String(row.email) } : null;
  }

  revokeSiteSession(siteId: string, id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) return;
    this.sqlite
      .prepare("DELETE FROM site_sessions WHERE id=? AND site_id=?")
      .run(id, siteId);
  }

  close() {
    this.sqlite.close();
  }
}
