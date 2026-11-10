import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../../server/db";
import {
  createSession,
  getSession,
  deleteSession,
  parseSessionCookie,
  getSessionCookie,
  getClearSessionCookie,
  SESSION_COOKIE_NAME,
} from "../../../server/auth/sessions";

const setupDb = (): Database => {
  const db = new Database(":memory:");
  runMigrations(db);
  // Seed a user so the FK constraint passes.
  db.run(
    "INSERT INTO users (id, fourm_id, username, is_admin, created_at) VALUES (?, ?, ?, ?, ?)",
    ["u1", "fid1", "jack", 0, Date.now()],
  );
  return db;
};

test("createSession inserts a row and returns id", () => {
  const db = setupDb();
  const id = createSession(db, "u1");
  expect(id.length).toBeGreaterThanOrEqual(32);
  const row = db.query("SELECT * FROM sessions WHERE id = ?").get(id) as any;
  expect(row.user_id).toBe("u1");
  expect(row.expires_at).toBeGreaterThan(Date.now());
});

test("getSession returns row for valid id", () => {
  const db = setupDb();
  const id = createSession(db, "u1");
  const session = getSession(db, id);
  expect(session?.userId).toBe("u1");
});

test("getSession returns null for unknown id", () => {
  const db = setupDb();
  expect(getSession(db, "missing")).toBeNull();
});

test("getSession returns null and deletes expired session", () => {
  const db = setupDb();
  db.run("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", [
    "expired",
    "u1",
    Date.now() - 1000,
  ]);
  expect(getSession(db, "expired")).toBeNull();
  const row = db.query("SELECT * FROM sessions WHERE id = ?").get("expired");
  expect(row).toBeNull();
});

test("deleteSession removes the row", () => {
  const db = setupDb();
  const id = createSession(db, "u1");
  deleteSession(db, id);
  expect(getSession(db, id)).toBeNull();
});

test("parseSessionCookie extracts the cookie value", () => {
  expect(parseSessionCookie(`${SESSION_COOKIE_NAME}=abc123; other=yes`)).toBe(
    "abc123",
  );
  expect(parseSessionCookie("other=yes")).toBeUndefined();
  expect(parseSessionCookie(null)).toBeUndefined();
});

test("getSessionCookie sets HttpOnly Lax", () => {
  const c = getSessionCookie("abc", false);
  expect(c).toContain(`${SESSION_COOKIE_NAME}=abc`);
  expect(c).toContain("HttpOnly");
  expect(c).toContain("SameSite=Lax");
  expect(c).not.toContain("Secure");
});

test("getSessionCookie adds Secure when production", () => {
  const c = getSessionCookie("abc", true);
  expect(c).toContain("Secure");
});

test("getClearSessionCookie sets Max-Age=0", () => {
  const c = getClearSessionCookie(false);
  expect(c).toContain("Max-Age=0");
});
