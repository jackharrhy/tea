import { BinaryView } from "./binary.js";
import { invariant } from "./errors.js";
import { validateTextureDimensions } from "./texture-limits.js";
import type { DecodedMipLevel } from "./types.js";

const WAL_HEADER_SIZE = 100;
const WAL_MIP_LEVEL_COUNT = 4;

export interface WalTextureHeader {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly offsets: readonly [number, number, number, number];
  readonly animationName: string;
  readonly flags: number;
  readonly contents: number;
  readonly value: number;
}

export interface DecodedWalTexture extends WalTextureHeader {
  readonly levels: readonly DecodedMipLevel[];
}

export function readWalTextureHeader(
  input: ArrayBuffer | ArrayBufferView,
): WalTextureHeader {
  const source = new BinaryView(input);
  invariant(source.byteLength >= WAL_HEADER_SIZE, "WAL header is truncated");
  const name = source.string(0, 32, true);
  const width = source.u32(32);
  const height = source.u32(36);
  validateTextureDimensions(width, height, `WAL ${name}`);
  invariant(
    width % 8 === 0 && height % 8 === 0,
    `WAL ${name} dimensions are not mip-compatible`,
  );
  const offsets = [
    source.u32(40),
    source.u32(44),
    source.u32(48),
    source.u32(52),
  ] as const;
  return {
    name,
    width,
    height,
    offsets,
    animationName: source.string(56, 32, true),
    flags: source.u32(88),
    contents: source.u32(92),
    value: source.u32(96),
  };
}

export function decodeWalTexture(
  input: ArrayBuffer | ArrayBufferView,
  palette: Uint8Array,
): DecodedWalTexture {
  const source = new BinaryView(input);
  const header = readWalTextureHeader(input);
  invariant(
    palette.byteLength >= 768,
    "Quake II WAL decoding requires a 768-byte palette",
  );
  const levels: DecodedMipLevel[] = [];
  for (let level = 0; level < WAL_MIP_LEVEL_COUNT; level += 1) {
    const width = Math.max(1, header.width >> level);
    const height = Math.max(1, header.height >> level);
    const offset = header.offsets[level] ?? 0;
    invariant(offset !== 0, `WAL ${header.name} has no mip ${level}`);
    source.require(offset, width * height, `WAL ${header.name} mip ${level}`);
    const indexed = source.uint8Array(offset, width * height);
    const rgba = new Uint8Array(width * height * 4);
    for (let pixel = 0; pixel < indexed.length; pixel += 1) {
      const paletteIndex = indexed[pixel] ?? 0;
      const destination = pixel * 4;
      rgba[destination] = palette[paletteIndex * 3] ?? 0;
      rgba[destination + 1] = palette[paletteIndex * 3 + 1] ?? 0;
      rgba[destination + 2] = palette[paletteIndex * 3 + 2] ?? 0;
      rgba[destination + 3] = 255;
    }
    levels.push({ width, height, rgba });
  }
  return { ...header, levels };
}
