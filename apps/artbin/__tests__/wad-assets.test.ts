import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, test } from "vitest";

import { extractBspTextures } from "#lib/bsp-texture-extraction.server";
import { inspectWad } from "#lib/game-textures.server";
import { getWADTexturePreview, inspectWADFile } from "#lib/wad-assets.server";
import { makeWAD3Texture } from "./wad-fixture";

const uploadDirectory = join(process.cwd(), "public", "uploads", "_wad-test");
let cacheDirectory: string | null = null;

afterEach(async () => {
  delete process.env.ARTBIN_CACHE_DIR;
  await rm(uploadDirectory, { recursive: true, force: true });
  if (cacheDirectory)
    await rm(cacheDirectory, { recursive: true, force: true });
  cacheDirectory = null;
});

describe("virtual WAD libraries", () => {
  test("inspects the source WAD and caches individual PNG previews outside uploads", async () => {
    const wad = makeWAD3Texture();
    cacheDirectory = await mkdtemp(join(tmpdir(), "artbin-wad-cache-"));
    process.env.ARTBIN_CACHE_DIR = cacheDirectory;
    await mkdir(uploadDirectory, { recursive: true });
    await writeFile(join(uploadDirectory, "virtual.wad"), wad);

    const contents = await inspectWADFile("_wad-test/virtual.wad");
    expect(contents).toEqual({
      version: "WAD3",
      lumpCount: 1,
      textures: [
        {
          index: 0,
          name: "VIRTUAL",
          width: 8,
          height: 8,
          isTransparent: false,
        },
      ],
      warnings: [],
    });

    const file = {
      path: "_wad-test/virtual.wad",
      sha256: "e".repeat(64),
    };
    const first = await getWADTexturePreview(file, 0);
    const second = await getWADTexturePreview(file, 0);
    expect(second).toEqual(first);
    expect(await sharp(first!).metadata()).toMatchObject({
      format: "png",
      width: 8,
      height: 8,
    });
    expect(
      await readFile(join(cacheDirectory, "wad", file.sha256, "0.png")),
    ).toEqual(first);
    await expect(getWADTexturePreview(file, 1)).resolves.toBeNull();
  });

  test("does not materialize WAD textures as ordinary files", async () => {
    const result = await extractBspTextures({
      buffer: makeWAD3Texture(),
      fileName: "virtual.wad",
      parentFolderSlug: "maps/example",
      parentFolderId: "folder-1",
    });

    expect(result).toEqual({ textureCount: 0, folderId: null, errors: [] });
  });

  test("preserves recoverable WAD entry warnings and stable source indices", () => {
    const wad = makeWAD3Texture();
    wad[wad.length - 32 + 13] = 1;

    const contents = inspectWad(wad);

    expect(contents.lumpCount).toBe(1);
    expect(contents.textures).toEqual([]);
    expect(contents.warnings).toEqual([
      expect.objectContaining({
        code: "unsupported-wad-compression",
        lumpIndex: 0,
      }),
    ]);
  });
});
