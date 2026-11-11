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

test("native CSV review imports into an assigned list without accepting a forged list", async () => {
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
  const app = createApplication(db, config);
  const headers = { Cookie: `session=${createSession(db, member.id)}` };
  const upload = new FormData();
  upload.set(
    "csv",
    new File(['email,first name\nreader@example.com,"A, B"\n'], "readers.csv", {
      type: "text/csv",
    }),
  );
  const review = await app.request("/admin/import/upload", {
    method: "POST",
    headers,
    body: upload,
  });
  expect(review.status).toBe(200);
  const html = await review.text();
  const stageId = html.match(/name="stageId" value="([^"]+)"/)?.[1];
  expect(stageId).toBeDefined();
  expect(html).toContain("A, B");
  const wrong = await app.request("/admin/import/process", {
    method: "POST",
    headers,
    body: new URLSearchParams({
      stageId: stageId!,
      col_0: "email",
      col_1: "firstName",
      lists: denied.slug,
    }),
  });
  expect(wrong.status).toBe(403);
  expect(db.select().from(schema.subscribers).all()).toHaveLength(0);
  const accepted = await app.request("/admin/import/process", {
    method: "POST",
    headers,
    body: new URLSearchParams({
      stageId: stageId!,
      col_0: "email",
      col_1: "firstName",
      lists: allowed.slug,
    }),
  });
  expect(accepted.status).toBe(200);
  expect(db.select().from(schema.subscribers).get()?.firstName).toBe("A, B");
  expect(db.select().from(schema.subscriberLists).get()?.listId).toBe(
    allowed.id,
  );
});
