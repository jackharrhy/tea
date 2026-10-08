import { afterEach, describe, expect, test } from "vitest";
import { folders } from "#db";
import { setDbForTesting } from "#db/connection.server";
import { searchFiles, getFileCountsByKind } from "#lib/file-queries.server";
import { insertFileRecord } from "#lib/files.server";
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

async function seedFolder(db: ReturnType<typeof setupDatabase>) {
  await db.insert(folders).values({
    id: "folder-1",
    name: "Textures",
    slug: "textures",
  });
}

async function seedFiles(db: ReturnType<typeof setupDatabase>) {
  await seedFolder(db);

  await insertFileRecord({
    id: "file-approved",
    path: "textures/wall.png",
    name: "wall.png",
    mimeType: "image/png",
    size: 100,
    kind: "texture",
    folderId: "folder-1",
    status: "approved",
  });

  await insertFileRecord({
    id: "file-pending",
    path: "textures/pending.png",
    name: "pending.png",
    mimeType: "image/png",
    size: 200,
    kind: "texture",
    folderId: "folder-1",
    status: "pending",
  });

  await insertFileRecord({
    id: "file-rejected",
    path: "textures/rejected.png",
    name: "rejected.png",
    mimeType: "image/png",
    size: 300,
    kind: "texture",
    folderId: "folder-1",
    status: "rejected",
  });
}

describe("searchFiles status filtering", () => {
  test("excludes pending files by default", async () => {
    const db = setupDatabase();
    await seedFiles(db);

    const result = await searchFiles({});
    const names = result.files.map((f) => f.name);

    expect(names).toContain("wall.png");
    expect(names).not.toContain("pending.png");
  });

  test("excludes rejected files by default", async () => {
    const db = setupDatabase();
    await seedFiles(db);

    const result = await searchFiles({});
    const names = result.files.map((f) => f.name);

    expect(names).toContain("wall.png");
    expect(names).not.toContain("rejected.png");
  });

  test("returns only approved files by default", async () => {
    const db = setupDatabase();
    await seedFiles(db);

    const result = await searchFiles({});

    expect(result.files).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.files[0].name).toBe("wall.png");
  });

  test("returns all files when includeAllStatuses is true", async () => {
    const db = setupDatabase();
    await seedFiles(db);

    const result = await searchFiles({ includeAllStatuses: true });

    expect(result.files).toHaveLength(3);
    expect(result.total).toBe(3);
  });
});

describe("getFileCountsByKind status filtering", () => {
  test("only counts approved files", async () => {
    const db = setupDatabase();
    await seedFiles(db);

    const counts = await getFileCountsByKind();

    expect(counts.texture).toBe(1);
    expect(counts.all).toBe(1);
  });

  test("only counts approved files within specified folders", async () => {
    const db = setupDatabase();
    await seedFiles(db);

    const counts = await getFileCountsByKind(["folder-1"]);

    expect(counts.texture).toBe(1);
    expect(counts.all).toBe(1);
  });
});
