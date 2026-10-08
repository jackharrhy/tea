import { afterEach, describe, expect, test } from "vitest";
import { folders, sessions, users } from "#db";
import { setDbForTesting } from "#db/connection.server";
import { action as createFolderAction } from "#api/api.folder";
import { action as moveFolderAction } from "#api/api.folder.move";
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

async function seedSession() {
  const db = setupDatabase();
  await db.insert(users).values({
    id: "user-1",

    username: "user",
    fourmId: "fourm-user-1",
    isAdmin: true,
  });
  await db.insert(sessions).values({
    id: "session-1",
    userId: "user-1",
    expiresAt: new Date(Date.now() + 60_000),
  });
  return db;
}

async function seedNonAdminSession() {
  const db = setupDatabase();
  await db.insert(users).values({
    id: "regular-user",
    username: "regular",
    fourmId: "fourm-regular",
    isAdmin: false,
  });
  await db.insert(sessions).values({
    id: "regular-session",
    userId: "regular-user",
    expiresAt: new Date(Date.now() + 60_000),
  });
  return db;
}

describe("folder API action Result mapping", () => {
  test("rejects folder creation from non-admin users", async () => {
    await seedNonAdminSession();
    const request = new Request("http://localhost/api/folder", {
      method: "POST",
      headers: {
        Cookie: "artbin_session=regular-session",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Maps", slug: "maps", parentId: null }),
    });

    const response = await createFolderAction({
      request,
      params: {},
      context: {},
    } as any);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Admin access required" });
  });

  test("rejects folder moves from non-admin users", async () => {
    await seedNonAdminSession();
    const formData = new FormData();
    formData.set("_action", "move");
    formData.set("folderId", "folder-1");
    formData.set("newParentId", "root");
    const request = new Request("http://localhost/api/folder/move", {
      method: "POST",
      headers: { Cookie: "artbin_session=regular-session" },
      body: formData,
    });

    const response = await moveFolderAction({
      request,
      params: {},
      context: {},
    } as any);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Admin access required" });
  });

  test("maps createFolder validation errors to a JSON error envelope", async () => {
    await seedSession();
    const request = new Request("http://localhost/api/folder", {
      method: "POST",
      headers: {
        Cookie: "artbin_session=session-1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "   ", slug: "   ", parentId: null }),
    });

    const response = await createFolderAction({
      request,
      params: {},
      context: {},
    } as any);

    expect(await response.json()).toEqual({
      error: "Name and slug are required",
    });
  });

  test("maps create-and-move child move failures to a JSON error envelope", async () => {
    const db = await seedSession();
    await db
      .insert(folders)
      .values({ id: "child-a", name: "Child A", slug: "child-a" });
    const formData = new FormData();
    formData.set("_action", "create-and-move");
    formData.set("name", "Group");
    formData.set("parentId", "root");
    formData.set("childFolderIds", JSON.stringify(["child-a", "missing"]));
    const request = new Request("http://localhost/api/folder/move", {
      method: "POST",
      headers: { Cookie: "artbin_session=session-1" },
      body: formData,
    });

    const response = await moveFolderAction({
      request,
      params: {},
      context: {},
    } as any);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Folder not found" });
  });
});
