import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  getBspDependencyPath,
  inspectBspDependencies,
  readBspDependencyManifest,
} from "#lib/bsp-derivatives.server";

const manifestTestDirectory = join(
  process.cwd(),
  "public/uploads/_manifest-test",
);

afterEach(() => rm(manifestTestDirectory, { recursive: true, force: true }));

describe("BSP derivative analysis", () => {
  test("persists Maps format, warnings, and canonical asset plan", async () => {
    const fixture = await readFile(
      new URL("./fixtures/dm_barraco2.bsp", import.meta.url),
    );
    const manifest = inspectBspDependencies(fixture);

    expect(manifest).toMatchObject({ format: "quake-bsp29", version: 29 });
    expect(manifest.assets.wads.length).toBeGreaterThan(0);
    const candidates = manifest.assets.wads.flatMap(
      (asset) => asset.candidates,
    );
    expect(candidates).toEqual([...new Set(candidates)]);
    expect(candidates.every((name) => name === name.toLowerCase())).toBe(true);
    expect(
      manifest.assets.sounds.every((asset) => asset.origin === "map"),
    ).toBe(true);
  });

  test("rejects incomplete or format-inconsistent persisted plans", async () => {
    await mkdir(manifestTestDirectory, { recursive: true });
    const path = "_manifest-test/example.bsp";
    const dependencyPath = getBspDependencyPath(path);
    const base = {
      format: "quake-bsp29",
      version: 29,
      warnings: [],
      assets: {
        palette: null,
        wads: [],
        textures: [],
        skybox: null,
        sprites: [],
        sounds: [],
      },
    };

    await writeFile(dependencyPath, JSON.stringify({ ...base, version: 38 }));
    await expect(readBspDependencyManifest(path)).resolves.toBeNull();

    await writeFile(
      dependencyPath,
      JSON.stringify({
        ...base,
        assets: {
          ...base.assets,
          sprites: [{ kind: "sprite", candidates: ["sprites/a.spr"] }],
        },
      }),
    );
    await expect(readBspDependencyManifest(path)).resolves.toBeNull();
  });
});
