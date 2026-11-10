import { test, expect, describe } from "bun:test";
import { createHttpApp } from "../src/http";
import {
  createSession,
  destroySession,
  adminAuth,
  requireRole,
  getAccessibleListIds,
} from "../src/auth";
import { bootstrapOwner } from "../src/bootstrap";
import { createTestDb } from "./helpers";
import * as schema from "../src/db/schema";

function seedUser(
  db: ReturnType<typeof createTestDb>,
  overrides: Partial<typeof schema.users.$inferInsert> = {},
) {
  return db
    .insert(schema.users)
    .values({
      email: "test@example.com",
      passwordHash: "hashed",
      role: "owner",
      ...overrides,
    })
    .returning()
    .get();
}

describe("createSession", () => {
  test("returns a string", () => {
    const db = createTestDb();
    const user = seedUser(db);
    const session = createSession(db, user.id);
    expect(typeof session).toBe("string");
  });

  test("returns unique sessions", () => {
    const db = createTestDb();
    const user = seedUser(db);
    const a = createSession(db, user.id);
    const b = createSession(db, user.id);
    expect(a).not.toBe(b);
  });

  test("persists sessions in the database across app instances", async () => {
    const db = createTestDb();
    const user = seedUser(db);
    const token = createSession(db, user.id);

    const restartedApp = createHttpApp();
    restartedApp.group("/protected", (app) =>
      app.use(adminAuth(db)).get("/data", (c) => c.text("ok")),
    );

    const res = await restartedApp.handle(
      new Request("http://localhost/protected/data", {
        headers: { Cookie: `session=${token}` },
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("destroySession", () => {
  test("invalidates a session", async () => {
    const db = createTestDb();
    const user = seedUser(db);

    const app = createHttpApp();
    app.group("/protected", (group) =>
      group.use(adminAuth(db)).get("/data", (c) => c.text("ok")),
    );

    const token = createSession(db, user.id);

    // Valid session should grant access
    const validRes = await app.handle(
      new Request("http://localhost/protected/data", {
        headers: { Cookie: `session=${token}` },
      }),
    );
    expect(validRes.status).toBe(200);
    expect(await validRes.text()).toBe("ok");

    // Destroy and verify it now redirects
    destroySession(db, token);
    const invalidRes = await app.handle(
      new Request("http://localhost/protected/data", {
        headers: { Cookie: `session=${token}` },
      }),
    );
    expect(invalidRes.status).toBe(302);
    expect(invalidRes.headers.get("Location")).toBe("/admin/login");
  });
});

describe("adminAuth middleware", () => {
  test("redirects when no session cookie is present", async () => {
    const db = createTestDb();

    const app = createHttpApp();
    app.group("/protected", (group) =>
      group.use(adminAuth(db)).get("/data", (c) => c.text("ok")),
    );

    const res = await app.handle(
      new Request("http://localhost/protected/data"),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/login");
  });

  test("allows access with valid session cookie and sets user on context", async () => {
    const db = createTestDb();
    const user = seedUser(db, { email: "admin@test.com", role: "admin" });

    const app = createHttpApp();
    app.group("/protected", (group) =>
      group.use(adminAuth(db)).get("/data", (c) => {
        const u = c.user as typeof user;
        return c.text(`${u.email}:${u.role}`);
      }),
    );

    const token = createSession(db, user.id);
    const res = await app.handle(
      new Request("http://localhost/protected/data", {
        headers: { Cookie: `session=${token}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("admin@test.com:admin");
  });

  test("redirects with invalid session cookie", async () => {
    const db = createTestDb();

    const app = createHttpApp();
    app.group("/protected", (group) =>
      group.use(adminAuth(db)).get("/data", (c) => c.text("ok")),
    );

    const res = await app.handle(
      new Request("http://localhost/protected/data", {
        headers: { Cookie: "session=bogus-token" },
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/login");
  });
});

describe("requireRole middleware", () => {
  test("returns 403 for wrong role", async () => {
    const db = createTestDb();
    const user = seedUser(db, { email: "member@test.com", role: "member" });

    const app = createHttpApp();
    app.group("/protected", (group) =>
      group.use(adminAuth(db)).get("/data", (c) => c.text("ok"), {
        beforeHandle: requireRole("owner", "admin"),
      }),
    );

    const token = createSession(db, user.id);
    const res = await app.handle(
      new Request("http://localhost/protected/data", {
        headers: { Cookie: `session=${token}` },
      }),
    );
    expect(res.status).toBe(403);
  });

  test("allows correct role", async () => {
    const db = createTestDb();
    const user = seedUser(db, { email: "owner@test.com", role: "owner" });

    const app = createHttpApp();
    app.group("/protected", (group) =>
      group.use(adminAuth(db)).get("/data", (c) => c.text("ok"), {
        beforeHandle: requireRole("owner", "admin"),
      }),
    );

    const token = createSession(db, user.id);
    const res = await app.handle(
      new Request("http://localhost/protected/data", {
        headers: { Cookie: `session=${token}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});

describe("getAccessibleListIds", () => {
  test('returns "all" for owner', () => {
    const db = createTestDb();
    const user = seedUser(db, { email: "owner@test.com", role: "owner" });
    expect(getAccessibleListIds(db, user)).toBe("all");
  });

  test('returns "all" for admin', () => {
    const db = createTestDb();
    const user = seedUser(db, { email: "admin@test.com", role: "admin" });
    expect(getAccessibleListIds(db, user)).toBe("all");
  });

  test("returns list IDs for member", () => {
    const db = createTestDb();
    const user = seedUser(db, { email: "member@test.com", role: "member" });

    // Create lists
    const list1 = db
      .insert(schema.lists)
      .values({ slug: "list-1", name: "List 1", fromDomain: "example.com" })
      .returning()
      .get();
    db.insert(schema.lists)
      .values({ slug: "list-2", name: "List 2", fromDomain: "example.com" })
      .returning()
      .get();

    // Assign member to list1 only
    db.insert(schema.userLists)
      .values({ userId: user.id, listId: list1.id })
      .run();

    const ids = getAccessibleListIds(db, user);
    expect(ids).toEqual([list1.id]);
  });
});

describe("bootstrapOwner", () => {
  test("creates owner when DB is empty", async () => {
    const db = createTestDb();
    await bootstrapOwner(db, {
      ownerEmail: "owner@example.com",
      ownerPassword: "secret123",
      awsRegion: "",
      sqsQueueUrl: "",
      s3Bucket: "",
      dbPath: "",
      fromDomain: "",
      baseUrl: "",
      sesConfigSet: "",
    });

    const users = db.select().from(schema.users).all();
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe("owner@example.com");
    expect(users[0].role).toBe("owner");
    expect(users[0].name).toBe("Owner");
    // Verify the password hash works
    const valid = await Bun.password.verify("secret123", users[0].passwordHash);
    expect(valid).toBe(true);
  });

  test("skips when users already exist", async () => {
    const db = createTestDb();
    seedUser(db, { email: "existing@example.com" });

    await bootstrapOwner(db, {
      ownerEmail: "owner@example.com",
      ownerPassword: "secret123",
      awsRegion: "",
      sqsQueueUrl: "",
      s3Bucket: "",
      dbPath: "",
      fromDomain: "",
      baseUrl: "",
      sesConfigSet: "",
    });

    const users = db.select().from(schema.users).all();
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe("existing@example.com");
  });

  test("skips when ownerEmail is empty", async () => {
    const db = createTestDb();
    await bootstrapOwner(db, {
      ownerEmail: "",
      ownerPassword: "secret123",
      awsRegion: "",
      sqsQueueUrl: "",
      s3Bucket: "",
      dbPath: "",
      fromDomain: "",
      baseUrl: "",
      sesConfigSet: "",
    });

    const users = db.select().from(schema.users).all();
    expect(users).toHaveLength(0);
  });
});
