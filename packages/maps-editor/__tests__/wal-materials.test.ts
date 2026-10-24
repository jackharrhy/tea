import { describe, expect, it } from "vitest";

import { EditorMaterialCatalog } from "../src/core/index.js";

function syntheticWal(): Uint8Array {
  const sizes = [256, 64, 16, 4];
  const result = new Uint8Array(
    100 + sizes.reduce((sum, size) => sum + size, 0),
  );
  const view = new DataView(result.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (const [index, character] of Array.from(value).entries()) {
      result[offset + index] = character.charCodeAt(0);
    }
  };
  writeAscii(0, "e1u1/test");
  view.setUint32(32, 16, true);
  view.setUint32(36, 16, true);
  let offset = 100;
  for (let level = 0; level < sizes.length; level += 1) {
    view.setUint32(40 + level * 4, offset, true);
    result.fill(1, offset, offset + sizes[level]!);
    offset += sizes[level]!;
  }
  writeAscii(56, "e1u1/test2");
  view.setUint32(88, 0x41, true);
  view.setUint32(92, 0x08000001, true);
  view.setUint32(96, 300, true);
  return result;
}

describe("Quake II WAL editor materials", () => {
  it("imports decoded pixels and reports WAL metadata without hiding it in the renderer", () => {
    const catalog = new EditorMaterialCatalog();
    const palette = new Uint8Array(768);
    palette.set([12, 34, 56], 3);
    const result = catalog.importWal(
      "textures/e1u1/test.wal",
      syntheticWal(),
      palette,
    );

    expect(result).toMatchObject({
      materialName: "e1u1/test",
      animationName: "e1u1/test2",
      surface: { flags: 0x41, contents: 0x08000001, value: 300 },
      added: 1,
      replaced: 0,
      skipped: 0,
      diagnostics: [],
    });
    expect(catalog.find("E1U1/TEST")).toMatchObject({
      width: 16,
      height: 16,
      alphaTest: false,
    });
    expect(Array.from(catalog.find("e1u1/test")!.rgba.slice(0, 4))).toEqual([
      12, 34, 56, 255,
    ]);
  });

  it("returns a diagnostic for malformed WAL data", () => {
    const result = new EditorMaterialCatalog().importWal(
      "broken.wal",
      new Uint8Array(8),
      new Uint8Array(768),
    );

    expect(result).toMatchObject({
      added: 0,
      replaced: 0,
      skipped: 1,
      diagnostics: [{ severity: "warning", sourceName: "broken.wal" }],
    });
  });
});
