import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { WorldviewDatabase } from "../src/database.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function database(ids?: readonly string[]) {
  const root = await mkdtemp(join(tmpdir(), "worldview-database-test-"));
  roots.push(root);
  const path = join(root, "maps.db");
  const remaining = [...(ids ?? [])];
  const store = new WorldviewDatabase(
    path,
    ids
      ? () => {
          const id = remaining.shift();
          if (!id) throw new Error("ID fixture exhausted");
          return id;
        }
      : undefined,
  );
  return { path, store };
}

function user(store: WorldviewDatabase) {
  return store.upsertUser({
    fourmSub: "database-user",
    username: "database-user",
    displayName: "Database User",
    isAdmin: false,
  });
}

describe("Worldview hosted database", () => {
  test("regenerates a public ID when the primary-key candidate already exists", async () => {
    const firstId = "0123456789ab";
    const secondId = "cdefghjkmnpq";
    const { store } = await database([firstId, firstId, secondId]);
    const owner = user(store);
    expect(store.createProject(owner.id, "First", "quake").id).toBe(firstId);
    expect(store.createProject(owner.id, "Second", "quake").id).toBe(secondId);
    store.close();
  });

  test("rejects map metadata outside the short hosted-ID contract", async () => {
    const { store } = await database(["0123456789ab"]);
    const owner = user(store);
    const project = store.createProject(owner.id, "Project", "quake");
    expect(() =>
      store.createMap({
        id: crypto.randomUUID(),
        projectId: project.id,
        userId: owner.id,
        name: "legacy.map",
        format: "quake",
      }),
    ).toThrow("hosted ID contract");
    store.close();
  });

  test("installs indexes for membership authorization and bounded build queries", async () => {
    const { path, store } = await database();
    const inspection = new DatabaseSync(path, { readOnly: true });
    const indexes = inspection
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((row) => String(row.name));
    expect(indexes).toEqual(
      expect.arrayContaining([
        "project_members_by_user",
        "builds_by_map_created",
        "builds_by_requester_status",
        "builds_by_requester_created",
        "builds_by_status",
      ]),
    );
    inspection.close();
    store.close();
  });

  test("migrates an existing project constraint without losing memberships or maps", async () => {
    const { path, store } = await database();
    const owner = user(store);
    const project = store.createProject(owner.id, "Existing", "quake");
    store.createMap({
      id: store.createMapId(),
      projectId: project.id,
      userId: owner.id,
      name: "room.map",
      format: "valve-220",
    });
    store.close();

    const old = new DatabaseSync(path);
    old.exec(`
      PRAGMA foreign_keys=OFF;
      BEGIN IMMEDIATE;
      CREATE TABLE projects_old (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        game TEXT NOT NULL CHECK(game IN ('quake','goldsrc')),
        created_by TEXT NOT NULL REFERENCES users(id), archived_at INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO projects_old SELECT * FROM projects;
      DROP TABLE projects;
      ALTER TABLE projects_old RENAME TO projects;
      COMMIT;
    `);
    old.close();

    const migrated = new WorldviewDatabase(path);
    expect(migrated.project(project.id, owner.id)?.maps).toHaveLength(1);
    expect(migrated.createProject(owner.id, "Gower", "gower").game).toBe(
      "gower",
    );
    migrated.close();
    const inspection = new DatabaseSync(path);
    expect(inspection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    inspection.close();
  });
});
