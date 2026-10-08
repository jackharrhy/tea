import { describe, expect, test } from "vitest";
import {
  formatFolderDetail,
  formatFolderPlan,
  formatFolderTable,
  formatFolderTree,
} from "../src/lib/folder-format.ts";
import type { FolderDetail, FolderSummary } from "../src/lib/api.ts";

function folder(overrides: Partial<FolderSummary>): FolderSummary {
  return {
    id: "folder",
    name: "Folder",
    slug: "folder",
    description: null,
    parentId: null,
    parentSlug: null,
    fileCount: 0,
    childCount: 0,
    descendantCount: 0,
    totalFileCount: 0,
    createdAt: null,
    ...overrides,
  };
}

describe("folder command formatting", () => {
  test("formats aligned list output", () => {
    const output = formatFolderTable([
      folder({ slug: "maps", totalFileCount: 12, childCount: 1 }),
      folder({ slug: "maps/tower", totalFileCount: 3 }),
    ]);

    expect(output).toContain("SLUG");
    expect(output).toContain("maps/tower");
    expect(output).toContain("12");
  });

  test("formats a nested tree", () => {
    const output = formatFolderTree([
      folder({
        id: "maps",
        name: "Maps",
        slug: "maps",
        childCount: 1,
        totalFileCount: 3,
      }),
      folder({
        id: "tower",
        name: "Tower",
        slug: "maps/tower",
        parentId: "maps",
        parentSlug: "maps",
        totalFileCount: 3,
      }),
    ]);

    expect(output).toContain("└─ Maps");
    expect(output).toContain("   └─ Tower");
    expect(output).toContain("3 files");
  });

  test("includes source metadata in folder details", () => {
    const detail: FolderDetail = {
      ...folder({ name: "Tower", slug: "tower", totalFileCount: 196 }),
      children: [],
      source: {
        provider: "scmapdb",
        externalId: "tower",
        sourceUrl: "https://example.com/tower",
        title: "Tower",
        author: "Larry",
        game: "Sven Co-op",
      },
    };

    const output = formatFolderDetail(detail);
    expect(output).toContain("Files: 0 direct, 196 total");
    expect(output).toContain("Author: Larry");
  });

  test("describes a mutation preview", () => {
    const output = formatFolderPlan({
      operation: "move",
      from: { id: "tower", name: "Tower", slug: "tower", parentSlug: null },
      to: { name: "Tower", slug: "maps/tower", parentSlug: "maps" },
      affected: { folders: 2, files: 196 },
      noOp: false,
    });

    expect(output).toBe(
      "Move: tower\nTo: maps/tower\nAffected: 2 folders, 196 files",
    );
  });
});
