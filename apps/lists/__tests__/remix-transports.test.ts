import { expect, test } from "bun:test";

import { createApiRouter } from "../app/api-router.ts";
import { createMcpRouter } from "../app/mcp-router.ts";
import { createApplication } from "../src/http-app.ts";
import type { Config } from "../src/config.ts";
import { schema } from "../src/db/index.ts";
import { mintApiToken } from "../src/services/api-tokens.ts";
import { createTestDb, seedList } from "./helpers.ts";

const config: Config = {
  awsRegion: "us-east-1",
  sqsQueueUrl: "queue",
  s3Bucket: "bucket",
  dbPath: ":memory:",
  fromDomain: "example.com",
  baseUrl: "http://localhost",
  sesConfigSet: "config",
  s3MediaBucket: "",
  s3MediaBaseUrl: "",
  ownerEmail: "",
  ownerPassword: "",
  oauthDynamicRegistrationEnabled: true,
};

test("Remix REST and MCP share list operations and preserve member ACL", async () => {
  const db = createTestDb();
  const user = db
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
  db.insert(schema.userLists).values({ userId: user.id, listId: allowed.id }).run();
  const { token } = mintApiToken(
    db,
    user.id,
    "reader",
    ["lists:read"],
    null,
    "http://localhost/mcp",
  );
  const headers = { Authorization: `Bearer ${token}` };
  const api = createApiRouter(db, config);
  const mcp = createMcpRouter(db, config);

  const lists = await api.fetch(new Request("http://localhost/api/v1/lists", { headers }));
  expect(lists.status).toBe(200);
  expect(((await lists.json()) as { data: { id: number }[] }).data.map((list) => list.id)).toEqual([
    allowed.id,
  ]);

  const inaccessible = await api.fetch(
    new Request(`http://localhost/api/v1/lists/${denied.id}/stats`, { headers }),
  );
  expect(inaccessible.status).toBe(403);

  const call = await mcp.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "lists_list", arguments: {} },
      }),
    }),
  );
  expect(call.status).toBe(200);
  const payload = (await call.json()) as { result: { structuredContent: { id: number }[] } };
  expect(payload.result.structuredContent.map((list) => list.id)).toEqual([allowed.id]);
});

test("application serves Remix health, public pages, REST and MCP from the same fetch server", async () => {
  const db = createTestDb();
  const app = createApplication(db, config);
  expect((await app.request("/health")).status).toBe(200);
  expect((await app.request("/subscribe")).status).toBe(200);
  expect((await app.request("/api/v1/lists")).status).toBe(401);
  expect((await app.request("/mcp")).status).toBe(401);
});
