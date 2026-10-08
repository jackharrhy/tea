import { describe, expect, test } from "vitest";
import { applyMigrations, createTestDatabase } from "./db";

describe("database migrations", () => {
  test("create the core schema expected by app code", () => {
    const { sqlite, close } = createTestDatabase();

    try {
      applyMigrations(sqlite);

      const folderColumns = sqlite
        .prepare("PRAGMA table_info(folders)")
        .all() as Array<{
        name: string;
      }>;
      const tables = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      const indexes = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as Array<{ name: string }>;

      expect(folderColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["id", "slug", "preview_path", "file_count"]),
      );
      expect(tables.map((table) => table.name)).toEqual(
        expect.arrayContaining(["settings"]),
      );
      expect(indexes.map((index) => index.name)).toEqual(
        expect.arrayContaining([
          "idx_folders_parent_id",
          "idx_files_folder_id",
          "idx_jobs_status",
        ]),
      );
    } finally {
      close();
    }
  });
});
