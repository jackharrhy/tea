import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createSession } from "../src/auth.ts";
import type { Config } from "../src/config.ts";
import { schema } from "../src/db/index.ts";
import { createApplication } from "../src/http-app.ts";
import { createTestDb, seedList } from "./helpers.ts";

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

test("native inbound routes keep thread access scoped to assigned campaigns", async () => {
  const db = createTestDb();
  const member = db
    .insert(schema.users)
    .values({
      email: "member@example.com",
      passwordHash: "hash",
      role: "member",
    })
    .returning()
    .get();
  const allowed = seedList(db, { slug: "allowed" });
  const denied = seedList(db, { slug: "denied" });
  db.insert(schema.userLists)
    .values({ userId: member.id, listId: allowed.id })
    .run();
  const first = db
    .insert(schema.campaigns)
    .values({
      subject: "Allowed campaign",
      bodyMarkdown: "Hello",
      fromAddress: "sender@example.com",
      audienceType: "list",
      audienceId: allowed.id,
    })
    .returning()
    .get();
  const second = db
    .insert(schema.campaigns)
    .values({
      subject: "Denied campaign",
      bodyMarkdown: "Hello",
      fromAddress: "sender@example.com",
      audienceType: "list",
      audienceId: denied.id,
    })
    .returning()
    .get();
  const message = db
    .insert(schema.messages)
    .values({
      threadId: 1,
      direction: "inbound",
      fromAddr: "reader@example.com",
      toAddr: "sender@example.com",
      subject: "Hello",
      bodyText: "A reply",
      campaignId: first.id,
    })
    .returning()
    .get();
  db.update(schema.messages)
    .set({ threadId: message.id })
    .where(eq(schema.messages.id, message.id))
    .run();
  const hidden = db
    .insert(schema.messages)
    .values({
      threadId: 2,
      direction: "inbound",
      fromAddr: "hidden@example.com",
      toAddr: "sender@example.com",
      subject: "Hidden",
      bodyText: "Private",
      campaignId: second.id,
    })
    .returning()
    .get();
  const app = createApplication(db, config);
  const headers = { Cookie: `session=${createSession(db, member.id)}` };
  const index = await app.request("/admin/inbound", { headers });
  expect(index.status).toBe(200);
  const html = await index.text();
  expect(html).toContain("Hello");
  expect(html).not.toContain("Hidden");
  const thread = await app.request(`/admin/inbound/${message.id}`, { headers });
  expect(thread.status).toBe(200);
  expect(thread.headers.get("Content-Security-Policy")).toContain(
    "style-src-elem 'self' 'unsafe-inline'",
  );
  expect(thread.headers.get("Content-Security-Policy")).toContain(
    "frame-src 'self' about:",
  );
  expect(await thread.text()).toContain("A reply");
  expect(
    (await app.request(`/admin/inbound/${hidden.id}`, { headers })).status,
  ).toBe(403);
  expect(
    (
      await app.request(`/admin/inbound/${hidden.id}/delete`, {
        method: "POST",
        headers,
      })
    ).status,
  ).toBe(403);
});
