import { expect, test } from "bun:test";

import { createSession } from "../src/auth.ts";
import type { Config } from "../src/config.ts";
import { schema } from "../src/db/index.ts";
import { createApplication } from "../src/http-app.ts";
import { createTestDb } from "./helpers.ts";

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

test("native template gallery and preview retain the shared shell and restrictive CSP", async () => {
  const db = createTestDb();
  const user = db
    .insert(schema.users)
    .values({ email: "owner@example.com", passwordHash: "hash", role: "owner" })
    .returning()
    .get();
  const template = db.select().from(schema.emailTemplates).get()!;
  const app = createApplication(db, config);
  const headers = { Cookie: `session=${createSession(db, user.id)}` };
  const gallery = await app.request("/admin/templates", { headers });
  expect(gallery.status).toBe(200);
  expect(await gallery.text()).toContain(template.name);
  const workspace = await app.request(`/admin/templates/${template.slug}`, {
    headers,
  });
  expect(workspace.status).toBe(200);
  expect(await workspace.text()).toContain('id="app-shell"');
  const preview = await app.request(
    `/admin/templates/${template.slug}/preview`,
    { headers },
  );
  expect(preview.status).toBe(200);
  expect(preview.headers.get("content-security-policy")).toContain(
    "default-src 'none'",
  );
  expect(preview.headers.get("content-security-policy")).not.toContain(
    "nonce-",
  );
});
