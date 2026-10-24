import { describe, expect, it } from "vitest";

import {
  decodeWalTexture,
  readWalTextureHeader,
  MapsError,
} from "../src/core/index.js";

function syntheticWal(): Uint8Array {
  const dimensions = [16, 16] as const;
  const sizes = [256, 64, 16, 4];
  const result = new Uint8Array(
    100 + sizes.reduce((sum, size) => sum + size, 0),
  );
  const view = new DataView(result.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (const [index, character] of [...value].entries()) {
      result[offset + index] = character.charCodeAt(0);
    }
  };
  writeAscii(0, "e1u1/test");
  view.setUint32(32, dimensions[0], true);
  view.setUint32(36, dimensions[1], true);
  let offset = 100;
  for (let level = 0; level < sizes.length; level += 1) {
    view.setUint32(40 + level * 4, offset, true);
    result.fill(level + 1, offset, offset + sizes[level]!);
    offset += sizes[level]!;
  }
  writeAscii(56, "e1u1/test2");
  view.setUint32(88, 0x41, true);
  view.setUint32(92, 0x08000001, true);
  view.setUint32(96, 300, true);
  return result;
}

describe("Quake II WAL textures", () => {
  it("reads dimensions, animation, surface metadata, and mip offsets", () => {
    expect(readWalTextureHeader(syntheticWal())).toMatchObject({
      name: "e1u1/test",
      width: 16,
      height: 16,
      offsets: [100, 356, 420, 436],
      animationName: "e1u1/test2",
      flags: 0x41,
      contents: 0x08000001,
      value: 300,
    });
  });

  it("decodes every indexed mip through an explicit palette", () => {
    const palette = new Uint8Array(768);
    palette.set([10, 20, 30], 3);
    const decoded = decodeWalTexture(syntheticWal(), palette);

    expect(decoded.levels.map(({ width, height }) => [width, height])).toEqual([
      [16, 16],
      [8, 8],
      [4, 4],
      [2, 2],
    ]);
    expect(Array.from(decoded.levels[0]!.rgba.slice(0, 4))).toEqual([
      10, 20, 30, 255,
    ]);
  });

  it("rejects truncated pixel data and missing palettes", () => {
    expect(() => decodeWalTexture(syntheticWal(), new Uint8Array())).toThrow(
      MapsError,
    );
    expect(() =>
      decodeWalTexture(syntheticWal().slice(0, 120), new Uint8Array(768)),
    ).toThrow(/mip 0/);
  });

  it("rejects WAL dimensions that would require an excessive decoded allocation", () => {
    const bytes = syntheticWal();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(32, 8192, true);
    view.setUint32(36, 8192, true);

    expect(() => readWalTextureHeader(bytes)).toThrow(/decoded image limit/u);
  });

  it("rejects WAL dimensions wider than the portable WebGPU limit", () => {
    const bytes = syntheticWal();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(32, 16_384, true);
    view.setUint32(36, 8, true);

    expect(() => readWalTextureHeader(bytes)).toThrow(
      /portable WebGPU texture/u,
    );
  });
});
