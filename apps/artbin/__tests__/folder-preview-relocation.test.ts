import { afterEach, expect, test, vi } from "vitest";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { files, folders } from "#db";
import { setDbForTesting } from "#db/connection.server";
import { getFilePath } from "#lib/files.server";
import { renameFolder } from "#lib/folders.server";
import { generateFolderPreview } from "#lib/folder-preview.server";
import { applyMigrations, createTestDatabase, type TestDatabase } from "./db";

const render = vi.hoisted(() => ({ calls: 0, beforePublish: async () => {} }));
vi.mock("sharp", () => ({
  default: () => {
    const pipeline = {
      resize: () => pipeline,
      png: () => pipeline,
      composite: () => pipeline,
      toBuffer: async () => {
        if (++render.calls === 2) await render.beforePublish();
        return Buffer.from("rendered preview");
      },
    };
    return pipeline;
  },
}));

let database: TestDatabase | undefined;
let paths: string[] = [];
afterEach(async () => {
  database?.close();
  for (const path of paths)
    await rm(getFilePath(path), { recursive: true, force: true });
  paths = [];
});

test.each(["rename", "delete"])(
  "a %s during rendering cannot publish an obsolete folder path",
  async (operation) => {
    database = createTestDatabase();
    applyMigrations(database.sqlite);
    setDbForTesting(database.db);
    const db = database.db;
    const old = `preview-race-${crypto.randomUUID()}`;
    const next = `${old}-renamed`;
    paths = [old, next];
    await db
      .insert(folders)
      .values({ id: "folder", name: "Folder", slug: old });
    await db.insert(files).values({
      id: "image",
      path: `${old}/image.png`,
      name: "image.png",
      folderId: "folder",
      mimeType: "image/png",
      kind: "texture",
      size: 3,
    });
    await mkdir(getFilePath(old), { recursive: true });
    await writeFile(getFilePath(`${old}/image.png`), "image");
    render.calls = 0;
    render.beforePublish = async () => {
      if (operation === "rename") {
        expect((await renameFolder("folder", next)).isOk()).toBe(true);
      } else {
        await db.delete(folders).where(eq(folders.id, "folder"));
        await rm(getFilePath(old), { recursive: true });
      }
    };
    const result = await generateFolderPreview("folder");
    expect(existsSync(getFilePath(old))).toBe(false);
    if (operation === "rename") {
      expect(result).toBe(`${next}/_folder-preview.png`);
      expect((await db.query.folders.findFirst())?.previewPath).toBe(result);
      expect(await readFile(getFilePath(result!), "utf8")).toBe(
        "rendered preview",
      );
    } else {
      expect(result).toBeNull();
      expect(await db.query.folders.findFirst()).toBeUndefined();
    }
  },
);
