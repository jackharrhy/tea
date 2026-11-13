import { expect, it } from "vitest";
import { scanStorage } from "../app/storage-health.ts";
import type { MediaInventory } from "../app/storage-health.ts";

it("paginates storage, matches source visible-file rules and protects recovering media", async () => {
  const observations: MediaInventory[] = [
    {
      paths: [
        "member/kept",
        "member/missing",
        "member/moving",
        "member/removed",
      ],
      reserved: ["member/upload", "member/old"],
    },
    {
      paths: [
        "member/kept",
        "member/missing",
        "member/moving",
        "member/newly-committed",
      ],
      reserved: ["member/new", "member/moving", "member/deleting"],
    },
  ];
  const calls: (string | undefined)[] = [];
  const pages = [
    [
      "member/kept",
      "member/upload",
      "member/old",
      "member/orphan-z",
      ".hidden/file",
      "member/.hidden",
      "top-level",
    ],
    [
      "member/new",
      "member/deleting",
      "member/orphan-a",
      "member/nested/file",
      "member/newly-committed",
    ],
  ];
  const result = await scanStorage(
    {
      async list(options) {
        calls.push(options?.cursor);
        const index = options?.cursor ? 1 : 0;
        return {
          objects: pages[index].map((key) => ({ key, size: 19 })),
          truncated: index === 0,
          ...(index === 0 ? { cursor: "next" } : {}),
        } as R2Objects;
      },
      async head(path) {
        return path === "member/kept" ? ({ key: path } as R2Object) : null;
      },
    },
    async () => observations.shift()!,
  );
  expect(calls).toEqual([undefined, "next"]);
  expect(result).toEqual({
    orphanedFiles: [
      { path: "member/orphan-a", size: 19 },
      { path: "member/orphan-z", size: 19 },
    ],
    orphanedRecords: ["member/missing"],
  });
});

it("does not turn a storage failure into a clean scan", async () => {
  await expect(
    scanStorage(
      {
        list: async () => {
          throw new Error("storage unavailable");
        },
        head: async () => null,
      },
      async () => ({ paths: [], reserved: [] }),
    ),
  ).rejects.toThrow("storage unavailable");
});
