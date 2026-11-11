import { expect, test } from "bun:test";

import { createSession } from "../src/auth.ts";
import type { Config } from "../src/config.ts";
import { schema } from "../src/db/index.ts";
import { createApplication } from "../src/http-app.ts";
import { createTestDb, seedList, seedSubscriber } from "./helpers.ts";

const config: Config = {
  awsRegion: "us-east-1",
  sqsQueueUrl: "queue",
  s3Bucket: "bucket",
  dbPath: ":memory:",
  fromDomain: "example.com",
  baseUrl: "http://localhost",
  sesConfigSet: "",
  s3MediaBucket: "",
  s3MediaBaseUrl: "",
  ownerEmail: "",
  ownerPassword: "",
};

test("dashboard and subscribers use the same Remix admin shell", async () => {
  const db = createTestDb();
  const user = db
    .insert(schema.users)
    .values({ email: "owner@example.com", passwordHash: "hash", role: "owner" })
    .returning()
    .get();
  seedList(db);
  seedSubscriber(db);
  const app = createApplication(db, config);
  const headers = { Cookie: `session=${createSession(db, user.id)}` };
  const dashboard = await app.request("/admin/", { headers });
  const subscribers = await app.request("/admin/subscribers", { headers });
  const filtered = await app.request("/admin/subscribers?search=missing", { headers });
  expect(dashboard.status).toBe(200);
  expect(subscribers.status).toBe(200);
  const dashboardHtml = await dashboard.text();
  const subscribersHtml = await subscribers.text();
  expect(subscribersHtml).toContain("test@example.com");
  expect(await filtered.text()).toContain("No subscribers match the current filters.");
  expect(dashboardHtml).toContain('id="app-shell"');
  expect(subscribersHtml).toContain('id="app-shell"');
  expect(dashboardHtml).not.toContain('href="/static/styles.css"');
  expect(subscribersHtml).not.toContain('href="/static/styles.css"');
});

test("native subscriber forms preserve memberships and member list boundaries", async () => {
  const db = createTestDb();
  const member = db.insert(schema.users).values({ email: "member@example.com", passwordHash: "hash", role: "member" }).returning().get();
  const allowed = seedList(db, { slug: "allowed" });
  const denied = seedList(db, { slug: "denied" });
  db.insert(schema.userLists).values({ userId: member.id, listId: allowed.id }).run();
  const app = createApplication(db, config);
  const headers = { Cookie: `session=${createSession(db, member.id)}` };
  const wrongList = await app.request("/admin/subscribers/new", {
    method: "POST", headers,
    body: new URLSearchParams({ email: "reader@example.com", firstName: "", lastName: "", lists: denied.slug }),
  });
  expect(wrongList.status).toBe(403);
  expect(db.select().from(schema.subscribers).all()).toHaveLength(0);

  const created = await app.request("/admin/subscribers/new", {
    method: "POST", headers,
    body: new URLSearchParams({ email: "reader@example.com", firstName: "Reader", lastName: "", lists: allowed.slug }),
  });
  expect(created.status).toBe(303);
  const subscriber = db.select().from(schema.subscribers).get()!;
  expect(db.select().from(schema.subscriberLists).all()).toEqual([
    expect.objectContaining({ subscriberId: subscriber.id, listId: allowed.id, status: "unconfirmed" }),
  ]);
  expect((await app.request(`/admin/subscribers/${subscriber.id}`, { headers })).status).toBe(200);
  expect((await app.request(`/admin/subscribers/${subscriber.id}/list/${denied.id}/status`, {
    method: "POST", headers, body: new URLSearchParams({ listStatus: "confirmed" }),
  })).status).toBe(403);
});

test("local admin login and logout use native Remix routes", async () => {
  const db = createTestDb();
  db.insert(schema.users).values({
    email: "owner@example.com",
    passwordHash: await Bun.password.hash("correct-password"),
    role: "owner",
  }).run();
  const app = createApplication(db, config);
  const loginPage = await app.request("/admin/login");
  expect(loginPage.status).toBe(200);
  expect(await loginPage.text()).toContain("Lists admin");
  const invalid = await app.request("/admin/login", {
    method: "POST",
    body: new URLSearchParams({ email: "owner@example.com", password: "wrong" }),
  });
  expect(invalid.status).toBe(401);
  const loggedIn = await app.request("/admin/login", {
    method: "POST",
    body: new URLSearchParams({ email: "owner@example.com", password: "correct-password" }),
  });
  expect(loggedIn.status).toBe(303);
  const cookie = loggedIn.headers.get("set-cookie")!;
  expect((await app.request("/admin/", { headers: { Cookie: cookie } })).status).toBe(200);
  const logout = await app.request("/admin/logout", { method: "POST", headers: { Cookie: cookie } });
  expect(logout.status).toBe(303);
  expect((await app.request("/admin/", { headers: { Cookie: cookie } })).status).toBe(302);
});
