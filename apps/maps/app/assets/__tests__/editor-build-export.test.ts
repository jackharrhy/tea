import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  buildExportEntries,
  modelAssetPaths,
  packageBuildExport,
  prepareBuildExport,
  previewSourceWithExportAssets,
  type BuildExportInput,
} from "../editor-build-export.ts";
import {
  syntheticGoldSrcSprite,
  syntheticGoldSrcSpriteBsp,
  syntheticQuakeBsp,
} from "../synthetic.ts";
import type { MapProject } from "../editor-project.ts";

function modelBsp(modelPath: string): ArrayBuffer {
  const source = syntheticQuakeBsp();
  const old = new DataView(source);
  const entities = new TextEncoder().encode(
    `{\n"classname" "worldspawn"\n}\n{\n"classname" "misc_model"\n"model" "${modelPath}"\n}\n\0`,
  );
  const headerSize = 124;
  const bytes = new Uint8Array(source);
  const output = new Uint8Array(source.byteLength + entities.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, old.getUint32(0, true), true);
  let cursor = headerSize;
  for (let index = 0; index < 15; index += 1) {
    cursor = (cursor + 3) & ~3;
    const offset = old.getUint32(4 + index * 8, true);
    const length = old.getUint32(8 + index * 8, true);
    const lump =
      index === 0 ? entities : bytes.subarray(offset, offset + length);
    view.setUint32(4 + index * 8, cursor, true);
    view.setUint32(8 + index * 8, lump.length, true);
    output.set(lump, cursor);
    cursor += lump.length;
  }
  return output.buffer.slice(0, cursor);
}

function model(
  signature: string,
  version: number,
  skins: string[] = [],
): ArrayBuffer {
  const bytes = new Uint8Array(
    (signature === "IDPO" ? 84 : 68) + skins.length * 64,
  );
  const view = new DataView(bytes.buffer);
  new TextEncoder().encodeInto(signature, bytes);
  view.setInt32(4, version, true);
  if (signature === "IDP2") {
    view.setInt32(20, skins.length, true);
    view.setInt32(44, 68, true);
    view.setInt32(64, bytes.length, true);
    skins.forEach((skin, index) =>
      new TextEncoder().encodeInto(skin, bytes.subarray(68 + index * 64)),
    );
  }
  return bytes.buffer;
}

function spriteModel(frames: string[]): ArrayBuffer {
  const bytes = new Uint8Array(12 + frames.length * 80);
  const view = new DataView(bytes.buffer);
  new TextEncoder().encodeInto("IDS2", bytes);
  view.setInt32(4, 2, true);
  view.setInt32(8, frames.length, true);
  frames.forEach((name, index) =>
    new TextEncoder().encodeInto(name, bytes.subarray(12 + index * 80 + 16)),
  );
  return bytes.buffer;
}

function studioModel(
  groupCount: number,
  separateTextures: boolean,
): ArrayBuffer {
  const bytes = new Uint8Array(244);
  const view = new DataView(bytes.buffer);
  new TextEncoder().encodeInto("IDST", bytes);
  view.setInt32(4, 10, true);
  view.setInt32(172, groupCount, true);
  view.setInt32(180, separateTextures ? 0 : 1, true);
  return bytes.buffer;
}

function spriteProject(): MapProject {
  const sprite = {
    kind: "file" as const,
    name: "Fixture.SPR",
    async getFile() {
      return new File(
        [new Uint8Array(syntheticGoldSrcSprite())],
        "Fixture.SPR",
      );
    },
  };
  const spriteDirectory = {
    kind: "directory" as const,
    name: "Sprites",
    async *entries() {
      yield ["Fixture.SPR", sprite] as const;
    },
  };
  const root = {
    kind: "directory" as const,
    name: "project",
    async *entries() {
      yield ["Sprites", spriteDirectory] as const;
    },
  };
  return {
    handle: root,
    manifest: { resources: { gameRoots: [], spriteRoots: ["sprites"] } },
  } as unknown as MapProject;
}

describe("build bundle export", () => {
  const input: BuildExportInput = {
    name: "Sprite room.map",
    bsp: syntheticGoldSrcSpriteBsp(),
    source: "// saved source",
    wads: [],
    gameAssets: new Map(),
    project: null,
  };

  it("requires referenced companion files before packaging", async () => {
    await expect(buildExportEntries(input, false)).rejects.toThrow(
      /sprites\/fixture\.spr/,
    );
  });

  it("packages a referenced sprite and optional source using project roots", async () => {
    const prepared = await prepareBuildExport({
      ...input,
      project: spriteProject(),
    });
    expect(prepared.project).toBeNull();
    const preview = previewSourceWithExportAssets({ bsp: input.bsp }, prepared);
    expect(preview.gameAssets).toHaveProperty("sprites/fixture.spr");
    const exported = await packageBuildExport(prepared, true);
    expect(exported.name).toBe("sprite_room.zip");
    const files = unzipSync(new Uint8Array(exported.data));
    expect(Object.keys(files).toSorted()).toEqual([
      "maps/sprite_room.bsp",
      "maps/sprite_room.map",
      "sprites/fixture.spr",
    ]);
    expect(new TextDecoder().decode(files["maps/sprite_room.map"])).toBe(
      "// saved source",
    );
  });

  it("includes a self-contained Quake model referenced by the BSP", async () => {
    const exported = await buildExportEntries(
      {
        ...input,
        bsp: modelBsp("progs/armor.mdl"),
        gameAssets: new Map([["progs/armor.mdl", model("IDPO", 6)]]),
      },
      false,
    );
    expect([...exported.files.keys()]).toContain("progs/armor.mdl");
  });

  it("reads Quake II model skins and rejects malformed or unsupported models", () => {
    expect(
      modelAssetPaths(
        "models/item.md2",
        model("IDP2", 8, ["models/skin.pcx", "models/skin.pcx"]),
      ),
    ).toEqual(["models/skin.pcx"]);
    expect(() =>
      modelAssetPaths("models/item.md2", model("IDP2", 8, ["../outside.pcx"])),
    ).toThrow(/unsafe game asset path/);
    expect(() => modelAssetPaths("models/item.mdl", model("IDXX", 10))).toThrow(
      /Unsupported model/,
    );
    expect(() =>
      modelAssetPaths("progs/armor.mdl", model("IDPO", 6).slice(0, 8)),
    ).toThrow(/Invalid model/);
  });

  it("packages referenced MD2 skins and requires each skin file", async () => {
    const bsp = modelBsp("models/item.md2");
    const md2 = model("IDP2", 8, ["models/item/skin.pcx"]);
    const withoutSkin = {
      ...input,
      bsp,
      gameAssets: new Map([["models/item.md2", md2]]),
    };
    await expect(buildExportEntries(withoutSkin, false)).rejects.toThrow(
      /models\/item\/skin\.pcx/,
    );
    const exported = await buildExportEntries(
      {
        ...withoutSkin,
        gameAssets: new Map([
          ["models/item.md2", md2],
          ["models/item/skin.pcx", new Uint8Array([1, 2, 3]).buffer],
        ]),
      },
      false,
    );
    expect([...exported.files.keys()]).toContain("models/item.md2");
    expect([...exported.files.keys()]).toContain("models/item/skin.pcx");
  });

  it("includes Quake II sprite frames and GoldSrc studio companions", async () => {
    const spriteFiles = await buildExportEntries(
      {
        ...input,
        bsp: modelBsp("sprites/flare.sp2"),
        gameAssets: new Map([
          ["sprites/flare.sp2", spriteModel(["pics/flare.pcx"])],
          ["pics/flare.pcx", new Uint8Array([1]).buffer],
        ]),
      },
      false,
    );
    expect([...spriteFiles.files.keys()]).toContain("pics/flare.pcx");

    const studioFiles = await buildExportEntries(
      {
        ...input,
        bsp: modelBsp("models/scientist.mdl"),
        gameAssets: new Map([
          ["models/scientist.mdl", studioModel(2, true)],
          ["models/scientistt.mdl", new Uint8Array([1]).buffer],
          ["models/scientist01.mdl", new Uint8Array([2]).buffer],
        ]),
      },
      false,
    );
    expect([...studioFiles.files.keys()]).toContain("models/scientistt.mdl");
    expect([...studioFiles.files.keys()]).toContain("models/scientist01.mdl");
  });

  it("stops export when a GoldSrc studio companion is missing", async () => {
    await expect(
      buildExportEntries(
        {
          ...input,
          bsp: modelBsp("models/scientist.mdl"),
          gameAssets: new Map([
            ["models/scientist.mdl", studioModel(2, true)],
            ["models/scientistt.mdl", new Uint8Array([1]).buffer],
          ]),
        },
        false,
      ),
    ).rejects.toThrow(/models\/scientist01\.mdl/);
  });
});
