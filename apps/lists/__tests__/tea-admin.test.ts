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
  expect(listsHtml).toContain('id="app-shell"');
  expect(listsHtml).toContain('href="/admin/users"');
  expect(listsHtml).toContain('href="/admin/lists/');
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

test("central Lists routes use Remix for scoped reads and mutations", async () => {
  const db = createTestDb();
  const owner = db
    .insert(schema.users)
    .values({
      email: "owner@example.test",
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
      authSubject: "central-member",
    })
    .returning()
    .get();
  const other = seedList(db, { slug: "other" });
  const allowed = seedList(db, { slug: "allowed" });
  db.insert(schema.userLists)
    .values({ userId: member.id, listId: allowed.id })
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
  const memberCookie = `session=${createSession(db, member.id)}`;
  const request = (path: string, cookie: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: new Headers({
        ...Object.fromEntries(new Headers(init.headers)),
        Cookie: cookie,
      }),
    });
  const memberIndex = await request("/admin/lists", memberCookie);
  expect(memberIndex.status).toBe(200);
  const memberHtml = await memberIndex.text();
  expect(memberHtml).toContain("allowed");
  expect(memberHtml).not.toContain("other</a>");
  expect((await request(`/admin/lists/${other.id}`, memberCookie)).status).toBe(
    403,
  );
  expect((await request("/admin/lists/new", memberCookie)).status).toBe(403);

  const created = await request("/admin/lists/new", ownerCookie, {
    method: "POST",
    body: new URLSearchParams({
      slug: "remix-list",
      name: "Remix list",
      fromDomain: "example.test",
    }),
  });
  expect(created.status).toBe(303);
  const list = db
    .select()
    .from(schema.lists)
    .where(eq(schema.lists.slug, "remix-list"))
    .get();
  expect(list?.name).toBe("Remix list");
  expect(list).toBeDefined();
  if (!list) return;
  const detail = await request(`/admin/lists/${list.id}`, ownerCookie);
  expect(detail.status).toBe(200);
  expect(await detail.text()).toContain(
    'action="/admin/lists/' + list.id + '/edit"',
  );
  const updated = await request(`/admin/lists/${list.id}/edit`, ownerCookie, {
    method: "POST",
    body: new URLSearchParams({
      slug: "remix-list",
      name: "Updated list",
      fromDomain: "example.test",
    }),
  });
  expect(updated.status).toBe(303);
  expect(
    db.select().from(schema.lists).where(eq(schema.lists.id, list.id)).get()
      ?.name,
  ).toBe("Updated list");
  expect(
    (
      await request(`/admin/lists/${list.id}/delete`, memberCookie, {
        method: "POST",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(`/admin/lists/${list.id}/delete`, ownerCookie, {
        method: "POST",
      })
    ).status,
  ).toBe(303);
  expect(
    db.select().from(schema.lists).where(eq(schema.lists.id, list.id)).get(),
  ).toBeUndefined();
});

test("Tags use the Remix document and retain subscriber associations until deletion", async () => {
  const db = createTestDb();
  const owner = db
    .insert(schema.users)
    .values({
      email: "owner@example.test",
      passwordHash: "disabled",
      role: "owner",
    })
    .returning()
    .get();
  const subscriber = seedSubscriber(db);
  const app = createApplication(db, config);
  const cookie = `session=${createSession(db, owner.id)}`;
  const request = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: new Headers({
        ...Object.fromEntries(new Headers(init.headers)),
        Cookie: cookie,
      }),
    });

  const created = await request("/admin/tags/new", {
    method: "POST",
    body: new URLSearchParams({ name: "Imported" }),
  });
  expect(created.status).toBe(303);
  const tag = db
    .select()
    .from(schema.tags)
    .where(eq(schema.tags.name, "Imported"))
    .get();
  expect(tag).toBeDefined();
  if (!tag) return;
  db.insert(schema.subscriberTags)
    .values({ subscriberId: subscriber.id, tagId: tag.id })
    .run();
  const index = await request("/admin/tags");
  expect(index.status).toBe(200);
  expect(await index.text()).toContain('id="app-shell"');
  const detail = await request(`/admin/tags/${tag.id}`);
  expect(detail.status).toBe(200);
  expect(await detail.text()).toContain(subscriber.email);
  const deleted = await request(`/admin/tags/${tag.id}/delete`, {
    method: "POST",
  });
  expect(deleted.status).toBe(303);
  expect(
    db
      .select()
      .from(schema.subscriberTags)
      .where(eq(schema.subscriberTags.tagId, tag.id))
      .all(),
  ).toHaveLength(0);
  expect(
    db.select().from(schema.tags).where(eq(schema.tags.id, tag.id)).get(),
  ).toBeUndefined();
});

test("DMARC remains owner-only and renders through Remix", async () => {
  const db = createTestDb();
  const owner = db
    .insert(schema.users)
    .values({
      email: "owner@example.test",
      passwordHash: "disabled",
      role: "owner",
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
  const app = createApplication(db, config);
  const ownerCookie = `session=${createSession(db, owner.id)}`;
  const memberCookie = `session=${createSession(db, member.id)}`;
  const ownerResponse = await app.request("/admin/dmarc", {
    headers: { Cookie: ownerCookie },
  });
  expect(ownerResponse.status).toBe(200);
  expect(await ownerResponse.text()).toContain("DMARC | Lists admin");
  expect(
    (await app.request("/admin/dmarc", { headers: { Cookie: memberCookie } }))
      .status,
  ).toBe(403);
  expect(
    (
      await app.request("/admin/dmarc/1/raw", {
        headers: { Cookie: memberCookie },
      })
    ).status,
  ).toBe(403);
});
