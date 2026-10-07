import { expect, it } from "vitest";
import { materialMipmaps } from "../src/render/material-mipmaps.js";

it("averages a distant checkerboard instead of aliasing between black and white", () => {
  const pixels = new Uint8Array(4 * 4 * 4);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const offset = (y * 4 + x) * 4;
      pixels.fill((x + y) % 2 ? 255 : 0, offset, offset + 3);
      pixels[offset + 3] = 255;
    }
  const levels = materialMipmaps(4, 4, pixels);
  expect(levels.map((level) => level.length)).toEqual([64, 16, 4]);
  expect([...levels[2]!]).toEqual([128, 128, 128, 255]);
  expect(levels[0]).toBe(pixels);
});

it("includes odd edge texels and handles one-dimensional textures", () => {
  const pixels = new Uint8Array([
    0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255,
  ]);
  expect([...materialMipmaps(3, 1, pixels)[1]!]).toEqual([85, 85, 85, 255]);
  expect([...materialMipmaps(1, 3, pixels)[1]!]).toEqual([85, 85, 85, 255]);
});
