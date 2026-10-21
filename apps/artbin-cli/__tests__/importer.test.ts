import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test, vi } from "vitest";
import { runImport } from "../src/lib/importer.ts";
import type { ApiClient } from "../src/lib/api.ts";
import type { ScanResult } from "../src/lib/scanner.ts";
import { MAX_UPLOAD_BYTES } from "@artbin/core/uploads";

test("rejects oversized loose files before reading them into memory", async () => {
  const api = { createFolders: vi.fn() };
  const scanResult: ScanResult = {
    archives: [],
    looseFiles: [
      {
        path: "/nonexistent/huge.bin",
        relativePath: "huge.bin",
        name: "huge.bin",
        size: MAX_UPLOAD_BYTES + 1,
        gameDir: null,
      },
    ],
    totalFileCount: 1,
    totalSize: MAX_UPLOAD_BYTES + 1,
  };
  await expect(
    runImport({
      scanResult,
      api: api as unknown as ApiClient,
      rootSlug: "game",
    }),
  ).rejects.toThrow("exceeds the 512 MiB per-file upload limit");
  expect(api.createFolders).not.toHaveBeenCalled();
});

test.each(["Upper Textures\\Wall Texture.tga", "../wall.tga"])(
  "imports archive paths safely: %s",
  async (entryName) => {
    const directory = await mkdtemp(join(tmpdir(), "artbin-pak-test-"));
    try {
      const payload = Buffer.from("texture");
      const offset = 12 + payload.length;
      const pak = Buffer.alloc(offset + 64);
      pak.write("PACK");
      pak.writeUInt32LE(offset, 4);
      pak.writeUInt32LE(64, 8);
      payload.copy(pak, 12);
      pak.write(entryName, offset);
      pak.writeUInt32LE(12, offset + 56);
      pak.writeUInt32LE(payload.length, offset + 60);
      const path = join(directory, "My Pack.pak");
      await writeFile(path, pak);
      const scanResult: ScanResult = {
        archives: [
          {
            path,
            relativePath: "Games\\My Pack.pak",
            name: "My Pack.pak",
            size: pak.length,
            type: "pak",
            gameDir: null,
            entries: [],
          },
        ],
        looseFiles: [],
        totalFileCount: 1,
        totalSize: pak.length,
      };
      const api = {
        createFolders: vi.fn(async () => ({})),
        checkManifest: vi.fn(async (_root, entries) => ({
          newFiles: entries.map((entry: { path: string }) => entry.path),
          existingFiles: [],
        })),
        uploadFile: vi.fn(async () => {}),
        finalize: vi.fn(async () => ({ finalized: 1 })),
      };
      const importing = runImport({
        scanResult,
        api: api as unknown as ApiClient,
        rootSlug: "game",
      });
      if (entryName.startsWith("..")) {
        await expect(importing).rejects.toThrow("Invalid import path");
        expect(api.createFolders).not.toHaveBeenCalled();
      } else {
        expect((await importing).uploaded).toBe(1);
        expect(api.uploadFile).toHaveBeenCalledWith(
          "game",
          expect.objectContaining({
            path: "games/my-pack/upper-textures/Wall_Texture.tga",
            buffer: payload,
            sourceArchive: "My Pack.pak",
          }),
          expect.any(Function),
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("uses one canonical Windows path for folders, manifest, upload, and a plain retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "artbin-path-test-"));
  try {
    const path = join(directory, "Wall Texture.tga");
    await writeFile(path, "texture");
    const scanResult: ScanResult = {
      archives: [],
      looseFiles: [
        {
          path,
          relativePath: "Upper Textures\\Wall Texture.tga",
          name: "Wall Texture.tga",
          size: 7,
          gameDir: null,
        },
      ],
      totalFileCount: 1,
      totalSize: 7,
    };
    let exists = false;
    const api = {
      createFolders: vi.fn(async () => ({})),
      checkManifest: vi.fn(async (_root, entries) => ({
        newFiles: exists
          ? []
          : entries.map((entry: { path: string }) => entry.path),
        existingFiles: exists
          ? entries.map((entry: { path: string }) => entry.path)
          : [],
      })),
      uploadFile: vi.fn(async (_root, _file, progress) => {
        progress({
          phase: "transfer",
          current: 3,
          total: 7,
          message: "Transferring",
        });
        progress({
          phase: "transfer",
          current: 7,
          total: 7,
          message: "Transferred",
        });
        exists = true;
      }),
      finalize: vi.fn(async (_root, progress) => {
        progress({
          phase: "finalizing",
          current: 50,
          total: 100,
          message: "Refreshing folder previews: 1/2",
        });
        return { finalized: 2 };
      }),
    };
    const progress = vi.fn();
    const options = {
      scanResult,
      api: api as unknown as ApiClient,
      rootSlug: "My Game",
      onProgress: progress,
    };
    expect((await runImport(options)).uploaded).toBe(1);
    expect(api.uploadFile.mock.calls[0][0]).toBe("my-game");
    expect(api.uploadFile.mock.calls[0][1].path).toBe(
      "upper-textures/Wall_Texture.tga",
    );
    expect(api.checkManifest.mock.calls[0][1][0].path).toBe(
      "upper-textures/Wall_Texture.tga",
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "uploading", current: 3, total: 7 }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "finalizing", current: 50, total: 100 }),
    );
    expect((await runImport(options)).skipped).toBe(1);
    expect(api.uploadFile).toHaveBeenCalledTimes(1);
    expect(api.finalize).toHaveBeenCalledTimes(2);

    scanResult.looseFiles.push({
      ...scanResult.looseFiles[0],
      relativePath: "upper-textures/Wall_Texture.tga",
    });
    await expect(runImport(options)).rejects.toThrow(
      "Multiple source files map to",
    );
    expect(api.createFolders).toHaveBeenCalledTimes(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("normalizes Windows paths and reports failed uploads after finalizing successful files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "artbin-import-test-"));
  try {
    const path = join(directory, "wall.txt");
    await writeFile(path, "texture");
    const scanResult = {
      archives: [],
      looseFiles: [
        {
          path,
          relativePath: "textures\\wall.txt",
          name: "wall.txt",
          size: 7,
          gameDir: null,
        },
        {
          path,
          relativePath: "textures\\bad.txt",
          name: "bad.txt",
          size: 7,
          gameDir: null,
        },
      ],
      totalFileCount: 2,
      totalSize: 14,
    } as ScanResult;
    const api = {
      createFolders: vi.fn(async () => ({})),
      checkManifest: vi.fn(async () => ({
        newFiles: ["textures/wall.txt", "textures/bad.txt"],
        existingFiles: [],
      })),
      uploadFile: vi.fn(async (_root, file) => {
        if (file.path.endsWith("bad.txt")) throw new Error("Checksum mismatch");
      }),
      finalize: vi.fn(async () => ({ finalized: 2 })),
    };
    await expect(
      runImport({
        scanResult,
        api: api as unknown as ApiClient,
        rootSlug: "game",
      }),
    ).rejects.toThrow("textures/bad.txt: Checksum mismatch");
    expect(api.createFolders).toHaveBeenCalledWith([
      { slug: "game", name: "game", parentSlug: null },
      { slug: "game/textures", name: "textures", parentSlug: "game" },
    ]);
    expect(api.uploadFile).toHaveBeenCalledTimes(2);
    expect(api.finalize).toHaveBeenCalledWith("game", expect.any(Function));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
