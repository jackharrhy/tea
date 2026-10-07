import { WAD2_MIPTEX, WAD3_MIPTEX } from "@tea/maps-renderer/core";
import type { EditorMaterial } from "./materials.js";

const MIP_LEVEL_COUNT = 4;

function writeAscii(
  target: Uint8Array,
  offset: number,
  length: number,
  value: string,
): void {
  for (let index = 0; index < Math.min(length, value.length); index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x21 || code > 0x7e)
      throw new Error(`WAD name ${value} is not printable ASCII`);
    target[offset + index] = code;
  }
}

function mipRgba(
  source: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const nextWidth = Math.max(1, width >> 1);
  const nextHeight = Math.max(1, height >> 1);
  const result = new Uint8Array(nextWidth * nextHeight * 4);
  for (let y = 0; y < nextHeight; y += 1) {
    for (let x = 0; x < nextWidth; x += 1) {
      const destination = (y * nextWidth + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        let total = 0;
        for (let offsetY = 0; offsetY < 2; offsetY += 1) {
          for (let offsetX = 0; offsetX < 2; offsetX += 1) {
            const sourceX = Math.min(width - 1, x * 2 + offsetX);
            const sourceY = Math.min(height - 1, y * 2 + offsetY);
            total += source[(sourceY * width + sourceX) * 4 + channel]!;
          }
        }
        result[destination + channel] = Math.round(total / 4);
      }
    }
  }
  return result;
}

function nearestPaletteIndex(
  red: number,
  green: number,
  blue: number,
  palette: Uint8Array,
  maximumIndex: number,
): number {
  let nearest = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= maximumIndex; index += 1) {
    const paletteOffset = index * 3;
    const deltaRed = red - palette[paletteOffset]!;
    const deltaGreen = green - palette[paletteOffset + 1]!;
    const deltaBlue = blue - palette[paletteOffset + 2]!;
    const distance =
      deltaRed * deltaRed + deltaGreen * deltaGreen + deltaBlue * deltaBlue;
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function materialMipmaps(material: EditorMaterial): Uint8Array[] {
  const levels = [material.rgba];
  for (let level = 1; level < MIP_LEVEL_COUNT; level += 1) {
    levels.push(
      mipRgba(
        levels[level - 1]!,
        material.width >> (level - 1),
        material.height >> (level - 1),
      ),
    );
  }
  return levels;
}

function goldSrcPalette(
  levels: readonly Uint8Array[],
  alphaTest: boolean,
): Uint8Array {
  const colors = new Map<number, number>();
  for (const rgba of levels)
    for (let pixel = 0; pixel < rgba.length; pixel += 4) {
      if (alphaTest && rgba[pixel + 3]! < 128) continue;
      const color =
        rgba[pixel]! | (rgba[pixel + 1]! << 8) | (rgba[pixel + 2]! << 16);
      colors.set(color, (colors.get(color) ?? 0) + 1);
    }
  const limit = alphaTest ? 255 : 256;
  // Development textures fit exactly; larger inputs retain their most frequent colors.
  const selected = [...colors].toSorted((a, b) => b[1] - a[1]).slice(0, limit);
  const palette = new Uint8Array(768);
  for (const [index, [color]] of selected.entries()) {
    palette.set(
      [color & 255, (color >> 8) & 255, (color >> 16) & 255],
      index * 3,
    );
  }
  if (alphaTest) palette.set([0, 0, 255], 255 * 3);
  return palette;
}

function encodeMipTexture(
  material: EditorMaterial,
  version: 2 | 3,
  externalPalette?: Uint8Array,
): Uint8Array {
  if (!/^[A-Za-z0-9_+{}!-]{1,15}$/.test(material.name)) {
    throw new Error(
      `WAD material ${material.name} must be a 1-15 character texture token`,
    );
  }
  if (
    ![material.width, material.height].every(
      (size) =>
        Number.isInteger(size) && size > 0 && size <= 4096 && size % 8 === 0,
    )
  ) {
    throw new Error(
      `WAD material ${material.name} dimensions must be multiples of 8 between 8 and 4096`,
    );
  }
  if (material.rgba.byteLength !== material.width * material.height * 4)
    throw new Error(
      `WAD material ${material.name} has inconsistent RGBA dimensions`,
    );
  const levels: Uint8Array[] = [];
  const rgbaLevels = materialMipmaps(material);
  const palette =
    version === 2
      ? externalPalette!
      : goldSrcPalette(rgbaLevels, material.alphaTest);
  let width = material.width;
  let height = material.height;
  const colorCache = new Map<number, number>();
  for (let level = 0; level < MIP_LEVEL_COUNT; level += 1) {
    const rgba = rgbaLevels[level]!;
    const indexed = new Uint8Array(width * height);
    for (let pixel = 0; pixel < indexed.length; pixel += 1) {
      const source = pixel * 4;
      if (material.alphaTest && rgba[source + 3]! < 128) {
        indexed[pixel] = 255;
        continue;
      }
      const red = rgba[source]!;
      const green = rgba[source + 1]!;
      const blue = rgba[source + 2]!;
      const key = red | (green << 8) | (blue << 16);
      let paletteIndex = colorCache.get(key);
      if (paletteIndex === undefined) {
        // Quake reserves 224–255 for fullbright pixels; generated RGBA has no emissive intent.
        paletteIndex = nearestPaletteIndex(
          red,
          green,
          blue,
          palette,
          version === 2 ? 223 : material.alphaTest ? 254 : 255,
        );
        colorCache.set(key, paletteIndex);
      }
      indexed[pixel] = paletteIndex;
    }
    levels.push(indexed);
    if (level < MIP_LEVEL_COUNT - 1) {
      width = Math.max(1, width >> 1);
      height = Math.max(1, height >> 1);
    }
  }
  const byteLength =
    40 +
    levels.reduce((sum, level) => sum + level.byteLength, 0) +
    (version === 3 ? 770 : 0);
  const result = new Uint8Array(byteLength);
  const view = new DataView(result.buffer);
  writeAscii(result, 0, 16, material.name);
  view.setUint32(16, material.width, true);
  view.setUint32(20, material.height, true);
  let offset = 40;
  for (let level = 0; level < MIP_LEVEL_COUNT; level += 1) {
    view.setUint32(24 + level * 4, offset, true);
    result.set(levels[level]!, offset);
    offset += levels[level]!.byteLength;
  }
  if (version === 3) {
    view.setUint16(offset, 256, true);
    result.set(palette, offset + 2);
  }
  return result;
}

export function encodeQuakeWad2(
  materials: readonly EditorMaterial[],
  palette: Uint8Array,
): ArrayBuffer {
  if (palette.byteLength < 768)
    throw new Error("Quake WAD2 export requires a 768-byte palette");
  return encodeWad(materials, 2, palette);
}

export function encodeGoldSrcWad3(
  materials: readonly EditorMaterial[],
): ArrayBuffer {
  return encodeWad(materials, 3);
}

function encodeWad(
  materials: readonly EditorMaterial[],
  version: 2 | 3,
  palette?: Uint8Array,
): ArrayBuffer {
  if (materials.length === 0)
    throw new Error("WAD export requires at least one material");
  const lumps = materials.map((material) => ({
    material,
    data: encodeMipTexture(material, version, palette),
  }));
  const dataByteLength = lumps.reduce(
    (sum, lump) => sum + lump.data.byteLength,
    0,
  );
  const directoryOffset = 12 + dataByteLength;
  const result = new Uint8Array(directoryOffset + lumps.length * 32);
  const view = new DataView(result.buffer);
  writeAscii(result, 0, 4, `WAD${version}`);
  view.setUint32(4, lumps.length, true);
  view.setUint32(8, directoryOffset, true);
  let dataOffset = 12;
  for (let index = 0; index < lumps.length; index += 1) {
    const lump = lumps[index]!;
    result.set(lump.data, dataOffset);
    const directoryRecord = directoryOffset + index * 32;
    view.setUint32(directoryRecord, dataOffset, true);
    view.setUint32(directoryRecord + 4, lump.data.byteLength, true);
    view.setUint32(directoryRecord + 8, lump.data.byteLength, true);
    result[directoryRecord + 12] = version === 2 ? WAD2_MIPTEX : WAD3_MIPTEX;
    writeAscii(result, directoryRecord + 16, 16, lump.material.name);
    dataOffset += lump.data.byteLength;
  }
  return result.buffer;
}
