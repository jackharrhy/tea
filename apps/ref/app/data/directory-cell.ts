import { DurableObject } from "cloudflare:workers";
import { newToken, tokenHash } from "./crypto.ts";

export interface BoardRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

interface BoardRow extends Record<string, SqlStorageValue> {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

const SESSION_DURATION = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW = 10 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;

export class DirectoryCell extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS solo_sessions (
          token_hash TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL,
          password_version TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS solo_boards (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS login_attempts (
          client_hash TEXT PRIMARY KEY,
          attempts INTEGER NOT NULL,
          reset_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS login_attempts_reset_at ON login_attempts(reset_at);
      `);
      const sessionColumns = ctx.storage.sql
        .exec<{ name: string }>("PRAGMA table_info(solo_sessions)")
        .toArray();
      if (
        !sessionColumns.some((column) => column.name === "password_version")
      ) {
        ctx.storage.sql.exec(
          "ALTER TABLE solo_sessions ADD COLUMN password_version TEXT NOT NULL DEFAULT ''",
        );
      }
      const oldBoards = ctx.storage.sql
        .exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'boards'",
        )
        .toArray();
      if (oldBoards.length) {
        ctx.storage.sql.exec(`
          INSERT OR IGNORE INTO solo_boards (id, title, created_at, updated_at)
          SELECT id, title, created_at, updated_at FROM boards
        `);
      }
    });
  }

  async createSession(): Promise<string> {
    const token = newToken();
    this.ctx.storage.sql.exec(
      "INSERT INTO solo_sessions (token_hash, expires_at, password_version) VALUES (?, ?, ?)",
      await tokenHash(token),
      Date.now() + SESSION_DURATION,
      await tokenHash(this.env.REF_PASSWORD),
    );
    return token;
  }

  consumeLoginAttempt(clientHash: string): number {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "DELETE FROM login_attempts WHERE reset_at <= ?",
        now,
      );
      const previous = this.ctx.storage.sql
        .exec<{ attempts: number; reset_at: number }>(
          "SELECT attempts, reset_at FROM login_attempts WHERE client_hash = ?",
          clientHash,
        )
        .toArray()[0];
      if (previous && previous.attempts >= MAX_LOGIN_ATTEMPTS)
        return Math.ceil((previous.reset_at - now) / 1000);
      this.ctx.storage.sql.exec(
        `INSERT INTO login_attempts VALUES (?, ?, ?)
         ON CONFLICT(client_hash) DO UPDATE SET attempts = excluded.attempts, reset_at = excluded.reset_at`,
        clientHash,
        (previous?.attempts ?? 0) + 1,
        previous?.reset_at ?? now + LOGIN_WINDOW,
      );
      return 0;
    });
  }

  clearLoginAttempts(clientHash: string): void {
    this.ctx.storage.sql.exec(
      "DELETE FROM login_attempts WHERE client_hash = ?",
      clientHash,
    );
  }

  async session(token: string): Promise<boolean> {
    if (!/^[0-9a-f]{64}$/.test(token)) return false;
    return (await this.sessionExpiry(await tokenHash(token))) !== null;
  }

  async endSession(token: string): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(token)) return;
    this.ctx.storage.sql.exec(
      "DELETE FROM solo_sessions WHERE token_hash = ?",
      await tokenHash(token),
    );
  }

  listBoards(): BoardRecord[] {
    return this.ctx.storage.sql
      .exec<BoardRow>("SELECT * FROM solo_boards ORDER BY updated_at DESC")
      .toArray()
      .map(toBoard);
  }

  createBoard(title: string): BoardRecord | null {
    const normalized = normalizeTitle(title);
    if (!normalized) return null;
    const board = {
      id: crypto.randomUUID(),
      title: normalized,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.ctx.storage.sql.exec(
      "INSERT INTO solo_boards VALUES (?, ?, ?, ?)",
      board.id,
      board.title,
      board.createdAt,
      board.updatedAt,
    );
    return board;
  }

  restoreBoard(record: BoardRecord): boolean {
    const existing = this.board(record.id);
    if (existing) {
      return (
        existing.title === record.title &&
        existing.createdAt === record.createdAt &&
        existing.updatedAt === record.updatedAt
      );
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO solo_boards VALUES (?, ?, ?, ?)",
      record.id,
      record.title,
      record.createdAt,
      record.updatedAt,
    );
    return true;
  }

  board(id: string): BoardRecord | null {
    const row = this.ctx.storage.sql
      .exec<BoardRow>("SELECT * FROM solo_boards WHERE id = ?", id)
      .toArray()[0];
    return row ? toBoard(row) : null;
  }

  renameBoard(id: string, title: string): BoardRecord | null {
    const normalized = normalizeTitle(title);
    if (!normalized || !this.board(id)) return null;
    this.ctx.storage.sql.exec(
      "UPDATE solo_boards SET title = ?, updated_at = ? WHERE id = ?",
      normalized,
      Date.now(),
      id,
    );
    return this.board(id);
  }

  async socketAccess(
    boardId: string,
    sessionHash: string,
  ): Promise<{ expiresAt: number } | null> {
    if (!this.board(boardId)) return null;
    const expiresAt = await this.sessionExpiry(sessionHash);
    return expiresAt === null ? null : { expiresAt };
  }

  private async sessionExpiry(sessionHash: string): Promise<number | null> {
    const row = this.ctx.storage.sql
      .exec<{ expires_at: number }>(
        "SELECT expires_at FROM solo_sessions WHERE token_hash = ? AND expires_at > ? AND password_version = ?",
        sessionHash,
        Date.now(),
        await tokenHash(this.env.REF_PASSWORD),
      )
      .toArray()[0];
    return row?.expires_at ?? null;
  }
}

function toBoard(row: BoardRow): BoardRecord {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeTitle(value: string): string | null {
  const title = value.trim();
  return title.length >= 1 && title.length <= 100 ? title : null;
}
