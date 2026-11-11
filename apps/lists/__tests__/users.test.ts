import { test, expect, describe, beforeEach } from "bun:test";
import { createApplication } from "../src/http-app.ts";
type App = ReturnType<typeof createApplication>;

import { createTestDb, seedList, type TestDb } from "./helpers";
import { bootstrapOwner } from "../src/bootstrap";
import * as schema from "../src/db/schema";
import type { Config } from "../src/config";

const testConfig: Config = {
  awsRegion: "us-east-1",
  sqsQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/test-queue",
  s3Bucket: "test-bucket",
  dbPath: ":memory:",
  fromDomain: "example.com",
  baseUrl: "http://localhost:8080",
  sesConfigSet: "test-config-set",
  ownerEmail: "owner@example.com",
  ownerPassword: "owner-pass-123",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedUser(
  db: TestDb,
  overrides: {
    email?: string;
    name?: string;
    password?: string;
    role?: "owner" | "admin" | "member";
  } = {},
) {
  const email = overrides.email ?? "user@example.com";
  const password = overrides.password ?? "test-password";
  const role = overrides.role ?? "member";
  const name = overrides.name ?? null;
  const passwordHash = await Bun.password.hash(password);

  return db.insert(schema.users).values({ email, name, passwordHash, role }).returning().get();
}

/** POST /login and return the session cookie string */
async function login(
  app: App,
  email: string,
  password: string,
): Promise<{ res: Response; cookie: string | null }> {
  const form = new URLSearchParams();
  form.set("email", email);
  form.set("password", password);

  const res = await app.request("/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    redirect: "manual",
  });

  const setCookie = res.headers.get("set-cookie");
  let cookie: string | null = null;
  if (setCookie) {
    // Extract "session=<token>" from Set-Cookie header
    const match = setCookie.match(/session=([^;]+)/);
    if (match) cookie = `session=${match[1]}`;
  }

  return { res, cookie };
}

/** Make an authenticated GET request */
async function authGet(app: App, path: string, cookie: string) {
  return app.request(path, {
    method: "GET",
    headers: { Cookie: cookie },
  });
}

// ---------------------------------------------------------------------------
// 1. Owner bootstrap
// ---------------------------------------------------------------------------
describe("Owner bootstrap", () => {
  test("creates owner user on first call and skips on second", async () => {
    const db = createTestDb();

    await bootstrapOwner(db, testConfig);

    const users = db.select().from(schema.users).all();
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe("owner@example.com");
    expect(users[0].role).toBe("owner");

    // Call again -- should not create duplicate
    await bootstrapOwner(db, testConfig);

    const usersAfter = db.select().from(schema.users).all();
    expect(usersAfter).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Login flow
// ---------------------------------------------------------------------------
describe("Login flow", () => {
  let db: TestDb;
  let app: App;

  beforeEach(async () => {
    db = createTestDb();
    app = createApplication(db, testConfig);
    await seedUser(db, {
      email: "owner@example.com",
      password: "correct-password",
      role: "owner",
      name: "Owner",
    });
  });

  test("correct credentials -> 303 redirect with session cookie", async () => {
    const { res, cookie } = await login(app, "owner@example.com", "correct-password");
    expect(res.status).toBe(303);
    expect(cookie).not.toBeNull();
  });

  test("wrong password -> 401 (login page re-rendered)", async () => {
    const { res } = await login(app, "owner@example.com", "wrong-password");
    expect(res.status).toBe(401);
    // No session cookie should be set for a failed login
    // The set-cookie header may or may not be present, but the session value shouldn't be set
  });

  test("non-existent email -> 401 (login page re-rendered)", async () => {
    const { res } = await login(app, "nobody@example.com", "any-password");
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 3. Role-based access to users page
// ---------------------------------------------------------------------------
describe("Role-based access to users page", () => {
  test("owner can access /users, member gets 403", async () => {
    const db = createTestDb();
    const app = createApplication(db, testConfig);

    await seedUser(db, {
      email: "owner@example.com",
      password: "owner-pass",
      role: "owner",
      name: "Owner",
    });
    await seedUser(db, {
      email: "member@example.com",
      password: "member-pass",
      role: "member",
      name: "Member",
    });

    // Login as owner
    const { cookie: ownerCookie } = await login(app, "owner@example.com", "owner-pass");
    expect(ownerCookie).not.toBeNull();
    const ownerRes = await authGet(app, "/admin/users", ownerCookie!);
    expect(ownerRes.status).toBe(200);

    // Login as member
    const { cookie: memberCookie } = await login(app, "member@example.com", "member-pass");
    expect(memberCookie).not.toBeNull();
    const memberRes = await authGet(app, "/admin/users", memberCookie!);
    expect(memberRes.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 4. Member filtered view
// ---------------------------------------------------------------------------
describe("Member filtered view", () => {
  test("member only sees assigned lists and their campaigns", async () => {
    const db = createTestDb();
    const app = createApplication(db, testConfig);

    // Seed owner
    await seedUser(db, {
      email: "owner@example.com",
      password: "owner-pass",
      role: "owner",
    });

    // Create 2 lists
    const listA = seedList(db, {
      slug: "list-a",
      name: "List A",
      fromDomain: "example.com",
    });
    const listB = seedList(db, {
      slug: "list-b",
      name: "List B",
      fromDomain: "example.com",
    });

    // Create a campaign on each list
    db.insert(schema.campaigns)
      .values({
        audienceType: "list",
        audienceId: listA.id,
        subject: "Campaign A",
        bodyMarkdown: "# A",
        fromAddress: "a@example.com",
        status: "draft",
      })
      .run();
    db.insert(schema.campaigns)
      .values({
        audienceType: "list",
        audienceId: listB.id,
        subject: "Campaign B",
        bodyMarkdown: "# B",
        fromAddress: "b@example.com",
        status: "draft",
      })
      .run();

    // Create member assigned to list-a only
    const member = await seedUser(db, {
      email: "member@example.com",
      password: "member-pass",
      role: "member",
    });
    db.insert(schema.userLists).values({ userId: member.id, listId: listA.id }).run();

    // Login as member
    const { cookie } = await login(app, "member@example.com", "member-pass");
    expect(cookie).not.toBeNull();

    // GET /lists -> should contain "List A" but not "List B"
    const listsRes = await authGet(app, "/admin/lists", cookie!);
    expect(listsRes.status).toBe(200);
    const listsHtml = await listsRes.text();
    expect(listsHtml).toContain("List A");
    expect(listsHtml).not.toContain("List B");

    // GET /campaigns -> should contain "Campaign A" but not "Campaign B"
    const campaignsRes = await authGet(app, "/admin/campaigns", cookie!);
    expect(campaignsRes.status).toBe(200);
    const campaignsHtml = await campaignsRes.text();
    expect(campaignsHtml).toContain("Campaign A");
    expect(campaignsHtml).not.toContain("Campaign B");
  });
});
