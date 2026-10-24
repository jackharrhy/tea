import { afterEach, describe, expect, test, vi } from "vitest";
import { files, folders, remoteImports, sessions, users } from "#db";
import { setDbForTesting } from "#db/connection.server";
import { loader as whoamiLoader } from "#api/api.cli.whoami";
import {
  action as foldersAction,
  loader as foldersLoader,
} from "#api/api.cli.folders";
import { action as manageFolderAction } from "#api/api.cli.folder.manage";
import { loader as downloadFolderLoader } from "#api/api.folder.download";
import { action as manifestAction } from "#api/api.cli.manifest";
import { applyMigrations, createTestDatabase, type TestDatabase } from "./db";
import { eq } from "drizzle-orm";

// Mock filesystem operations used by the folders endpoint
vi.mock("#lib/files.server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    ensureDir: vi.fn(async () => {}),
    slugToPath: (slug: string) => `/mock-uploads/${slug}`,
  };
});

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

async function seedAdminSession(db: ReturnType<typeof setupDatabase>) {
  await db.insert(users).values({
    id: "admin-1",

    username: "admin",
    fourmId: "fourm-admin-1",
    isAdmin: true,
  });
  await db.insert(sessions).values({
    id: "admin-session",
    userId: "admin-1",
    expiresAt: new Date(Date.now() + 60_000),
  });
}

async function seedNonAdminSession(db: ReturnType<typeof setupDatabase>) {
  await db.insert(users).values({
    id: "user-1",

    username: "user",
    fourmId: "fourm-user-1",
    isAdmin: false,
  });
  await db.insert(sessions).values({
    id: "user-session",
    userId: "user-1",
    expiresAt: new Date(Date.now() + 60_000),
  });
}

function adminRequest(url: string, init?: RequestInit): Request {
  const headers = new Headers({ Cookie: "artbin_session=admin-session" });
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
  return new Request(url, {
    ...init,
    headers,
  });
}

function userRequest(url: string, init?: RequestInit): Request {
  const headers = new Headers({ Cookie: "artbin_session=user-session" });
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
  return new Request(url, {
    ...init,
    headers,
  });
}

/**
 * Route handlers using requireSessionAdmin throw Response objects on auth failure.
 * This helper catches thrown Responses and returns them.
 */
async function callRoute(
  handler: Function,
  request: Request,
  params: Record<string, string> = {},
): Promise<Response> {
  try {
    return await handler({ request, params, context: {} });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

// ─── whoami ──────────────────────────────────────────────────────────────────

describe("/api/cli/whoami", () => {
  test("returns user info for authenticated admin", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    const request = adminRequest("http://localhost/api/cli/whoami");
    const response = await callRoute(whoamiLoader, request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      user: { id: "admin-1", name: "admin", isAdmin: true },
    });
  });

  test("returns 401 for unauthenticated request", async () => {
    setupDatabase();

    const request = new Request("http://localhost/api/cli/whoami");
    const response = await callRoute(whoamiLoader, request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: "Not authenticated" });
  });

  test("returns user info for an authenticated non-admin", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);

    const request = new Request("http://localhost/api/cli/whoami", {
      headers: { Cookie: "artbin_session=user-session" },
    });
    const response = await callRoute(whoamiLoader, request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      user: { id: "user-1", name: "user", isAdmin: false },
    });
  });
});

// ─── folders ─────────────────────────────────────────────────────────────────

describe("/api/cli/folders", () => {
  test("lists the public folder tree with aggregate counts", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);
    await db.insert(folders).values([
      { id: "maps", name: "Maps", slug: "maps", fileCount: 2 },
      {
        id: "tower",
        name: "Tower",
        slug: "maps/tower",
        parentId: "maps",
        fileCount: 3,
      },
      { id: "inbox", name: "Inbox", slug: "_inbox", fileCount: 9 },
    ]);

    const response = await callRoute(
      foldersLoader,
      userRequest("http://localhost/api/cli/folders"),
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.folders).toHaveLength(2);
    expect(body.folders[0]).toMatchObject({
      slug: "maps",
      childCount: 1,
      descendantCount: 1,
      totalFileCount: 5,
    });
    expect(
      body.folders.some((folder: { slug: string }) => folder.slug === "_inbox"),
    ).toBe(false);
  });

  test("lets admins include system folders", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    await db.insert(folders).values([
      { id: "maps", name: "Maps", slug: "maps" },
      { id: "inbox", name: "Inbox", slug: "_inbox" },
    ]);

    const response = await callRoute(
      foldersLoader,
      adminRequest("http://localhost/api/cli/folders?includeSystem=true"),
    );
    const body = await response.json();
    expect(body.folders.map((folder: { slug: string }) => folder.slug)).toEqual(
      ["_inbox", "maps"],
    );
  });

  test("shows folder children and import source metadata", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    await db.insert(folders).values([
      { id: "tower", name: "Tower", slug: "tower", fileCount: 1 },
      {
        id: "textures",
        name: "Textures",
        slug: "tower/textures",
        parentId: "tower",
        fileCount: 2,
      },
    ]);
    await db.insert(remoteImports).values({
      id: "import-1",
      provider: "scmapdb",
      externalId: "tower",
      destinationKey: "root",
      sourceUrl: "https://scmapdb.example/tower",
      title: "Tower",
      author: "Larry",
      game: "Sven Co-op",
      metadata: "{}",
      folderId: "tower",
    });

    const response = await callRoute(
      foldersLoader,
      adminRequest("http://localhost/api/cli/folders?slug=tower"),
    );
    const body = await response.json();
    expect(body.folder).toMatchObject({
      slug: "tower",
      totalFileCount: 3,
      source: { provider: "scmapdb", author: "Larry", game: "Sven Co-op" },
    });
    expect(
      body.folder.children.map((folder: { slug: string }) => folder.slug),
    ).toEqual(["tower/textures"]);
  });

  test("creates folders and returns their IDs", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    const request = adminRequest("http://localhost/api/cli/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folders: [
          { slug: "quake", name: "Quake" },
          { slug: "quake/id1", name: "id1", parentSlug: "quake" },
        ],
        execution: { mode: "apply", confirm: true },
      }),
    });

    const response = await callRoute(foldersAction, request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.created).toHaveLength(2);
    expect(body.created[0].slug).toBe("quake");
    expect(body.created[1].slug).toBe("quake/id1");
    expect(body.existing).toHaveLength(0);

    // Verify in DB
    const all = await db.query.folders.findMany();
    expect(all).toHaveLength(2);
  });

  test("returns existing folders without duplicating", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    // Pre-create a folder
    await db.insert(folders).values({
      id: "existing-1",
      name: "Quake",
      slug: "quake",
    });

    const request = adminRequest("http://localhost/api/cli/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folders: [
          { slug: "quake", name: "Quake" },
          { slug: "quake/maps", name: "maps", parentSlug: "quake" },
        ],
        execution: { mode: "apply", confirm: true },
      }),
    });

    const response = await callRoute(foldersAction, request);
    const body = await response.json();

    expect(body.existing).toHaveLength(1);
    expect(body.existing[0].slug).toBe("quake");
    expect(body.existing[0].id).toBe("existing-1");
    expect(body.created).toHaveLength(1);
    expect(body.created[0].slug).toBe("quake/maps");
  });

  test("links child folders to parent", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    const request = adminRequest("http://localhost/api/cli/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folders: [
          { slug: "root/child", name: "Child", parentSlug: "root" },
          { slug: "root", name: "Root" },
        ],
        execution: { mode: "apply", confirm: true },
      }),
    });

    const response = await callRoute(foldersAction, request);
    const body = await response.json();
    expect(body.created).toHaveLength(2);

    const child = await db.query.folders.findFirst({
      where: eq(folders.slug, "root/child"),
    });
    expect(child).toBeTruthy();
    expect(child!.parentId).toBe(body.created[0].id);
  });

  test("plans a batch without mutating and requires explicit apply confirmation", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    const planned = await callRoute(
      foldersAction,
      adminRequest("http://localhost/api/cli/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folders: [{ slug: "planned", name: "Planned" }],
          execution: { mode: "plan" },
        }),
      }),
    );
    expect(planned.status).toBe(200);
    expect(await planned.json()).toMatchObject({
      applied: false,
      plan: { create: [{ slug: "planned" }] },
    });
    expect(await db.query.folders.findFirst()).toBeUndefined();

    const unconfirmed = await callRoute(
      foldersAction,
      adminRequest("http://localhost/api/cli/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folders: [{ slug: "planned", name: "Planned" }],
          execution: { mode: "apply" },
        }),
      }),
    );
    expect(unconfirmed.status).toBe(400);
    expect(await db.query.folders.findFirst()).toBeUndefined();
  });

  test("rejects a mismatched hierarchy before creating any folder", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    const response = await callRoute(
      foldersAction,
      adminRequest("http://localhost/api/cli/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folders: [
            { slug: "valid", name: "Valid" },
            {
              slug: "valid/child",
              name: "Child",
              parentSlug: "somewhere-else",
            },
          ],
          execution: { mode: "apply", confirm: true },
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await db.query.folders.findMany()).toHaveLength(0);
  });

  test("rejects unauthenticated request", async () => {
    setupDatabase();

    const request = new Request("http://localhost/api/cli/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folders: [{ slug: "test", name: "Test" }],
        execution: { mode: "apply", confirm: true },
      }),
    });

    const response = await callRoute(foldersAction, request);
    expect(response.status).toBe(401);
  });

  test("non-admin cannot use the folder creation operation", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    await seedNonAdminSession(db);

    // Pre-create folders
    await db.insert(folders).values([
      { id: "folder-a", name: "Quake", slug: "quake" },
      {
        id: "folder-b",
        name: "Maps",
        slug: "quake/maps",
        parentId: "folder-a",
      },
    ]);

    const request = userRequest("http://localhost/api/cli/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folders: [
          { slug: "quake", name: "Quake" },
          { slug: "quake/maps", name: "Maps", parentSlug: "quake" },
        ],
        execution: { mode: "apply", confirm: true },
      }),
    });

    const response = await callRoute(foldersAction, request);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "forbidden", message: "Administrator access required" },
    });
  });

  test("non-admin cannot create new folders", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);

    const request = userRequest("http://localhost/api/cli/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folders: [{ slug: "new-folder", name: "New Folder" }],
        execution: { mode: "apply", confirm: true },
      }),
    });

    const response = await callRoute(foldersAction, request);
    expect(response.status).toBe(403);

    // Verify nothing was created in DB
    const all = await db.query.folders.findMany();
    expect(all).toHaveLength(0);
  });
});

describe("/api/cli/folder/manage", () => {
  test("previews a recursive rename without changing data", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    await db.insert(folders).values([
      { id: "maps", name: "Maps", slug: "maps" },
      { id: "tower", name: "Tower", slug: "maps/tower", parentId: "maps" },
    ]);
    await db.insert(files).values({
      id: "file-1",
      path: "maps/tower/tower.bsp",
      name: "tower.bsp",
      mimeType: "application/octet-stream",
      size: 100,
      kind: "map",
      folderId: "tower",
    });

    const response = await callRoute(
      manageFolderAction,
      adminRequest("http://localhost/api/cli/folder/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "rename",
          slug: "maps",
          name: "GoldSource Maps",
          execution: { mode: "plan" },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.plan).toMatchObject({
      from: { slug: "maps" },
      to: { slug: "goldsource-maps" },
      affected: { folders: 2, files: 1 },
    });
    expect(
      await db.query.folders.findFirst({ where: eq(folders.id, "maps") }),
    ).toMatchObject({
      name: "Maps",
      slug: "maps",
    });
  });

  test("applies a display-only rename", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    await db.insert(folders).values({ id: "maps", name: "Maps", slug: "maps" });

    const response = await callRoute(
      manageFolderAction,
      adminRequest("http://localhost/api/cli/folder/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "rename",
          slug: "maps",
          name: "MAPS",
          execution: { mode: "apply", confirm: true },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(
      await db.query.folders.findFirst({ where: eq(folders.id, "maps") }),
    ).toMatchObject({
      name: "MAPS",
      slug: "maps",
    });
  });

  test("rejects mutations from non-admin users", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);
    await db.insert(folders).values({ id: "maps", name: "Maps", slug: "maps" });

    const response = await callRoute(
      manageFolderAction,
      userRequest("http://localhost/api/cli/folder/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "move",
          slug: "maps",
          destinationSlug: null,
          execution: { mode: "plan" },
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Admin access required" });
  });

  test("rejects malformed mutation bodies", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    await db.insert(folders).values({ id: "maps", name: "Maps", slug: "maps" });

    const response = await callRoute(
      manageFolderAction,
      adminRequest("http://localhost/api/cli/folder/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "move", slug: "maps" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_request", message: "Operation input is invalid" },
    });
  });

  test("does not move public folders into system folders", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);
    await db.insert(folders).values([
      { id: "maps", name: "Maps", slug: "maps" },
      { id: "inbox", name: "Inbox", slug: "_inbox" },
    ]);

    const response = await callRoute(
      manageFolderAction,
      adminRequest("http://localhost/api/cli/folder/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "move",
          slug: "maps",
          destinationSlug: "_inbox",
          execution: { mode: "plan" },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_request",
        message: "Cannot move a public folder into a system folder",
      },
    });
  });
});

describe("/api/folder/download", () => {
  test("requires authentication", async () => {
    setupDatabase();
    const response = await callRoute(
      downloadFolderLoader,
      new Request("http://localhost/api/folder/download/maps"),
      { "*": "maps" },
    );

    expect(response.status).toBe(401);
  });

  test("hides system folders from non-admin users", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);
    await db
      .insert(folders)
      .values({ id: "inbox", name: "Inbox", slug: "_inbox" });

    const response = await callRoute(
      downloadFolderLoader,
      userRequest("http://localhost/api/folder/download/_inbox"),
      { "*": "_inbox" },
    );

    expect(response.status).toBe(404);
  });
});

// ─── manifest ────────────────────────────────────────────────────────────────

describe("/api/cli/manifest", () => {
  test("identifies new files vs existing files", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    // Create a folder and a file that already exists
    await db
      .insert(folders)
      .values({ id: "folder-1", name: "Quake", slug: "quake" });
    await db.insert(files).values({
      id: "file-1",
      path: "quake/textures/brick.png",
      sha256: "abc",
      name: "brick.png",
      mimeType: "image/png",
      size: 1024,
      kind: "texture",
      folderId: "folder-1",
    });

    const request = adminRequest("http://localhost/api/cli/manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentFolder: "quake",
        files: [
          { path: "textures/brick.png", sha256: "abc", size: 1024 },
          { path: "textures/stone.png", sha256: "def", size: 2048 },
          { path: "maps/e1m1.bsp", sha256: "ghi", size: 500000 },
        ],
      }),
    });

    const response = await callRoute(manifestAction, request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.existingFiles).toEqual(["textures/brick.png"]);
    expect(body.newFiles).toContain("textures/stone.png");
    expect(body.newFiles).toContain("maps/e1m1.bsp");
    expect(body.newFiles).toHaveLength(2);
    const changed = await callRoute(
      manifestAction,
      adminRequest("http://localhost/api/cli/manifest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentFolder: "quake",
          files: [
            { path: "textures/brick.png", sha256: "different", size: 1024 },
          ],
        }),
      }),
    );
    expect((await changed.json()).newFiles).toEqual(["textures/brick.png"]);
  });

  test("all files are new when folder is empty", async () => {
    const db = setupDatabase();
    await seedAdminSession(db);

    const request = adminRequest("http://localhost/api/cli/manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentFolder: "new-folder",
        files: [
          { path: "a.png", sha256: "abc", size: 100 },
          { path: "b.png", sha256: "def", size: 200 },
        ],
      }),
    });

    const response = await callRoute(manifestAction, request);
    const body = await response.json();

    expect(body.newFiles).toHaveLength(2);
    expect(body.existingFiles).toHaveLength(0);
  });

  test("rejects unauthenticated request", async () => {
    setupDatabase();

    const request = new Request("http://localhost/api/cli/manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentFolder: "test", files: [] }),
    });

    const response = await callRoute(manifestAction, request);
    expect(response.status).toBe(401);
  });

  test("non-admin can check manifest without 403", async () => {
    const db = setupDatabase();
    await seedNonAdminSession(db);

    await db
      .insert(folders)
      .values({ id: "folder-1", name: "Quake", slug: "quake" });
    await db.insert(files).values({
      id: "file-1",
      path: "quake/brick.png",
      sha256: "abc",
      name: "brick.png",
      mimeType: "image/png",
      size: 1024,
      kind: "texture",
      folderId: "folder-1",
    });

    const request = userRequest("http://localhost/api/cli/manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentFolder: "quake",
        files: [
          { path: "brick.png", sha256: "abc", size: 1024 },
          { path: "stone.png", sha256: "def", size: 2048 },
        ],
      }),
    });

    const response = await callRoute(manifestAction, request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.existingFiles).toEqual(["brick.png"]);
    expect(body.newFiles).toEqual(["stone.png"]);
  });
});
