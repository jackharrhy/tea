import { afterEach, describe, expect, test } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { files, folders } from "#db";
import { relocateFile } from "#lib/file-relocation.server";
import { setDbForTesting } from "#db/connection.server";
import {
  deleteFileRecord,
  deleteFile,
  generatePreview,
  getFilePath,
  getImageDimensions,
  insertFileRecord,
  moveFile,
  processImage,
  recalculateFolderCounts,
  slugToPath,
} from "#lib/files.server";
import {
  getBspDependencyPath,
  getBspThumbnailPath,
  getBspWalkabilityPath,
} from "#lib/bsp-derivatives.server";
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

describe("upload path boundaries", () => {
  test("rejects empty, absolute, and traversal paths", () => {
    for (const path of [
      "",
      "/etc/passwd",
      "../outside",
      "folder/../../outside",
    ]) {
      expect(() => getFilePath(path)).toThrow("Invalid upload path");
      expect(() => slugToPath(path)).toThrow("Invalid upload path");
    }
    expect(getFilePath("folder/file.png")).toMatch(
      /public\/uploads\/folder\/file\.png$/,
    );
  });
});

describe("BSP derivative lifecycle", () => {
  test("rolls the original back if a later sidecar rename fails", async () => {
    const root = `_bsp-rollback-${crypto.randomUUID()}`;
    const source = `${root}/source.bsp`;
    // The BSP filename fits the filesystem limit; the longer sidecar name does not.
    const destination = `${root}/${"a".repeat(250)}.bsp`;
    await mkdir(getFilePath(root), { recursive: true });
    try {
      await writeFile(getFilePath(source), "original");
      await writeFile(getBspWalkabilityPath(source), "navigation");
      expect(() => moveFile(source, destination)).toThrow();
      expect(await readFile(getFilePath(source), "utf8")).toBe("original");
      expect(await readFile(getBspWalkabilityPath(source), "utf8")).toBe(
        "navigation",
      );
      await expect(readFile(getFilePath(destination))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(getFilePath(root), { recursive: true, force: true });
    }
  });

  test("a sidecar collision preserves both originals and existing derivatives", async () => {
    const root = `_bsp-collision-${crypto.randomUUID()}`;
    const source = `${root}/source.bsp`;
    const destination = `${root}/destination.bsp`;
    await mkdir(getFilePath(root), { recursive: true });
    try {
      await writeFile(getFilePath(source), "original");
      await writeFile(getBspWalkabilityPath(source), "source navigation");
      await writeFile(
        getBspWalkabilityPath(destination),
        "existing navigation",
      );
      expect(() => moveFile(source, destination)).toThrow(
        "destination already exists",
      );
      expect(await readFile(getFilePath(source), "utf8")).toBe("original");
      expect(await readFile(getBspWalkabilityPath(source), "utf8")).toBe(
        "source navigation",
      );
      expect(await readFile(getBspWalkabilityPath(destination), "utf8")).toBe(
        "existing navigation",
      );
      await expect(readFile(getFilePath(destination))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(getFilePath(root), { recursive: true, force: true });
    }
  });

  test("moves and deletes sibling analysis artifacts with their BSP", async () => {
    const root = `_bsp-lifecycle-${crypto.randomUUID()}`;
    const source = `${root}/source.bsp`;
    const destination = `${root}/nested/destination.bsp`;
    await mkdir(getFilePath(`${root}/nested`), { recursive: true });
    await Promise.all([
      writeFile(getFilePath(source), "bsp"),
      writeFile(getBspDependencyPath(source), "manifest"),
      writeFile(getBspThumbnailPath(source), "thumbnail"),
      writeFile(getBspWalkabilityPath(source), "walkability"),
    ]);

    try {
      await moveFile(source, destination);
      expect(await readFile(getBspDependencyPath(destination), "utf8")).toBe(
        "manifest",
      );
      expect(await readFile(getBspThumbnailPath(destination), "utf8")).toBe(
        "thumbnail",
      );
      expect(await readFile(getBspWalkabilityPath(destination), "utf8")).toBe(
        "walkability",
      );

      await deleteFile(destination);
      await expect(
        readFile(getBspDependencyPath(destination)),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        readFile(getBspThumbnailPath(destination)),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        readFile(getBspWalkabilityPath(destination)),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(getFilePath(root), { recursive: true, force: true });
    }
  });
});

describe("indexed file relocation", () => {
  test.each(["success", "database failure", "missing source"])(
    "%s keeps disk and index consistent",
    async (scenario) => {
      const db = setupDatabase();
      const root = `_file-relocation-${crypto.randomUUID()}`;
      const source = `${root}/source.bsp`;
      const destination = `${root}/destination.bsp`;
      await db
        .insert(folders)
        .values({ id: "folder", name: "Folder", slug: root });
      await db.insert(files).values({
        id: "file",
        path: source,
        name: "source.bsp",
        folderId: "folder",
        size: 3,
        mimeType: "application/octet-stream",
        kind: "map",
      });
      await mkdir(getFilePath(root), { recursive: true });
      try {
        if (scenario !== "missing source") {
          await writeFile(getFilePath(source), "bsp");
          await writeFile(getBspWalkabilityPath(source), "navigation");
        }
        if (scenario === "database failure")
          currentDb!.sqlite.exec(
            "CREATE TRIGGER fail_move BEFORE UPDATE OF path ON files BEGIN SELECT RAISE(ABORT, 'injected database failure'); END",
          );
        const relocate = () =>
          relocateFile(
            { id: "file", path: source },
            { path: destination, folderId: "folder" },
          );
        if (scenario === "success") {
          relocate();
          expect((await db.query.files.findFirst())?.path).toBe(destination);
          expect(await readFile(getFilePath(destination), "utf8")).toBe("bsp");
          expect(
            await readFile(getBspWalkabilityPath(destination), "utf8"),
          ).toBe("navigation");
        } else {
          expect(relocate).toThrow();
          expect((await db.query.files.findFirst())?.path).toBe(source);
          await expect(
            readFile(getFilePath(destination)),
          ).rejects.toMatchObject({
            code: "ENOENT",
          });
          if (scenario === "database failure")
            expect(await readFile(getFilePath(source), "utf8")).toBe("bsp");
        }
      } finally {
        await rm(getFilePath(root), { recursive: true, force: true });
      }
    },
  );
});

describe("file record count sync", () => {
  test("inserting and deleting file records keeps parent folder file_count in sync", async () => {
    const db = setupDatabase();

    await db.insert(folders).values({
      id: "folder-1",
      name: "Textures",
      slug: "textures",
    });

    const insert = await insertFileRecord({
      id: "file-1",
      path: "textures/wall.png",
      name: "wall.png",
      mimeType: "image/png",
      size: 123,
      kind: "texture",
      folderId: "folder-1",
    });
    expect(insert.isOk()).toBe(true);

    const afterInsert = await db.query.folders.findFirst({
      where: eq(folders.id, "folder-1"),
    });
    expect(afterInsert?.fileCount).toBe(1);

    const deleted = await deleteFileRecord("file-1");
    expect(deleted.isOk()).toBe(true);

    const afterDelete = await db.query.folders.findFirst({
      where: eq(folders.id, "folder-1"),
    });
    expect(afterDelete?.fileCount).toBe(0);
  });

  test("recalculating folder counts repairs drift", async () => {
    const db = setupDatabase();

    await db.insert(folders).values({
      id: "folder-1",
      name: "Textures",
      slug: "textures",
      fileCount: 99,
    });

    const insert = await insertFileRecord({
      id: "file-1",
      path: "textures/wall.png",
      name: "wall.png",
      mimeType: "image/png",
      size: 123,
      kind: "texture",
      folderId: "folder-1",
    });
    expect(insert.isOk()).toBe(true);

    await recalculateFolderCounts(["folder-1"]);

    const folder = await db.query.folders.findFirst({
      where: eq(folders.id, "folder-1"),
    });
    expect(folder?.fileCount).toBe(1);
  });

  test("returns an error when inserting a duplicate file record fails", async () => {
    const db = setupDatabase();

    await db.insert(folders).values({
      id: "folder-1",
      name: "Textures",
      slug: "textures",
    });

    const record = {
      id: "file-1",
      path: "textures/wall.png",
      name: "wall.png",
      mimeType: "image/png",
      size: 123,
      kind: "texture" as const,
      folderId: "folder-1",
    };

    expect((await insertFileRecord(record)).isOk()).toBe(true);

    const duplicate = await insertFileRecord(record);

    expect(duplicate.isErr()).toBe(true);
  });
});

describe("image processing Result APIs", () => {
  test("returns an error when image dimensions cannot be read", async () => {
    const result = await getImageDimensions("/definitely/not/here.png");

    expect(result.isErr()).toBe(true);
  });

  test("returns an error when preview generation fails", async () => {
    const result = await generatePreview("/definitely/not/here.tga");

    expect(result.isErr()).toBe(true);
  });

  test("returns ok with null dimensions when preview generation fails", async () => {
    const result = await processImage("missing.tga");

    // processImage is non-fatal: if preview fails, it returns ok with null dimensions
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.width).toBeNull();
      expect(result.value.height).toBeNull();
      expect(result.value.hasPreview).toBe(false);
    }
  });
});
