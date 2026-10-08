import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { files, folders } from "#db";
import { setDbForTesting } from "#db/connection.server";
import { moveFolder, renameFolder } from "#lib/folders.server";
import { applyMigrations, createTestDatabase, type TestDatabase } from "./db";

let database: TestDatabase | undefined;
let directory: string | undefined;
afterEach(async () => {
  database?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function setup() {
  database = createTestDatabase();
  applyMigrations(database.sqlite);
  setDbForTesting(database.db);
  directory = await mkdtemp(join(tmpdir(), "artbin-relocation-"));
  const db = database.db;
  const old = "maps_1%";
  await db.insert(folders).values([
    {
      id: "root",
      name: "Maps",
      slug: old,
      previewPath: `${old}/_folder-preview.png`,
    },
    {
      id: "child",
      name: "Child",
      slug: `${old}/${old}`,
      parentId: "root",
      previewPath: `${old}/${old}/_folder-preview.png`,
    },
    { id: "empty", name: "Empty", slug: `${old}/empty`, parentId: "root" },
    {
      id: "similar",
      name: "Similar",
      slug: "mapsX1-extra/child",
      previewPath: "mapsX1-extra/child/_folder-preview.png",
    },
    { id: "case", name: "Case", slug: "MAPS_1%/child" },
    { id: "target", name: "Target", slug: "target" },
  ]);
  const filePath = `${old}/${old}/${old}.bsp`;
  await db.insert(files).values({
    id: "map",
    path: filePath,
    name: `${old}.bsp`,
    mimeType: "application/octet-stream",
    size: 3,
    kind: "map",
    folderId: "child",
    hasPreview: true,
  });
  const paths = [
    `${old}/_folder-preview.png`,
    `${old}/${old}/_folder-preview.png`,
    filePath,
    `${filePath}.preview.png`,
    `${old}/${old}/${old}.artbin-bsp.json`,
    `${old}/${old}/${old}.worldview-walkability.json`,
  ];
  for (const path of paths) {
    await mkdir(dirname(join(directory!, path)), { recursive: true });
    await writeFile(join(directory!, path), path);
  }
  return {
    db,
    old,
    paths,
    deps: { uploadsDir: directory, generatePreview: async () => null },
  };
}

test("an ancestor preview failure does not misreport a committed move as failed", async () => {
  const { db, old, deps } = await setup();
  const result = await moveFolder("root", "target", {
    ...deps,
    generatePreview: async () => {
      throw new Error("injected renderer failure");
    },
  });
  expect(result.isOk()).toBe(true);
  expect(
    (await db.select().from(folders).where(eq(folders.id, "root")))[0]!.slug,
  ).toBe(`target/${old}`);
  expect(existsSync(join(directory!, `target/${old}`))).toBe(true);
});

describe.each(["move", "rename"] as const)("%s relocation", (operation) => {
  test("preserves every preview/sidecar, rewrites only the exact prefix, and leaves other trees alone", async () => {
    const { db, old, paths, deps } = await setup();
    const next = operation === "move" ? `target/${old}` : "renamed";
    const result =
      operation === "move"
        ? await moveFolder("root", "target", deps)
        : await renameFolder("root", "Renamed", deps);
    expect(result.isOk()).toBe(true);
    for (const path of paths)
      expect(
        await readFile(join(directory!, next + path.slice(old.length)), "utf8"),
      ).toBe(path);
    expect(existsSync(join(directory!, old))).toBe(false);
    expect(
      (await db.select().from(folders).where(eq(folders.id, "child")))[0],
    ).toMatchObject({
      slug: `${next}/${old}`,
      previewPath: `${next}/${old}/_folder-preview.png`,
    });
    expect(
      (await db.select().from(folders).where(eq(folders.id, "root")))[0]!
        .previewPath,
    ).toBe(`${next}/_folder-preview.png`);
    expect(
      (await db.select().from(folders).where(eq(folders.id, "empty")))[0]!
        .previewPath,
    ).toBe(null);
    expect(
      (await db.select().from(folders).where(eq(folders.id, "similar")))[0]!
        .previewPath,
    ).toBe("mapsX1-extra/child/_folder-preview.png");
    expect(
      (await db.select().from(folders).where(eq(folders.id, "case")))[0]!.slug,
    ).toBe("MAPS_1%/child");
    expect((await db.select().from(files))[0]).toMatchObject({
      path: `${next}/${old}/${old}.bsp`,
      hasPreview: true,
    });
  });

  test.each(["filesystem", "database", "commit"] as const)(
    "a %s failure leaves the entire tree unchanged",
    async (failure) => {
      const { db, paths, deps } = await setup();
      const before = await db.select().from(folders);
      if (failure === "database")
        database!.sqlite.exec(
          "CREATE TRIGGER fail_path BEFORE UPDATE OF path ON files BEGIN SELECT RAISE(ABORT, 'injected database failure'); END",
        );
      if (failure === "commit")
        database!.sqlite.exec(`
        CREATE TABLE fail_commit (folder_id TEXT REFERENCES folders(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER fail_path_commit AFTER UPDATE OF path ON files BEGIN
          INSERT INTO fail_commit VALUES ('nonexistent-folder');
        END;
      `);
      const options =
        failure === "filesystem"
          ? {
              ...deps,
              rename: () => {
                throw new Error("injected rename failure");
              },
            }
          : deps;
      const result =
        operation === "move"
          ? await moveFolder("root", "target", options)
          : await renameFolder("root", "Renamed", options);
      expect(result.isErr()).toBe(true);
      expect(await db.select().from(folders)).toEqual(before);
      for (const path of paths)
        expect(await readFile(join(directory!, path), "utf8")).toBe(path);
      expect((await db.select().from(files))[0]!.path).toBe(paths[2]);
    },
  );

  test("refuses to repoint indexed files when their source directory is missing", async () => {
    const { db, old, deps } = await setup();
    await rm(join(directory!, old), { recursive: true });
    const result =
      operation === "move"
        ? await moveFolder("root", "target", deps)
        : await renameFolder("root", "Renamed", deps);
    expect(result.isErr()).toBe(true);
    expect(
      (await db.select().from(folders).where(eq(folders.id, "root")))[0]!.slug,
    ).toBe(old);
  });
});
