import { afterEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { sessions, users } from "#db";
import { setDbForTesting } from "#db/connection.server";
import {
  getSession,
  getUserFromSession,
  logout,
  getSessionCookie,
  getClearSessionCookie,
  getUserFromRequest,
  isDevelopmentAuthEnabled,
  parseSessionCookie,
} from "#lib/auth.server";
import { applyMigrations, createTestDatabase, type TestDatabase } from "./db";

let currentDb: TestDatabase | undefined;
const originalNodeEnv = process.env.NODE_ENV;
const originalRequireAuth = process.env.ARTBIN_REQUIRE_AUTH;

afterEach(() => {
  currentDb?.close();
  currentDb = undefined;
  process.env.NODE_ENV = originalNodeEnv;
  if (originalRequireAuth === undefined) {
    delete process.env.ARTBIN_REQUIRE_AUTH;
  } else {
    process.env.ARTBIN_REQUIRE_AUTH = originalRequireAuth;
  }
});

function setupDatabase() {
  currentDb = createTestDatabase();
  applyMigrations(currentDb.sqlite);
  setDbForTesting(currentDb.db);
  return currentDb.db;
}

async function seedUser(
  db: ReturnType<typeof setupDatabase>,
  overrides: Partial<typeof users.$inferInsert> = {},
) {
  const [user] = await db
    .insert(users)
    .values({
      id: "user-1",

      username: "testuser",
      fourmId: "fourm-abc123",
      ...overrides,
    })
    .returning();
  return user;
}

async function seedSession(
  db: ReturnType<typeof setupDatabase>,
  overrides: Partial<typeof sessions.$inferInsert> = {},
) {
  const [session] = await db
    .insert(sessions)
    .values({
      id: "session-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    })
    .returning();
  return session;
}

describe("parseSessionCookie", () => {
  test("extracts session id from cookie header", () => {
    expect(
      parseSessionCookie("theme=dark; artbin_session=abc123; other=value"),
    ).toBe("abc123");
  });

  test("returns undefined for null header", () => {
    expect(parseSessionCookie(null)).toBeUndefined();
  });

  test("returns undefined when session cookie is absent", () => {
    expect(parseSessionCookie("theme=dark; other=value")).toBeUndefined();
  });
});

describe("getSession", () => {
  test("returns a valid session", async () => {
    const db = setupDatabase();
    await seedUser(db);
    await seedSession(db);

    const session = await getSession("session-1");

    expect(session).not.toBeNull();
    expect(session!.id).toBe("session-1");
    expect(session!.userId).toBe("user-1");
  });

  test("returns null for non-existent session", async () => {
    setupDatabase();

    const session = await getSession("does-not-exist");
    expect(session).toBeNull();
  });

  test("returns null for undefined session id", async () => {
    setupDatabase();

    const session = await getSession(undefined);
    expect(session).toBeNull();
  });

  test("deletes expired sessions and returns null", async () => {
    const db = setupDatabase();
    await seedUser(db);
    await seedSession(db, {
      id: "expired-session",
      expiresAt: new Date(Date.now() - 1000),
    });

    const session = await getSession("expired-session");

    expect(session).toBeNull();
    const persisted = await db.query.sessions.findFirst({
      where: eq(sessions.id, "expired-session"),
    });
    expect(persisted).toBeUndefined();
  });
});

describe("getUserFromSession", () => {
  test("returns user for a valid session", async () => {
    const db = setupDatabase();
    await seedUser(db);
    await seedSession(db);

    const user = await getUserFromSession("session-1");

    expect(user).not.toBeNull();
    expect(user!.id).toBe("user-1");
    expect(user!.username).toBe("testuser");
    expect(user!.fourmId).toBe("fourm-abc123");
  });

  test("returns null for expired session", async () => {
    const db = setupDatabase();
    await seedUser(db);
    await seedSession(db, { expiresAt: new Date(Date.now() - 1000) });

    const user = await getUserFromSession("session-1");
    expect(user).toBeNull();
  });

  test("returns null for undefined session id", async () => {
    setupDatabase();

    const user = await getUserFromSession(undefined);
    expect(user).toBeNull();
  });

  test("returns null when session exists but user has been deleted", async () => {
    const db = setupDatabase();
    await seedUser(db);
    await seedSession(db);
    // Delete the user -- session cascade should clean this up, but test the lookup path
    await db.delete(users).where(eq(users.id, "user-1"));

    const user = await getUserFromSession("session-1");
    expect(user).toBeNull();
  });
});

describe("development authentication", () => {
  test("uses a database-backed local admin in development", async () => {
    const db = setupDatabase();
    process.env.NODE_ENV = "development";
    delete process.env.ARTBIN_REQUIRE_AUTH;

    const user = await getUserFromRequest(
      new Request("http://localhost/folders"),
    );

    expect(isDevelopmentAuthEnabled()).toBe(true);
    expect(user).toMatchObject({
      id: "local-development-user",
      username: "local",
      isAdmin: true,
    });
    await expect(
      db.query.users.findFirst({
        where: eq(users.id, "local-development-user"),
      }),
    ).resolves.toMatchObject({ isAdmin: true });
  });

  test("can require normal authentication while developing", async () => {
    setupDatabase();
    process.env.NODE_ENV = "development";
    process.env.ARTBIN_REQUIRE_AUTH = "1";

    const user = await getUserFromRequest(
      new Request("http://localhost/folders"),
    );

    expect(isDevelopmentAuthEnabled()).toBe(false);
    expect(user).toBeNull();
  });
});

describe("logout", () => {
  test("deletes the session from the database", async () => {
    const db = setupDatabase();
    await seedUser(db);
    await seedSession(db);

    await logout("session-1");

    const persisted = await db.query.sessions.findFirst({
      where: eq(sessions.id, "session-1"),
    });
    expect(persisted).toBeUndefined();
  });

  test("does not throw when session does not exist", async () => {
    setupDatabase();
    await expect(logout("nonexistent")).resolves.toBeUndefined();
  });
});

describe("session cookies", () => {
  test("getSessionCookie sets HttpOnly, SameSite, and 30-day max age", () => {
    const cookie = getSessionCookie("my-session-id");

    expect(cookie).toContain("artbin_session=my-session-id");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=2592000");
    expect(cookie).toContain("Path=/");
  });

  test("getClearSessionCookie sets Max-Age=0", () => {
    const cookie = getClearSessionCookie();

    expect(cookie).toContain("artbin_session=");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
  });
});
