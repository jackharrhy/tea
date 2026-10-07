/*
 * MIPTEX decoding behavior adapted from noclip.website's Common/IdTech2/Render.ts
 * and Quake.ts. See THIRD_PARTY_NOTICES.md and docs/plan.md for provenance.
 */

import { BinaryView } from "./binary.js";
import { invalidData, invariant } from "./errors.js";
import { validateTextureDimensions } from "./texture-limits.js";
import type {
  DecodedMipLevel,
  DecodedMipTexture,
  DecodedQuakeSky,
} from "./types.js";

const MIP_LEVEL_COUNT = 4;

export interface MipTextureHeader {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly offsets: readonly number[];
}

export function readMipTextureHeader(
  input: ArrayBuffer | ArrayBufferView,
): MipTextureHeader {
  const source = new BinaryView(input);
  invariant(source.byteLength >= 40, "MIPTEX header is truncated");
  const name = source.string(0, 16, true);
  const width = source.u32(16);
  const height = source.u32(20);
  validateTextureDimensions(width, height, `MIPTEX ${name}`);
  const offsets = Array.from({ length: MIP_LEVEL_COUNT }, (_, index) =>
    source.u32(24 + index * 4),
  );
  return { name, width, height, offsets };
}

function paletteFor(
  source: BinaryView,
  header: MipTextureHeader,
  externalPalette?: Uint8Array,
): Uint8Array {
  if (externalPalette) {
    invariant(
      externalPalette.byteLength >= 256 * 3,
      "external Quake palette must contain 768 bytes",
    );
    return externalPalette.subarray(0, 256 * 3);
  }

  const lastWidth = Math.max(1, header.width >> 3);
  const lastHeight = Math.max(1, header.height >> 3);
  const paletteOffset = (header.offsets[3] ?? 0) + lastWidth * lastHeight;
  source.require(paletteOffset, 2 + 256 * 3, `MIPTEX ${header.name} palette`);
  invariant(
    source.u16(paletteOffset) === 256,
    `MIPTEX ${header.name} palette has an invalid size`,
  );
  return source.uint8Array(paletteOffset + 2, 256 * 3);
}

export function decodeMipTexture(
  input: ArrayBuffer | ArrayBufferView,
  externalPalette?: Uint8Array,
): DecodedMipTexture {
  const source = new BinaryView(input);
  const header = readMipTextureHeader(input);
  const palette = paletteFor(source, header, externalPalette);
  const alphaTest = header.name.startsWith("{");
  const levels: DecodedMipLevel[] = [];

  for (let index = 0; index < MIP_LEVEL_COUNT; index += 1) {
    const width = Math.max(1, header.width >> index);
    const height = Math.max(1, header.height >> index);
    const offset = header.offsets[index] ?? 0;
    invariant(offset !== 0, `MIPTEX ${header.name} has no embedded pixels`);
    source.require(
      offset,
      width * height,
      `MIPTEX ${header.name} mip ${index}`,
    );
    const indexed = source.uint8Array(offset, width * height);
    const rgba = new Uint8Array(width * height * 4);
    let fullbrightRgba: Uint8Array | undefined;
    for (let pixel = 0; pixel < indexed.length; pixel += 1) {
      const paletteIndex = indexed[pixel] ?? 0;
      const destination = pixel * 4;
      if (alphaTest && paletteIndex === 255) {
        rgba[destination + 3] = 0;
      } else {
        rgba[destination] = palette[paletteIndex * 3] ?? 0;
        rgba[destination + 1] = palette[paletteIndex * 3 + 1] ?? 0;
        rgba[destination + 2] = palette[paletteIndex * 3 + 2] ?? 0;
        rgba[destination + 3] = 255;
        if (externalPalette && paletteIndex >= 224) {
          fullbrightRgba ??= new Uint8Array(rgba.length);
          fullbrightRgba.set(
            rgba.subarray(destination, destination + 4),
            destination,
          );
        }
      }
    }
    levels.push({
      width,
      height,
      rgba,
      ...(fullbrightRgba ? { fullbrightRgba } : {}),
    });
  }

  return {
    name: header.name,
    width: header.width,
    height: header.height,
    levels,
    alphaTest,
  };
}

export function decodeQuakeSky(
  input: ArrayBuffer | ArrayBufferView,
  palette: Uint8Array,
): DecodedQuakeSky {
  const source = new BinaryView(input);
  const header = readMipTextureHeader(input);
  invariant(
    palette.byteLength >= 768,
    "Quake sky palette must contain 768 bytes",
  );
  invariant(
    header.width % 2 === 0,
    `Quake sky ${header.name} width must be even`,
  );
  const halfWidth = header.width / 2;
  const offset = header.offsets[0] ?? 0;
  if (offset === 0)
    invalidData(`Quake sky ${header.name} has no embedded pixels`);
  source.require(
    offset,
    header.width * header.height,
    `Quake sky ${header.name} pixels`,
  );
  const pixels = source.uint8Array(offset, header.width * header.height);
  const solid = new Uint8Array(halfWidth * header.height * 4);
  const alpha = new Uint8Array(halfWidth * header.height * 4);

  const write = (
    destination: Uint8Array,
    index: number,
    paletteIndex: number,
    opacity: number,
  ): void => {
    destination[index] = palette[paletteIndex * 3] ?? 0;
    destination[index + 1] = palette[paletteIndex * 3 + 1] ?? 0;
    destination[index + 2] = palette[paletteIndex * 3 + 2] ?? 0;
    destination[index + 3] = opacity;
  };

  for (let y = 0; y < header.height; y += 1) {
    for (let x = 0; x < halfWidth; x += 1) {
      const destination = (y * halfWidth + x) * 4;
      const foreground = pixels[y * header.width + x] ?? 0;
      const background = pixels[y * header.width + halfWidth + x] ?? 0;
      write(solid, destination, background, 255);
      write(
        alpha,
        destination,
        foreground === 0 ? background : foreground,
        foreground === 0 ? 0 : 255,
      );
    }
  }

  return {
    name: header.name,
    width: halfWidth,
    height: header.height,
    solid,
    alpha,
  };
}
