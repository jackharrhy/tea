import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";
import { syntheticGoldSrcBsp } from "../../app/assets/synthetic.ts";

const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Steam BSP corpus extractor", () => {
  it("materializes bounded game-root asset classes with provenance", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "maps-corpus-"));
    temporaryDirectories.push(root);
    const source = path.join(root, "source");
    const output = path.join(root, "output");
    await Promise.all([
      mkdir(path.join(source, "baseq2", "maps"), { recursive: true }),
      mkdir(path.join(source, "baseq2", "textures", "unit"), {
        recursive: true,
      }),
      mkdir(path.join(source, "baseq2", "pics"), { recursive: true }),
      mkdir(path.join(source, "baseq2", "env"), { recursive: true }),
      mkdir(path.join(source, "baseq2", "sound"), { recursive: true }),
      mkdir(path.join(source, "id1", "gfx"), { recursive: true }),
      mkdir(path.join(source, "ricochet", "gfx", "env"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(source, "baseq2", "maps", "sample.bsp"), "bsp"),
      writeFile(
        path.join(source, "baseq2", "textures", "unit", "wall.jpg"),
        "image",
      ),
      writeFile(path.join(source, "baseq2", "pics", "colormap.pcx"), "palette"),
      writeFile(
        path.join(source, "baseq2", "env", "unitrt.tga"),
        "quake ii sky",
      ),
      writeFile(path.join(source, "baseq2", "sound", "ignored.wav"), "sound"),
      writeFile(
        path.join(source, "id1", "gfx", "palette.lmp"),
        "quake palette",
      ),
      writeFile(path.join(source, "ricochet", "ricochet.wad"), "goldsrc wad"),
      writeFile(
        path.join(source, "ricochet", "gfx", "env", "spacert.tga"),
        "goldsrc sky",
      ),
    ]);

    await execute(
      process.execPath,
      [
        path.join(repositoryRoot, "scripts", "extract-bsp-corpus.mjs"),
        "--output",
        output,
        "--source",
        `214700=${source}`,
      ],
      { cwd: repositoryRoot },
    );

    const manifest = JSON.parse(
      await readFile(path.join(output, "manifest.json"), "utf8"),
    ) as {
      readonly records: readonly {
        readonly entry: string;
        readonly outputPath: string;
      }[];
      readonly assets: readonly {
        readonly logicalPath: string;
        readonly outputPath: string;
        readonly sha256: string;
      }[];
    };
    expect(manifest.records.map(({ entry }) => entry)).toEqual([
      "baseq2/maps/sample.bsp",
    ]);
    expect(manifest.records.map(({ outputPath }) => outputPath)).toEqual([
      "214700/loose/baseq2/maps/sample.bsp",
    ]);
    expect(manifest.assets.map(({ logicalPath }) => logicalPath)).toEqual([
      "env/unitrt.tga",
      "gfx/env/spacert.tga",
      "gfx/palette.lmp",
      "pics/colormap.pcx",
      "ricochet.wad",
      "textures/unit/wall.jpg",
    ]);
    expect(
      manifest.assets.every(({ outputPath }) => !path.isAbsolute(outputPath)),
    ).toBe(true);
    expect(
      manifest.assets.every(({ sha256 }) => /^[a-f0-9]{64}$/u.test(sha256)),
    ).toBe(true);
  });

  it("checks extracted BSPs with Tea renderer and writes a compatibility report", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tea-maps-corpus-"));
    temporaryDirectories.push(root);
    const source = path.join(root, "source");
    const output = path.join(root, "output");
    await mkdir(path.join(source, "valve", "maps"), { recursive: true });
    await writeFile(
      path.join(source, "valve", "maps", "room.bsp"),
      new Uint8Array(syntheticGoldSrcBsp()),
    );
    await execute(
      process.execPath,
      [
        path.join(repositoryRoot, "scripts", "extract-bsp-corpus.mjs"),
        "--output",
        output,
        "--source",
        `70=${source}`,
      ],
      { cwd: repositoryRoot },
    );
    await execute(
      process.execPath,
      [
        path.join(repositoryRoot, "scripts", "check-bsp-corpus.mjs"),
        path.join(output, "manifest.json"),
      ],
      { cwd: repositoryRoot },
    );
    const report = JSON.parse(
      await readFile(path.join(output, "compatibility-report.json"), "utf8"),
    ) as {
      readonly total: number;
      readonly failures: readonly unknown[];
    };
    expect(report.total).toBe(1);
    expect(report.failures).toEqual([]);
  });
});
