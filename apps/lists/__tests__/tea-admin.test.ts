import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createSession } from "../src/auth.ts";
import type { Config } from "../src/config.ts";
import { schema } from "../src/db/index.ts";
import { createApplication } from "../src/http-app.ts";
import { createTestDb, seedList, seedSubscriber } from "./helpers.ts";

const config: Config = {
  awsRegion: "us-east-1",
  sqsQueueUrl: "https://example.test/queue",
  s3Bucket: "test",
  dbPath: ":memory:",
  fromDomain: "example.test",
  baseUrl: "http://localhost:8080",
  sesConfigSet: "",
  s3MediaBucket: "",
  s3MediaBaseUrl: "",
  ownerEmail: "",
  ownerPassword: "",
};

test("Remix dashboard keeps a member inside assigned lists", async () => {
  const db = createTestDb();
  const member = db
    .insert(schema.users)
    .values({
      email: "member@example.test",
      passwordHash: "disabled",
      role: "member",
    })
    .returning()
    .get();
  const allowed = seedList(db, { slug: "allowed" });
  const other = seedList(db, { slug: "other" });
  db.insert(schema.userLists)
    .values({ userId: member.id, listId: allowed.id })
    .run();
  const subscriber = seedSubscriber(db);
  db.update(schema.subscribers)
    .set({ status: "active" })
    .where(eq(schema.subscribers.id, subscriber.id))
    .run();
  db.insert(schema.subscriberLists)
    .values({
      subscriberId: subscriber.id,
      listId: other.id,
      subscriptionStatus: "confirmed",
    })
    .run();
  db.insert(schema.campaigns)
    .values({
      subject: "Private campaign",
      bodyMarkdown: "Body",
      fromAddress: "other@example.test",
      audienceType: "list",
      audienceId: other.id,
    })
    .run();
  const app = createApplication(db, config);
  const unauthenticated = await app.request("/admin/");
  expect(unauthenticated.status).toBe(302);
  expect(unauthenticated.headers.get("location")).toBe("/admin/login");

  const token = createSession(db, member.id);
  const response = await app.request("/admin/", {
    headers: { Cookie: `session=${token}` },
  });
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain("Dashboard | Lists admin");
  expect(html).toContain("Lists you can access");
  expect(html).toContain('id="app-shell"');
  expect(html).toContain('href="/admin/lists"');
  expect(html).toContain('href="/admin/tokens"');
  expect(html).not.toContain("Private campaign");
  expect(html).not.toContain('href="/admin/users"');
});

test("central admin users view is read only and role restricted", async () => {
  const db = createTestDb();
  const owner = db
    .insert(schema.users)
    .values({
      email: "owner@example.test",
      name: "Owner",
      passwordHash: "disabled",
      role: "owner",
      authSubject: "central-owner",
    })
    .returning()
    .get();
  const member = db
    .insert(schema.users)
    .values({
      email: "member@example.test",
      passwordHash: "disabled",
      role: "member",
    })
    .returning()
    .get();
  const list = seedList(db, { slug: "member-list" });
  db.insert(schema.userLists)
    .values({ userId: member.id, listId: list.id })
    .run();
  const app = createApplication(db, {
    ...config,
    identity: {
      issuer: "https://auth.example.test",
      clientId: "lists-browser",
      projectId: "lists-project",
      organizationId: "org",
    },
    introspectionCredentials: { clientId: "resource", clientSecret: "test" },
  });
  const ownerCookie = `session=${createSession(db, owner.id)}`;
  const response = await app.request("/admin/users", {
    headers: { Cookie: ownerCookie },
  });
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain("Users | Lists admin");
  expect(html).toContain('id="app-shell"');
  expect(html).toContain('href="/admin/lists"');
  expect(html).toContain('href="/admin/"');
  expect(html).toContain("member@example.test");
  expect(html).toContain("Unlinked");
  expect(html).not.toContain("central-owner");
  expect(html).not.toContain("New user");
  const listsPage = await app.request("/admin/lists", {
    headers: { Cookie: ownerCookie },
  });
  expect(listsPage.status).toBe(200);
  const listsHtml = await listsPage.text();
  expect(listsHtml).toMatch(/href="\/admin\/" hx-boost="false"/);
  expect(listsHtml).toMatch(/href="\/admin\/users" hx-boost="false"/);
  const memberCookie = `session=${createSession(db, member.id)}`;
  expect(
    (await app.request("/admin/users", { headers: { Cookie: memberCookie } }))
      .status,
  ).toBe(403);
  expect(
    (
      await app.request("/admin/users/new", {
        headers: { Cookie: ownerCookie },
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await app.request("/admin/users/new", {
        method: "POST",
        headers: { Cookie: ownerCookie },
      })
    ).status,
  ).toBe(404);
  const apiPage = await app.request("/admin/tokens", {
    headers: { Cookie: ownerCookie },
  });
  expect(apiPage.status).toBe(200);
  expect(await apiPage.text()).toContain(
    "Local Lists tokens and standalone OAuth clients are no longer issued.",
  );
  expect(
    (
      await app.request("/admin/tokens", {
        method: "POST",
        headers: { Cookie: ownerCookie },
      })
    ).status,
  ).toBe(404);
});
