import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import { loadWorldAssets, resolveWorldSource } from "../src/viewer/assets.js";
import type { ProgressDetail } from "../src/viewer/types.js";
import {
  makeBsp,
  makeBsp38,
  makeMipTexture,
  makePalette,
  makePcxPalette,
  makeSprite,
  makeTga,
  makeWad,
  makeWave,
  makeWal,
} from "./fixtures.js";

function assetContext() {
  return {
    fetch: async () => new Response("not found", { status: 404 }),
    signal: new AbortController().signal,
    progress: () => undefined,
  };
}

describe("asset resolution", () => {
  it("loads BSP29 with the included standard Quake palette", async () => {
    const loaded = await loadWorldAssets(
      { bsp: makeBsp({ version: 29 }) },
      assetContext(),
    );
    expect(createHash("sha256").update(loaded.palette!).digest("hex")).toBe(
      "6b20b5bc4ea965ef1852b05670d043ca16148a0ecad4e63028121c8aebc268fe",
    );
  });

  it("does not misclassify a raw palette whose first byte matches the PCX manufacturer", async () => {
    const palette = new Uint8Array(900);
    palette.set(makePalette());
    palette[0] = 0x0a;

    const loaded = await loadWorldAssets(
      { bsp: makeBsp({ version: 29 }), palette },
      assetContext(),
    );

    expect(loaded.palette).toEqual(palette.slice(0, 768));
  });

  it("prefers explicit palettes over game-root palettes, and both over the bundled default", async () => {
    const gamePalette = makePalette();
    const source = {
      bsp: makeBsp({ version: 29 }),
      gameAssets: { "gfx/palette.lmp": gamePalette },
    };
    expect((await loadWorldAssets(source, assetContext())).palette).toEqual(
      gamePalette,
    );
    const explicit = new Uint8Array(768).fill(120);
    expect(
      (await loadWorldAssets({ ...source, palette: explicit }, assetContext()))
        .palette,
    ).toEqual(explicit);
  });

  it("starts independent sprite and sound resolvers concurrently", async () => {
    const started = new Set<string>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loading = loadWorldAssets(
      {
        bsp: makeBsp({
          entityText:
            '{ "classname" "worldspawn" }\n{ "classname" "env_sprite" "model" "sprites/test.spr" }\n{ "classname" "ambient_generic" "message" "ambience/test.wav" }',
        }),
        resolveSprite: async () => {
          started.add("sprite");
          await gate;
          return makeSprite();
        },
        resolveSound: async (reference) => {
          if (reference.normalizedPath !== "ambience/test.wav") return null;
          started.add("sound");
          await gate;
          return makeWave();
        },
      },
      assetContext(),
    );
    await vi.waitFor(() =>
      expect(started).toEqual(new Set(["sprite", "sound"])),
    );
    release();
    const loaded = await loading;
    expect(loaded.sprites).toHaveLength(1);
    expect(loaded.sounds.size).toBe(1);
  });

  it("starts explicit WAD and palette requests without waiting for the BSP", async () => {
    const started = new Set<string>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const payloads = new Map<string, Uint8Array>([
      ["https://example.test/map.bsp", makeBsp({ embeddedTexture: false })],
      ["https://example.test/palette.lmp", makePalette()],
      [
        "https://example.test/textures.wad",
        makeWad(3, makeMipTexture(30, "brick"), "brick"),
      ],
    ]);
    const loading = loadWorldAssets(
      {
        bsp: "https://example.test/map.bsp",
        palette: "https://example.test/palette.lmp",
        wads: ["https://example.test/textures.wad"],
      },
      {
        ...assetContext(),
        async fetch(input) {
          const url = String(input);
          started.add(url);
          await gate;
          return new Response(payloads.get(url)!.buffer as ArrayBuffer);
        },
      },
    );

    await vi.waitFor(() => expect(started).toEqual(new Set(payloads.keys())));
    release();
    const loaded = await loading;
    expect(loaded.palette).toHaveLength(768);
    expect(loaded.missingTextures).toEqual([]);
  });

  it("cancels the BSP request when a concurrent explicit palette fails", async () => {
    let bspAborted = false;
    const loading = loadWorldAssets(
      {
        bsp: "https://example.test/map.bsp",
        palette: "https://example.test/palette.lmp",
      },
      {
        ...assetContext(),
        fetch(input, init) {
          if (String(input).endsWith("palette.lmp")) {
            return Promise.resolve(new Response(new Uint8Array(1)));
          }
          const signal = init?.signal;
          return new Promise<Response>((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => {
                bspAborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          });
        },
      },
    );

    await expect(loading).rejects.toMatchObject({ code: "missing-palette" });
    expect(bspAborted).toBe(true);
  });

  it("keeps resolver WAD discovery parse-dependent", async () => {
    let releaseBsp!: () => void;
    const bspGate = new Promise<void>((resolve) => {
      releaseBsp = resolve;
    });
    const resolver = vi.fn(async () => makeWad(3));
    const loading = loadWorldAssets(
      {
        bsp: "https://example.test/map.bsp",
        resolveWad: resolver,
      },
      {
        ...assetContext(),
        async fetch() {
          await bspGate;
          return new Response(
            makeBsp({ embeddedTexture: false }).buffer as ArrayBuffer,
          );
        },
      },
    );

    await Promise.resolve();
    expect(resolver).not.toHaveBeenCalled();
    releaseBsp();
    await loading;
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("reports stable aggregate completion for concurrent WAD transfers", async () => {
    const progress: ProgressDetail[] = [];
    await loadWorldAssets(
      {
        bsp: makeBsp(),
        wads: [makeWad(3), makeWad(3)],
      },
      { ...assetContext(), progress: (detail) => progress.push(detail) },
    );

    expect(
      progress
        .filter((detail) => detail.phase === "wad" && detail.phaseProgress)
        .map((detail) => detail.phaseProgress),
    ).toContainEqual({ completed: 2, total: 2 });
  });

  it("does not publish an aggregate total until parse-dependent WAD candidates are known", async () => {
    const progress: ProgressDetail[] = [];
    await loadWorldAssets(
      {
        bsp: makeBsp(),
        wads: [makeWad(3)],
        resolveWad: async () => makeWad(3),
      },
      { ...assetContext(), progress: (detail) => progress.push(detail) },
    );

    const aggregate = progress.flatMap((detail) =>
      detail.phase === "wad" && detail.phaseProgress
        ? [detail.phaseProgress]
        : [],
    );
    expect(new Set(aggregate.map(({ total }) => total))).toEqual(new Set([3]));
    expect(aggregate).toContainEqual({ completed: 3, total: 3 });
  });

  it("prefers embedded textures over explicit WADs", async () => {
    const replacement = makeMipTexture(30, "brick");
    replacement[40] = 211;
    const loaded = await loadWorldAssets(
      { bsp: makeBsp(), wads: [makeWad(3, replacement, "brick")] },
      assetContext(),
    );
    expect(loaded.materialTextures.get(0)?.texture.levels[0]?.rgba[0]).toBe(0);
  });

  it("uses explicit WADs in caller order for external textures", async () => {
    const first = makeMipTexture(30, "brick");
    const second = makeMipTexture(30, "brick");
    first[40] = 31;
    second[40] = 97;
    const loaded = await loadWorldAssets(
      {
        bsp: makeBsp({ embeddedTexture: false }),
        wads: [makeWad(3, first, "brick"), makeWad(3, second, "brick")],
      },
      assetContext(),
    );
    expect(loaded.materialTextures.get(0)?.texture.levels[0]?.rgba[0]).toBe(31);
    expect(loaded.missingTextures).toEqual([]);
  });

  it("surfaces recoverable WAD entry warnings without rejecting the archive", async () => {
    const wad = makeWad(3);
    const directory = new DataView(wad.buffer).getUint32(8, true);
    wad[directory + 13] = 1;
    const loaded = await loadWorldAssets(
      { bsp: makeBsp({ embeddedTexture: false }), wads: [wad] },
      assetContext(),
    );

    expect(loaded.warnings).toContainEqual(
      expect.objectContaining({
        code: "asset-warning",
        message: expect.stringContaining("unsupported compression"),
      }),
    );
    expect(loaded.warnings.some(({ code }) => code === "missing-wad")).toBe(
      false,
    );
  });

  it("loads all six GoldSrc skybox faces from explicit TGA sources", async () => {
    const face = makeTga();
    const loaded = await loadWorldAssets(
      {
        bsp: makeBsp({
          entityText: '{ "classname" "worldspawn" "skyname" "space" }',
        }),
        skybox: { rt: face, bk: face, lf: face, ft: face, up: face, dn: face },
      },
      assetContext(),
    );
    expect(loaded.skybox).toMatchObject({ name: "space" });
    expect(loaded.skybox?.sides.up).toMatchObject({ width: 2, height: 1 });
  });

  it("loads Quake II WALs, PCX palette, and env skyboxes from logical game assets", async () => {
    const face = makeTga();
    const gameAssets = Object.fromEntries([
      ["PICS/COLORMAP.PCX", makePcxPalette()],
      ["TEXTURES/E1U1/FIXTURE.WAL", makeWal()],
      ...(["rt", "bk", "lf", "ft", "up", "dn"] as const).map(
        (suffix) => [`ENV/UNIT1_${suffix}.TGA`, face] as const,
      ),
    ]);
    const loaded = await loadWorldAssets(
      { bsp: makeBsp38(), gameAssets },
      assetContext(),
    );

    expect(loaded.palette).toEqual(makePalette());
    expect(loaded.materialTextures.get(0)).toMatchObject({
      logicalWidth: 16,
      logicalHeight: 16,
      texture: { width: 16, height: 16 },
    });
    expect(
      loaded.materialTextures.get(0)?.texture.levels[0]?.rgba.slice(0, 4),
    ).toEqual(new Uint8Array([7, 248, 49, 255]));
    expect(loaded.skybox).toMatchObject({ name: "unit1_" });
    expect(loaded.missingTextures).toEqual([]);
  });

  it("starts independent Quake II skybox face lookups concurrently", async () => {
    const started = new Set<string>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loading = loadWorldAssets(
      {
        bsp: makeBsp38(),
        resolveGameAsset: async ({ path }) => {
          if (path === "pics/colormap.pcx") return makePcxPalette();
          if (path === "textures/e1u1/fixture.wal") return makeWal();
          if (/^env\/.+\.png$/u.test(path)) {
            started.add(path);
            await gate;
            return null;
          }
          if (/^env\/.+\.tga$/u.test(path)) return makeTga();
          return null;
        },
      },
      assetContext(),
    );

    await vi.waitFor(() => expect(started.size).toBe(6));
    release();
    await expect(loading).resolves.toMatchObject({
      skybox: { name: "unit1_" },
    });
  });

  it("prefers a Quake II replacement image while preserving companion WAL dimensions", async () => {
    const loaded = await loadWorldAssets(
      {
        bsp: makeBsp38(),
        gameAssets: {
          "pics/colormap.pcx": makePcxPalette(),
          "textures/e1u1/fixture.wal": makeWal(),
          "textures/e1u1/fixture.tga": makeTga(),
        },
      },
      assetContext(),
    );

    expect(loaded.materialTextures.get(0)).toMatchObject({
      logicalWidth: 16,
      logicalHeight: 16,
      texture: { width: 2, height: 1 },
    });
  });

  it("warns about a malformed replacement and falls back to a valid WAL", async () => {
    const loaded = await loadWorldAssets(
      {
        bsp: makeBsp38(),
        gameAssets: {
          "pics/colormap.pcx": makePcxPalette(),
          "textures/e1u1/fixture.wal": makeWal(),
          "textures/e1u1/fixture.tga": new Uint8Array([1, 2, 3]),
        },
      },
      assetContext(),
    );

    expect(loaded.materialTextures.get(0)?.texture.width).toBe(16);
    expect(loaded.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "asset-warning",
          message: expect.stringContaining("fixture.tga could not be decoded"),
        }),
      ]),
    );
  });

  it("loads Quake II rerelease aliases from the canonical asset plan", async () => {
    const loaded = await loadWorldAssets(
      {
        bsp: makeBsp38({ textureName: "+0E1U1/Fixture" }),
        gameAssets: {
          "pics/colormap.pcx": makePcxPalette(),
          "textures/_0e1u1/fixture.wal": makeWal(),
        },
      },
      assetContext(),
    );

    expect(loaded.materialTextures.get(0)?.logicalWidth).toBe(16);
    expect(loaded.missingTextures).toEqual([]);
  });

  it("resolves Quake II assets through the storage-neutral logical resolver", async () => {
    const requests: Array<{ readonly path: string; readonly kind: string }> =
      [];
    const loaded = await loadWorldAssets(
      {
        bsp: makeBsp38(),
        resolveGameAsset: (reference) => {
          requests.push(reference);
          if (reference.path === "pics/colormap.pcx") return makePcxPalette();
          if (reference.path === "textures/e1u1/fixture.wal") return makeWal();
          if (/^env\/unit1_(?:rt|bk|lf|ft|up|dn)\.tga$/u.test(reference.path)) {
            return makeTga();
          }
          return null;
        },
      },
      assetContext(),
    );

    expect(loaded.missingTextures).toEqual([]);
    expect(requests).toContainEqual({
      path: "pics/colormap.pcx",
      kind: "palette",
    });
    expect(requests).toContainEqual({
      path: "textures/e1u1/fixture.wal",
      kind: "texture",
    });
    expect(requests).toContainEqual({
      path: "env/unit1_up.tga",
      kind: "skybox",
    });
  });

  it("rejects game asset keys that escape the logical game root", async () => {
    await expect(
      loadWorldAssets(
        {
          bsp: makeBsp38(),
          gameAssets: { "../pics/colormap.pcx": makePcxPalette() },
        },
        assetContext(),
      ),
    ).rejects.toThrow(/unsafe game asset path/);
  });

  it("resolves and parses sprite entities from explicit caller assets", async () => {
    const loaded = await loadWorldAssets(
      {
        bsp: makeBsp({
          entityText:
            '{ "classname" "worldspawn" }\n{ "classname" "env_sprite" "model" "sprites/statue.spr" "origin" "10 20 30" "scale" "0.5" "rendermode" "2" }',
        }),
        sprites: { "statue.spr": makeSprite() },
      },
      assetContext(),
    );
    expect(loaded.sprites[0]).toMatchObject({
      entityIndex: 1,
      origin: [10, 20, 30],
      scale: 0.5,
      renderMode: 2,
    });
    expect(loaded.missingSprites).toEqual([]);
  });

  it("samples the BSP lightmap below eligible alpha-test sprites", async () => {
    const loaded = await loadWorldAssets(
      {
        bsp: makeBsp({
          entityText:
            '{ "classname" "worldspawn" }\n{ "classname" "env_sprite" "model" "sprites/lit.spr" "origin" "8 8 30" "rendermode" "2" "renderamt" "255" }',
        }),
        sprites: { "lit.spr": makeSprite() },
      },
      assetContext(),
    );
    expect(loaded.sprites[0]).toMatchObject({
      receivesLight: true,
      lightColor: [128, 128, 128],
    });
  });

  it("warns once when a shared sprite cannot be resolved", async () => {
    const loaded = await loadWorldAssets(
      {
        bsp: makeBsp({
          entityText:
            '{ "classname" "worldspawn" }\n{ "classname" "env_glow" "model" "sprites/missing.spr" }\n{ "classname" "env_sprite" "model" "sprites/missing.spr" }',
        }),
      },
      assetContext(),
    );
    expect(loaded.sprites).toEqual([]);
    expect(loaded.missingSprites).toEqual(["sprites/missing.spr"]);
    expect(
      loaded.warnings.filter((warning) => warning.code === "missing-sprite"),
    ).toHaveLength(1);
  });

  it("loads each shared ambient WAV once from explicit caller assets", async () => {
    const loaded = await loadWorldAssets(
      {
        bsp: makeBsp({
          entityText:
            '{ "classname" "worldspawn" }\n{ "classname" "ambient_generic" "message" "Ambience/hum.wav" }\n{ "classname" "ambient_generic" "message" "ambience/HUM.wav" }',
        }),
        sounds: { "hum.wav": makeWave() },
      },
      assetContext(),
    );
    expect(loaded.sounds.size).toBe(1);
    expect(loaded.missingSounds).toEqual([]);
  });

  it("loads supplied GoldSrc player samples separately from ambient emitters", async () => {
    const loaded = await loadWorldAssets(
      {
        bsp: makeBsp(),
        sounds: {
          "player/pl_step1.wav": makeWave(),
          "player/pl_step2.wav": makeWave(),
        },
      },
      assetContext(),
    );
    expect(loaded.sounds.size).toBe(0);
    expect([...loaded.playerSounds.keys()]).toEqual([
      "player/pl_step1.wav",
      "player/pl_step2.wav",
    ]);
    expect(loaded.missingSounds).toEqual([]);
  });

  it("keeps ambient_music encoded for browser codec decoding", async () => {
    const encoded = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0]);
    const loaded = await loadWorldAssets(
      {
        bsp: makeBsp({
          entityText:
            '{ "classname" "worldspawn" }\n{ "classname" "ambient_music" "message" "music/theme.mp3" }',
        }),
        sounds: { "theme.mp3": encoded },
      },
      assetContext(),
    );
    expect(new Uint8Array(loaded.music.get("music/theme.mp3")!.data)).toEqual(
      encoded,
    );
    expect(loaded.sounds.size).toBe(0);
    expect(loaded.missingMusic).toEqual([]);
  });

  it("warns once when a shared ambient WAV cannot be resolved", async () => {
    const loaded = await loadWorldAssets(
      {
        bsp: makeBsp({
          entityText:
            '{ "classname" "worldspawn" }\n{ "classname" "ambient_generic" "message" "missing.wav" }\n{ "classname" "ambient_generic" "message" "MISSING.wav" }',
        }),
      },
      assetContext(),
    );
    expect(loaded.missingSounds).toEqual(["missing.wav"]);
    expect(
      loaded.warnings.filter((warning) => warning.code === "missing-sound"),
    ).toHaveLength(1);
  });

  it("reports missing map music independently from positional sounds", async () => {
    const loaded = await loadWorldAssets(
      {
        bsp: makeBsp({
          entityText:
            '{ "classname" "worldspawn" }\n{ "classname" "ambient_music" "message" "missing.mp3" }',
        }),
      },
      assetContext(),
    );
    expect(loaded.missingMusic).toEqual(["missing.mp3"]);
    expect(loaded.missingSounds).toEqual([]);
    expect(loaded.warnings[0]?.message).toContain("music missing.mp3");
  });
});

describe("game-root asset resolution", () => {
  it("derives the conventional game directories and keeps explicit overrides", () => {
    const source = resolveWorldSource({
      gameBaseUrl: "https://example.test/cstrike/",
      bsp: "maps/de_fixture.bsp",
      soundBaseUrl: "https://cdn.example.test/audio/",
    });
    expect(String(source.bsp)).toBe(
      "https://example.test/cstrike/maps/de_fixture.bsp",
    );
    expect(String(source.wadBaseUrl)).toBe("https://example.test/cstrike/");
    expect(String(source.skyboxBaseUrl)).toBe(
      "https://example.test/cstrike/gfx/env/",
    );
    expect(String(source.spriteBaseUrl)).toBe("https://example.test/cstrike/");
    expect(String(source.soundBaseUrl)).toBe("https://cdn.example.test/audio/");
  });
});
