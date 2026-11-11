import { test, expect, describe } from "bun:test";
import { createApplication } from "../src/http-app.ts";
import { createSession, destroySession, getAccessibleListIds } from "../src/auth.ts";
import { bootstrapOwner } from "../src/bootstrap.ts";
import { createTestDb } from "./helpers.ts";
import * as schema from "../src/db/schema.ts";

const testConfig = {
  ownerEmail: "",
  ownerPassword: "",
  awsRegion: "us-east-1",
  sqsQueueUrl: "",
  s3Bucket: "",
  dbPath: ":memory:",
  fromDomain: "example.com",
  baseUrl: "http://localhost",
  sesConfigSet: "",
};

function seedUser(
  db: ReturnType<typeof createTestDb>,
  overrides: Partial<typeof schema.users.$inferInsert> = {},
) {
  return db
    .insert(schema.users)
    .values({ email: "test@example.com", passwordHash: "hashed", role: "owner", ...overrides })
    .returning()
    .get();
}

describe("native admin sessions", () => {
  test("persists and revokes a session across application instances", async () => {
    const db = createTestDb();
    const user = seedUser(db);
    const token = createSession(db, user.id);
    const app = createApplication(db, testConfig);
    const headers = { Cookie: `session=${token}` };
    expect((await app.request("/admin/", { headers })).status).toBe(200);
    destroySession(db, token);
    const rejected = await createApplication(db, testConfig).request("/admin/", { headers });
    expect(rejected.status).toBe(302);
    expect(rejected.headers.get("location")).toBe("/admin/login");
  });
  test("rejects missing and invalid cookies", async () => {
    const db = createTestDb();
    const app = createApplication(db, testConfig);
    expect((await app.request("/admin/")).status).toBe(302);
    expect((await app.request("/admin/", { headers: { Cookie: "session=invalid" } })).status).toBe(
      302,
    );
  });
  test("enforces owner access on native users page", async () => {
    const db = createTestDb();
    const member = seedUser(db, { role: "member" });
    const token = createSession(db, member.id);
    expect(
      (
        await createApplication(db, testConfig).request("/admin/users", {
          headers: { Cookie: `session=${token}` },
        })
      ).status,
    ).toBe(403);
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
    db.insert(schema.userLists).values({ userId: user.id, listId: list1.id }).run();

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
