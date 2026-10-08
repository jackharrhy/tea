import { afterEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { folders, files, users } from "#db";
import { setDbForTesting } from "#db/connection.server";
import { applyMigrations, createTestDatabase, type TestDatabase } from "./db";

vi.mock("#lib/files.server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    ensureDir: vi.fn(async () => {}),
    slugToPath: (slug: string) => `/mock-uploads/${slug}`,
    getFilePath: (filePath: string) => `/mock-uploads/${filePath}`,
    moveFile: vi.fn(() => {}),
    deleteFolder: vi.fn(async () => {}),
    recalculateFolderCounts: vi.fn(async () => {}),
  };
});

vi.mock("#lib/folder-preview.server", () => ({
  generateFolderPreview: vi.fn(async () => null),
}));

import {
  ensureInboxFolder,
  createUploadSession,
  approveSession,
  rejectSession,
  getPendingSessionsWithFiles,
  INBOX_SLUG,
  INBOX_NAME,
} from "#lib/inbox.server";
import { moveFile, deleteFolder } from "#lib/files.server";

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

async function seedUser(db: ReturnType<typeof setupDatabase>, id = "user-1") {
  await db.insert(users).values({
    id,

    username: id,
    fourmId: `fourm-${id}`,
  });
}

describe("ensureInboxFolder", () => {
  test("creates the _inbox folder if it doesn't exist", async () => {
    const db = setupDatabase();

    const id = await ensureInboxFolder();

    expect(id).toBeTruthy();

    const folder = await db.query.folders.findFirst({
      where: eq(folders.slug, INBOX_SLUG),
    });
    expect(folder).toBeTruthy();
    expect(folder?.name).toBe(INBOX_NAME);
    expect(folder?.slug).toBe(INBOX_SLUG);
    expect(folder?.parentId).toBeNull();
  });

  test("returns existing id if _inbox already exists (idempotent)", async () => {
    const db = setupDatabase();

    await db.insert(folders).values({
      id: "existing-inbox",
      name: INBOX_NAME,
      slug: INBOX_SLUG,
    });

    const id = await ensureInboxFolder();
    expect(id).toBe("existing-inbox");

    // Should not have created a second one
    const allInbox = await db.query.folders.findMany({
      where: eq(folders.slug, INBOX_SLUG),
    });
    expect(allInbox).toHaveLength(1);
  });
});

describe("createUploadSession", () => {
  test("creates a subfolder under _inbox with correct parentId and ownerId", async () => {
    const db = setupDatabase();
    await seedUser(db);

    const session = await createUploadSession("user-1");

    expect(session.id).toBeTruthy();
    expect(session.slug).toMatch(/^_inbox\/.+/);

    const sessionFolder = await db.query.folders.findFirst({
      where: eq(folders.id, session.id),
    });
    expect(sessionFolder).toBeTruthy();
    expect(sessionFolder?.ownerId).toBe("user-1");

    // parentId should be the inbox folder's id
    const inbox = await db.query.folders.findFirst({
      where: eq(folders.slug, INBOX_SLUG),
    });
    expect(sessionFolder?.parentId).toBe(inbox?.id);
  });
});

describe("approveSession", () => {
  test("a missing source leaves the pending record and session intact", async () => {
    const db = setupDatabase();
    await db.insert(folders).values([
      { id: "session", name: "Session", slug: "_inbox/session" },
      { id: "destination", name: "Destination", slug: "destination" },
    ]);
    await db.insert(files).values({
      id: "missing",
      path: "_inbox/session/missing.png",
      name: "missing.png",
      mimeType: "image/png",
      size: 10,
      kind: "texture",
      folderId: "session",
      status: "pending",
    });
    vi.mocked(deleteFolder).mockClear();
    vi.mocked(moveFile).mockImplementationOnce(() => {
      throw new Error("ENOENT: missing source");
    });
    await expect(
      approveSession("session", "destination", "destination"),
    ).rejects.toThrow("ENOENT");
    expect(
      await db.query.files.findFirst({ where: eq(files.id, "missing") }),
    ).toMatchObject({
      path: "_inbox/session/missing.png",
      folderId: "session",
      status: "pending",
    });
    expect(
      await db.query.folders.findFirst({ where: eq(folders.id, "session") }),
    ).toBeDefined();
    expect(deleteFolder).not.toHaveBeenCalled();
  });

  test("moves files, updates status/path/folderId, deletes session folder", async () => {
    const db = setupDatabase();
    await seedUser(db);

    // Create inbox and session folder
    await db.insert(folders).values({
      id: "inbox-1",
      name: INBOX_NAME,
      slug: INBOX_SLUG,
    });
    await db.insert(folders).values({
      id: "session-1",
      name: "abc123",
      slug: "_inbox/abc123",
      parentId: "inbox-1",
      ownerId: "user-1",
    });
    await db.insert(folders).values({
      id: "dest-1",
      name: "Textures",
      slug: "textures",
    });

    // Add a pending file
    await db.insert(files).values({
      id: "file-1",
      path: "_inbox/abc123/wall.png",
      name: "wall.png",
      mimeType: "image/png",
      size: 100,
      kind: "texture",
      folderId: "session-1",
      status: "pending",
    });

    const result = await approveSession("session-1", "dest-1", "textures");

    expect(result.approvedCount).toBe(1);

    // File should be updated
    const file = await db.query.files.findFirst({
      where: eq(files.id, "file-1"),
    });
    expect(file?.status).toBe("approved");
    expect(file?.folderId).toBe("dest-1");
    expect(file?.path).toBe("textures/wall.png");

    // Session folder should be deleted
    const sessionFolder = await db.query.folders.findFirst({
      where: eq(folders.id, "session-1"),
    });
    expect(sessionFolder).toBeUndefined();
  });

  test("with multiple files moves all of them", async () => {
    const db = setupDatabase();
    await seedUser(db);

    await db.insert(folders).values([
      { id: "inbox-1", name: INBOX_NAME, slug: INBOX_SLUG },
      {
        id: "session-1",
        name: "abc123",
        slug: "_inbox/abc123",
        parentId: "inbox-1",
        ownerId: "user-1",
      },
      { id: "dest-1", name: "Textures", slug: "textures" },
    ]);

    await db.insert(files).values([
      {
        id: "file-1",
        path: "_inbox/abc123/wall.png",
        name: "wall.png",
        mimeType: "image/png",
        size: 100,
        kind: "texture",
        folderId: "session-1",
        status: "pending",
      },
      {
        id: "file-2",
        path: "_inbox/abc123/floor.png",
        name: "floor.png",
        mimeType: "image/png",
        size: 200,
        kind: "texture",
        folderId: "session-1",
        status: "pending",
      },
      {
        id: "file-3",
        path: "_inbox/abc123/sky.png",
        name: "sky.png",
        mimeType: "image/png",
        size: 300,
        kind: "texture",
        folderId: "session-1",
        status: "pending",
      },
    ]);

    const result = await approveSession("session-1", "dest-1", "textures");

    expect(result.approvedCount).toBe(3);

    for (const fileId of ["file-1", "file-2", "file-3"]) {
      const file = await db.query.files.findFirst({
        where: eq(files.id, fileId),
      });
      expect(file?.status).toBe("approved");
      expect(file?.folderId).toBe("dest-1");
      expect(file?.path).toMatch(/^textures\//);
    }
  });

  test("with subfolders creates destination subfolder records and assigns files correctly", async () => {
    const db = setupDatabase();
    await seedUser(db);

    await db.insert(folders).values([
      { id: "inbox-1", name: INBOX_NAME, slug: INBOX_SLUG },
      {
        id: "session-1",
        name: "abc123",
        slug: "_inbox/abc123",
        parentId: "inbox-1",
        ownerId: "user-1",
      },
      {
        id: "session-sub-1",
        name: "concrete",
        slug: "_inbox/abc123/concrete",
        parentId: "session-1",
        ownerId: "user-1",
      },
      {
        id: "session-sub-2",
        name: "metal",
        slug: "_inbox/abc123/metal",
        parentId: "session-1",
        ownerId: "user-1",
      },
      { id: "dest-1", name: "Textures", slug: "textures" },
    ]);

    await db.insert(files).values([
      {
        id: "file-root",
        path: "_inbox/abc123/readme.txt",
        name: "readme.txt",
        mimeType: "text/plain",
        size: 50,
        kind: "other",
        folderId: "session-1",
        status: "pending",
      },
      {
        id: "file-concrete",
        path: "_inbox/abc123/concrete/wall.bmp",
        name: "wall.bmp",
        mimeType: "image/bmp",
        size: 100,
        kind: "texture",
        folderId: "session-sub-1",
        status: "pending",
      },
      {
        id: "file-metal",
        path: "_inbox/abc123/metal/rust.bmp",
        name: "rust.bmp",
        mimeType: "image/bmp",
        size: 200,
        kind: "texture",
        folderId: "session-sub-2",
        status: "pending",
      },
    ]);

    const result = await approveSession("session-1", "dest-1", "textures");

    expect(result.approvedCount).toBe(3);

    // Root file should be in the destination folder directly
    const rootFile = await db.query.files.findFirst({
      where: eq(files.id, "file-root"),
    });
    expect(rootFile?.status).toBe("approved");
    expect(rootFile?.folderId).toBe("dest-1");
    expect(rootFile?.path).toBe("textures/readme.txt");

    // Concrete subfolder should exist in destination
    const concreteFolder = await db.query.folders.findFirst({
      where: eq(folders.slug, "textures/concrete"),
    });
    expect(concreteFolder).toBeTruthy();
    expect(concreteFolder?.parentId).toBe("dest-1");
    expect(concreteFolder?.name).toBe("concrete");

    // File in concrete should point to the concrete folder
    const concreteFile = await db.query.files.findFirst({
      where: eq(files.id, "file-concrete"),
    });
    expect(concreteFile?.status).toBe("approved");
    expect(concreteFile?.folderId).toBe(concreteFolder!.id);
    expect(concreteFile?.path).toBe("textures/concrete/wall.bmp");

    // Metal subfolder should exist in destination
    const metalFolder = await db.query.folders.findFirst({
      where: eq(folders.slug, "textures/metal"),
    });
    expect(metalFolder).toBeTruthy();
    expect(metalFolder?.parentId).toBe("dest-1");

    // File in metal should point to the metal folder
    const metalFile = await db.query.files.findFirst({
      where: eq(files.id, "file-metal"),
    });
    expect(metalFile?.status).toBe("approved");
    expect(metalFile?.folderId).toBe(metalFolder!.id);
    expect(metalFile?.path).toBe("textures/metal/rust.bmp");

    // Session folders should be deleted
    const sessionFolder = await db.query.folders.findFirst({
      where: eq(folders.id, "session-1"),
    });
    expect(sessionFolder).toBeUndefined();
  });
});

describe("rejectSession", () => {
  test("sets status to rejected on all session files", async () => {
    const db = setupDatabase();
    await seedUser(db);

    await db.insert(folders).values([
      { id: "inbox-1", name: INBOX_NAME, slug: INBOX_SLUG },
      {
        id: "session-1",
        name: "abc123",
        slug: "_inbox/abc123",
        parentId: "inbox-1",
        ownerId: "user-1",
      },
    ]);

    await db.insert(files).values([
      {
        id: "file-1",
        path: "_inbox/abc123/wall.png",
        name: "wall.png",
        mimeType: "image/png",
        size: 100,
        kind: "texture",
        folderId: "session-1",
        status: "pending",
      },
      {
        id: "file-2",
        path: "_inbox/abc123/floor.png",
        name: "floor.png",
        mimeType: "image/png",
        size: 200,
        kind: "texture",
        folderId: "session-1",
        status: "pending",
      },
    ]);

    const result = await rejectSession("session-1");

    expect(result.rejectedCount).toBe(2);

    const file1 = await db.query.files.findFirst({
      where: eq(files.id, "file-1"),
    });
    const file2 = await db.query.files.findFirst({
      where: eq(files.id, "file-2"),
    });
    expect(file1?.status).toBe("rejected");
    expect(file2?.status).toBe("rejected");
  });

  test("deletes the session folder record", async () => {
    const db = setupDatabase();
    await seedUser(db);

    await db.insert(folders).values([
      { id: "inbox-1", name: INBOX_NAME, slug: INBOX_SLUG },
      {
        id: "session-1",
        name: "abc123",
        slug: "_inbox/abc123",
        parentId: "inbox-1",
        ownerId: "user-1",
      },
    ]);

    await db.insert(files).values({
      id: "file-1",
      path: "_inbox/abc123/wall.png",
      name: "wall.png",
      mimeType: "image/png",
      size: 100,
      kind: "texture",
      folderId: "session-1",
      status: "pending",
    });

    await rejectSession("session-1");

    const sessionFolder = await db.query.folders.findFirst({
      where: eq(folders.id, "session-1"),
    });
    expect(sessionFolder).toBeUndefined();
  });
});

describe("getPendingSessionsWithFiles", () => {
  test("returns sessions with their files, uploader, and suggested folder", async () => {
    const db = setupDatabase();
    await seedUser(db);

    await db.insert(folders).values([
      { id: "inbox-1", name: INBOX_NAME, slug: INBOX_SLUG },
      {
        id: "session-1",
        name: "abc123",
        slug: "_inbox/abc123",
        parentId: "inbox-1",
        ownerId: "user-1",
      },
      { id: "suggested-1", name: "Textures", slug: "textures" },
    ]);

    await db.insert(files).values({
      id: "file-1",
      path: "_inbox/abc123/wall.png",
      name: "wall.png",
      mimeType: "image/png",
      size: 100,
      kind: "texture",
      folderId: "session-1",
      status: "pending",
      suggestedFolderId: "suggested-1",
    });

    const sessions = await getPendingSessionsWithFiles();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].folder.id).toBe("session-1");
    expect(sessions[0].files).toHaveLength(1);
    expect(sessions[0].files[0].id).toBe("file-1");
    expect(sessions[0].uploader?.id).toBe("user-1");
    expect(sessions[0].suggestedFolder?.id).toBe("suggested-1");
  });

  test("excludes sessions with no pending files", async () => {
    const db = setupDatabase();
    await seedUser(db);

    await db.insert(folders).values([
      { id: "inbox-1", name: INBOX_NAME, slug: INBOX_SLUG },
      {
        id: "session-1",
        name: "abc123",
        slug: "_inbox/abc123",
        parentId: "inbox-1",
        ownerId: "user-1",
      },
      {
        id: "session-2",
        name: "def456",
        slug: "_inbox/def456",
        parentId: "inbox-1",
        ownerId: "user-1",
      },
    ]);

    // session-1 has a pending file
    await db.insert(files).values({
      id: "file-1",
      path: "_inbox/abc123/wall.png",
      name: "wall.png",
      mimeType: "image/png",
      size: 100,
      kind: "texture",
      folderId: "session-1",
      status: "pending",
    });

    // session-2 has only an approved file (no pending)
    await db.insert(files).values({
      id: "file-2",
      path: "_inbox/def456/floor.png",
      name: "floor.png",
      mimeType: "image/png",
      size: 200,
      kind: "texture",
      folderId: "session-2",
      status: "approved",
    });

    const sessions = await getPendingSessionsWithFiles();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].folder.id).toBe("session-1");
  });
});
