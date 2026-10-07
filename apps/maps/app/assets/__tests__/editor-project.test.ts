import { describe, expect, it } from "vitest";
import { encodeGoldSrcWad3, encodeQuakeWad2 } from "@tea/maps-editor/core";
import { createQuakePalette } from "@tea/maps-renderer/core";
import { openMapProject, type MapDirectoryHandle } from "../editor-project.ts";
import type { MapFileHandle } from "../editor-files.ts";

type FileEntry = MapFileHandle & { readonly kind: "file" };
type Entry = MapDirectoryHandle | FileEntry;

function file(name: string, content: string | Uint8Array = ""): FileEntry {
  return {
    kind: "file",
    name,
    async getFile() {
      return new File(
        [typeof content === "string" ? content : new Uint8Array(content)],
        name,
      );
    },
    async createWritable() {
      throw new Error("unused");
    },
  };
}

function directory(
  name: string,
  children: Record<string, Entry>,
): MapDirectoryHandle {
  return {
    kind: "directory",
    name,
    async getFileHandle(childName) {
      const child = children[childName];
      if (!child || child.kind !== "file") throw new Error("File not found");
      return child;
    },
    async getDirectoryHandle(childName) {
      const child = children[childName];
      if (!child || child.kind !== "directory") {
        throw new Error("Directory not found");
      }
      return child;
    },
    async *entries() {
      for (const entry of Object.entries(children)) yield entry;
    },
  };
}

function pcxPalette(): Uint8Array {
  const result = new Uint8Array(128 + 1 + 768);
  result[0] = 0x0a;
  result[2] = 1;
  result[3] = 8;
  result[65] = 1;
  result[128] = 0x0c;
  result.set([12, 34, 56], 129 + 3);
  result.set([20, 40, 60], 129 + 6);
  return result;
}

function walTexture(paletteIndex: number): Uint8Array {
  const sizes = [256, 64, 16, 4];
  const result = new Uint8Array(
    100 + sizes.reduce((sum, size) => sum + size, 0),
  );
  const view = new DataView(result.buffer);
  new TextEncoder().encodeInto("e1u1/test", result.subarray(0, 32));
  view.setUint32(32, 16, true);
  view.setUint32(36, 16, true);
  let offset = 100;
  for (const [level, size] of sizes.entries()) {
    view.setUint32(40 + level * 4, offset, true);
    result.fill(paletteIndex, offset, offset + size);
    offset += size;
  }
  return result;
}

function tgaPixel(red: number, green: number, blue: number): Uint8Array {
  const result = new Uint8Array(21);
  result[2] = 2;
  result[12] = 1;
  result[14] = 1;
  result[16] = 24;
  result[17] = 0x20;
  result.set([blue, green, red], 18);
  return result;
}

function goldSrcSprite(): Uint8Array {
  const result = new Uint8Array(40 + 2 + 768 + 4 + 16 + 4);
  const view = new DataView(result.buffer);
  view.setUint32(0, 0x5053_4449, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, 2, true);
  view.setUint32(12, 3, true);
  view.setInt32(20, 2, true);
  view.setInt32(24, 2, true);
  view.setInt32(28, 1, true);
  view.setUint32(36, 1, true);
  view.setUint16(40, 256, true);
  result.set([12, 34, 56], 42 + 3);
  const frameOffset = 42 + 768;
  view.setUint32(frameOffset, 0, true);
  view.setInt32(frameOffset + 4, -1, true);
  view.setInt32(frameOffset + 8, 1, true);
  view.setInt32(frameOffset + 12, 2, true);
  view.setInt32(frameOffset + 16, 2, true);
  result.set([1, 1, 1, 1], frameOffset + 20);
  return result;
}

const manifest = {
  schemaVersion: 1,
  name: "Test project",
  game: "quake",
  mapRoots: ["maps", "."],
  resources: { wads: [], spriteRoots: [], entityDefinitions: [] },
  buildProfiles: [],
};

describe("local map projects", () => {
  it("discovers nested maps once across overlapping roots", async () => {
    const maps = directory("maps", {
      "b.map": file("b.map"),
      sub: directory("sub", { "a.MAP": file("a.MAP") }),
      "notes.txt": file("notes.txt"),
    });
    const root = directory("project", {
      "worldview.project.json": file(
        "worldview.project.json",
        JSON.stringify(manifest),
      ),
      maps,
    });
    const project = await openMapProject(root);
    expect(project.manifest.name).toBe("Test project");
    expect(project.maps.map((map) => map.path)).toEqual([
      "maps/b.map",
      "maps/sub/a.MAP",
    ]);
  });

  it("rejects a map root that escapes the chosen folder", async () => {
    const root = directory("project", {
      "worldview.project.json": file(
        "worldview.project.json",
        JSON.stringify({ ...manifest, mapRoots: ["../private"] }),
      ),
    });
    await expect(openMapProject(root)).rejects.toThrow(
      "contained project-relative POSIX path",
    );
  });

  it("loads project FGD includes and resolves inherited entity properties", async () => {
    const root = directory("project", {
      "worldview.project.json": file(
        "worldview.project.json",
        JSON.stringify({
          ...manifest,
          mapRoots: ["maps"],
          resources: {
            ...manifest.resources,
            entityDefinitions: [{ path: "entities/main.fgd", format: "fgd" }],
          },
        }),
      ),
      maps: directory("maps", {}),
      entities: directory("entities", {
        "main.fgd": file(
          "main.fgd",
          '@include "base.fgd"\n@PointClass base(TargetBase) = light_test : "Test light" []',
        ),
        "base.fgd": file(
          "base.fgd",
          '@BaseClass = TargetBase [ targetname(target_source) : "Name" ]',
        ),
      }),
    });
    const project = await openMapProject(root);
    expect(project.definitionDiagnostics).toEqual([]);
    expect(project.definitions.find("light_test")?.properties).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "targetname" })]),
    );
  });

  it("reports an FGD include outside the selected folder", async () => {
    const root = directory("project", {
      "worldview.project.json": file(
        "worldview.project.json",
        JSON.stringify({
          ...manifest,
          mapRoots: ["maps"],
          resources: {
            ...manifest.resources,
            entityDefinitions: [{ path: "entities/main.fgd", format: "fgd" }],
          },
        }),
      ),
      maps: directory("maps", {}),
      entities: directory("entities", {
        "main.fgd": file("main.fgd", '@include "../outside.fgd"'),
      }),
    });
    const project = await openMapProject(root);
    expect(project.definitionDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          message: expect.stringContaining("escapes the project folder"),
        }),
      ]),
    );
  });

  it("loads project WAD textures and reports incompatible packs", async () => {
    const material = {
      name: "TEST_STONE",
      sourceName: "generated",
      width: 16,
      height: 16,
      rgba: new Uint8Array(16 * 16 * 4).fill(255),
      alphaTest: false,
    };
    const root = directory("project", {
      "worldview.project.json": file(
        "worldview.project.json",
        JSON.stringify({
          ...manifest,
          mapRoots: ["maps"],
          resources: {
            ...manifest.resources,
            wads: ["textures/stone.wad", "textures/wrong.wad"],
          },
        }),
      ),
      maps: directory("maps", {}),
      textures: directory("textures", {
        "stone.wad": file(
          "stone.wad",
          new Uint8Array(encodeQuakeWad2([material], createQuakePalette())),
        ),
        "wrong.wad": file(
          "wrong.wad",
          new Uint8Array(encodeGoldSrcWad3([material])),
        ),
      }),
    });
    const project = await openMapProject(root);
    expect(
      project.materials.some((candidate) => candidate.name === "TEST_STONE"),
    ).toBe(true);
    expect(project.materialDiagnostics).toEqual(
      expect.arrayContaining([
        expect.stringContaining("WAD3 is not supported by Quake"),
      ]),
    );
  });

  it("loads Quake II WAL textures from ordered game roots", async () => {
    const root = directory("project", {
      "worldview.project.json": file(
        "worldview.project.json",
        JSON.stringify({
          ...manifest,
          game: "quake2",
          mapRoots: ["maps"],
          resources: {
            ...manifest.resources,
            gameRoots: ["baseq2", "mod"],
          },
        }),
      ),
      maps: directory("maps", {}),
      baseq2: directory("baseq2", {
        pics: directory("pics", {
          "colormap.pcx": file("colormap.pcx", pcxPalette()),
        }),
        textures: directory("textures", {
          e1u1: directory("e1u1", {
            "test.wal": file("test.wal", walTexture(1)),
          }),
        }),
      }),
      mod: directory("mod", {
        textures: directory("textures", {
          e1u1: directory("e1u1", {
            "test.wal": file("test.wal", walTexture(2)),
          }),
        }),
      }),
    });
    const project = await openMapProject(root);
    expect(project.materialDiagnostics).toEqual([]);
    expect(
      project.materials
        .find((material) => material.name === "e1u1/test")
        ?.rgba.slice(0, 4),
    ).toEqual(new Uint8Array([20, 40, 60, 255]));
  });

  it("reports a missing palette for Quake II WAL textures", async () => {
    const root = directory("project", {
      "worldview.project.json": file(
        "worldview.project.json",
        JSON.stringify({
          ...manifest,
          game: "quake2",
          mapRoots: ["maps"],
          resources: { ...manifest.resources, gameRoots: ["baseq2"] },
        }),
      ),
      maps: directory("maps", {}),
      baseq2: directory("baseq2", {
        textures: directory("textures", {
          "test.wal": file("test.wal", walTexture(1)),
        }),
      }),
    });
    const project = await openMapProject(root);
    expect(project.materialDiagnostics).toEqual([
      expect.stringContaining("need pics/colormap.pcx"),
    ]);
  });

  it("uses an explicit palette before game-root palettes", async () => {
    const palette = new Uint8Array(768);
    palette.set([90, 100, 110], 3);
    const root = directory("project", {
      "worldview.project.json": file(
        "worldview.project.json",
        JSON.stringify({
          ...manifest,
          game: "quake2",
          mapRoots: ["maps"],
          resources: {
            ...manifest.resources,
            palette: "palette.lmp",
            gameRoots: ["baseq2"],
          },
        }),
      ),
      "palette.lmp": file("palette.lmp", palette),
      maps: directory("maps", {}),
      baseq2: directory("baseq2", {
        pics: directory("pics", {
          "colormap.pcx": file("colormap.pcx", new Uint8Array(8)),
        }),
        textures: directory("textures", {
          "test.wal": file("test.wal", walTexture(1)),
        }),
      }),
    });
    const project = await openMapProject(root);
    expect(project.materialDiagnostics).toEqual([]);
    expect(
      project.materials
        .find((material) => material.name === "e1u1/test")
        ?.rgba.slice(0, 4),
    ).toEqual(new Uint8Array([90, 100, 110, 255]));
  });

  it("replaces WAL pixels with a later TGA while retaining WAL texture scale", async () => {
    const root = directory("project", {
      "worldview.project.json": file(
        "worldview.project.json",
        JSON.stringify({
          ...manifest,
          game: "quake2",
          mapRoots: ["maps"],
          resources: { ...manifest.resources, gameRoots: ["baseq2", "mod"] },
        }),
      ),
      maps: directory("maps", {}),
      baseq2: directory("baseq2", {
        pics: directory("pics", {
          "colormap.pcx": file("colormap.pcx", pcxPalette()),
        }),
        textures: directory("textures", {
          e1u1: directory("e1u1", {
            "test.wal": file("test.wal", walTexture(1)),
            "test.tga": file("test.tga", tgaPixel(10, 20, 30)),
          }),
        }),
      }),
      mod: directory("mod", {
        textures: directory("textures", {
          e1u1: directory("e1u1", {
            "test.tga": file("test.tga", tgaPixel(40, 50, 60)),
          }),
        }),
      }),
    });
    const project = await openMapProject(root);
    expect(project.materialDiagnostics).toEqual([]);
    expect(
      project.materials.find((material) => material.name === "e1u1/test"),
    ).toMatchObject({
      sourceName: "mod/textures/e1u1/test.tga",
      width: 1,
      height: 1,
      logicalWidth: 16,
      logicalHeight: 16,
      rgba: new Uint8Array([40, 50, 60, 255]),
    });
  });

  it("loads nested project sprites while reporting damaged files and missing roots", async () => {
    const root = directory("project", {
      "worldview.project.json": file(
        "worldview.project.json",
        JSON.stringify({
          ...manifest,
          mapRoots: ["maps"],
          resources: {
            ...manifest.resources,
            spriteRoots: ["sprites", "missing"],
          },
        }),
      ),
      maps: directory("maps", {}),
      sprites: directory("sprites", {
        nested: directory("nested", {
          "light.spr": file("light.spr", goldSrcSprite()),
        }),
        "bad.spr": file("bad.spr", "not a sprite"),
      }),
    });
    const project = await openMapProject(root);
    expect(project.sprites).toEqual([
      expect.objectContaining({
        path: "sprites/nested/light.spr",
        material: expect.objectContaining({
          width: 2,
          height: 2,
          alphaTest: true,
        }),
      }),
    ]);
    expect(project.spriteDiagnostics).toEqual([
      expect.stringContaining("sprites/bad.spr"),
      expect.stringContaining("missing:"),
    ]);
  });
});
