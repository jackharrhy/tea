import { BinaryView } from "./binary.js";
import { invariant } from "./errors.js";
import type { MipTextureHeader } from "./miptex.js";
import type { ParsedMipTexture } from "./types.js";

export function parseMipTexturePayload(
  texture: BinaryView,
  header: MipTextureHeader,
  sourceIndex: number,
  embeddedPalette: boolean,
): ParsedMipTexture | undefined {
  if (header.offsets[0] === 0) return undefined;
  let end = 40;
  for (let level = 0; level < 4; level += 1) {
    const width = Math.max(1, header.width >> level);
    const height = Math.max(1, header.height >> level);
    const mipOffset = header.offsets[level] ?? 0;
    invariant(
      mipOffset >= end,
      `MIPTEX ${header.name} mip ${level} overlaps prior data`,
    );
    const byteLength = width * height;
    texture.require(
      mipOffset,
      byteLength,
      `MIPTEX ${header.name} mip ${level}`,
    );
    end = mipOffset + byteLength;
  }
  if (embeddedPalette) {
    texture.require(end, 2 + 256 * 3, `MIPTEX ${header.name} palette`);
    invariant(
      texture.u16(end) === 256,
      `MIPTEX ${header.name} has an invalid palette size`,
    );
    end += 2 + 256 * 3;
  }
  return {
    sourceIndex,
    name: header.name,
    width: header.width,
    height: header.height,
    data: texture.uint8Array(0, end).slice(),
  };
}
