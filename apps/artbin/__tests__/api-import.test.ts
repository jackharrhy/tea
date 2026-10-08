import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { folders, jobs, sessions, users } from "#db";
import { setDbForTesting } from "#db/connection.server";
import { applyMigrations, createTestDatabase, type TestDatabase } from "./db";

let currentDb: TestDatabase | undefined;

afterEach(() => {
  currentDb?.close();
  currentDb = undefined;
});

function setupDatabase() {
  currentDb = createTestDatabase();
  applyMigrations(currentDb.sqlite);
  setDbForTesting(currentDb.db);
  return currentDb.db;
}

async function seedSession(isAdmin: boolean) {
  const db = currentDb!.db;
  const id = isAdmin ? "admin-1" : "user-1";
  await db.insert(users).values({
    id,
    username: isAdmin ? "admin" : "user",
    fourmId: `fourm-${id}`,
    isAdmin,
  });
  await db.insert(sessions).values({
    id: `${id}-session`,
    userId: id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  return `${id}-session`;
}

describe("/api/import", () => {
  let action: Function;

  beforeAll(async () => {
    action = (await import("#api/api.import")).action;
  });

  test("queues Upload-dialog sources into its contextual folder", async () => {
    const db = setupDatabase();
    const sessionId = await seedSession(true);
    await db
      .insert(folders)
      .values({ id: "alice", name: "Alice", slug: "people/alice" });

    const formData = new FormData();
    formData.set("sourceUrls", "https://downloads.example.com/alice-pack.zip");
    formData.set("targetFolderId", "alice");
    const response = await action({
      request: new Request("http://localhost/api/import", {
        method: "POST",
        headers: { Cookie: `artbin_session=${sessionId}` },
        body: formData,
      }),
      params: {},
      context: {},
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      action: "remote-site-import",
      count: 1,
    });
    const queued = await db.select().from(jobs);
    expect(JSON.parse(queued[0].input)).toEqual({
      sourceUrl: "https://downloads.example.com/alice-pack.zip",
      targetFolderId: "alice",
      userId: "admin-1",
    });
  });

  test("rejects site imports from a non-admin session", async () => {
    const db = setupDatabase();
    const sessionId = await seedSession(false);
    const formData = new FormData();
    formData.set("sourceUrls", "https://downloads.example.com/maps.zip");

    const response = await action({
      request: new Request("http://localhost/api/import", {
        method: "POST",
        headers: { Cookie: `artbin_session=${sessionId}` },
        body: formData,
      }),
      params: {},
      context: {},
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Admin access required" });
    expect(await db.select().from(jobs)).toHaveLength(0);
  });
});
