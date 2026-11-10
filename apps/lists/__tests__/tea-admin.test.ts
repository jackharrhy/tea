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
  expect(html).not.toContain("Private campaign");
  expect(html).not.toContain('href="/admin/users"');
});
