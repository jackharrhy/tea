import { expect, test } from "bun:test";

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

test("native campaign editor creates a scoped draft and keeps preview isolated", async () => {
  const db = createTestDb();
  const member = db
    .insert(schema.users)
    .values({ email: "member@example.com", passwordHash: "hash", role: "member" })
    .returning()
    .get();
  const allowed = seedList(db, { slug: "allowed" });
  const denied = seedList(db, { slug: "denied" });
  db.insert(schema.userLists).values({ userId: member.id, listId: allowed.id }).run();
  const app = createApplication(db, config);
  const headers = { Cookie: `session=${createSession(db, member.id)}` };
  const editor = await app.request("/admin/campaigns/new", { headers });
  expect(editor.status).toBe(200);
  expect(await editor.text()).toContain("data-campaign-editor");
  const draft = new URLSearchParams({
    audienceMode: "list",
    listId: allowed.id.toString(),
    fromAddress: "sender@example.com",
    fromName: "Sender",
    subject: "Native campaign",
    bodyMarkdown: "Hello **world**",
    templateSlug: "newsletter",
  });
  const created = await app.request("/admin/campaigns/new", {
    method: "POST",
    headers,
    body: draft,
  });
  expect(created.status).toBe(303);
  const campaign = db.select().from(schema.campaigns).get()!;
  expect(campaign.audienceId).toBe(allowed.id);
  const detail = await app.request(`/admin/campaigns/${campaign.id}`, { headers });
  expect(detail.status).toBe(200);
  expect(await detail.text()).toContain("Native campaign");
  const preview = await app.request(`/admin/campaigns/${campaign.id}/preview`, { headers });
  expect(preview.status).toBe(200);
  expect(preview.headers.get("content-security-policy")).toContain("default-src 'none'");
  const wrong = await app.request("/admin/campaigns/new", {
    method: "POST",
    headers,
    body: new URLSearchParams({ ...Object.fromEntries(draft), listId: String(denied.id) }),
  });
  expect(wrong.status).toBe(403);
});
