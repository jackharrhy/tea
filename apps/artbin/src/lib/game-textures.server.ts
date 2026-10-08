import sharp from "sharp";

import {
  decodeMipTexture,
  decodeWalTexture,
  readPcxPalette,
  identifyBsp,
  identifyWad,
  isQuakePaletteFormat,
  parseBspTextures,
  parseWad,
  type BspWarning,
  type WadWarning,
} from "@jackharrhy/worldview/core";

export interface ExtractedTexture {
  name: string;
  width: number;
  height: number;
  pngBuffer: Buffer;
}

export async function walToPng(
  wal: Uint8Array,
  colormap: Uint8Array,
): Promise<Buffer> {
  const texture = decodeWalTexture(wal, readPcxPalette(colormap));
  return rgbaToPng(texture.levels[0]!.rgba, texture.width, texture.height);
}

export interface WadTextureInfo {
  index: number;
  name: string;
  width: number;
  height: number;
  isTransparent: boolean;
}

export interface WadContents {
  version: "WAD2" | "WAD3";
  lumpCount: number;
  textures: WadTextureInfo[];
  warnings: readonly WadWarning[];
}

export function isBspFile(buffer: ArrayBuffer | ArrayBufferView): boolean {
  return identifyBsp(buffer) !== null;
}

export function isWadFile(buffer: ArrayBuffer | ArrayBufferView): boolean {
  return identifyWad(buffer) !== null;
}

export async function extractTexturesFromBsp(
  buffer: ArrayBuffer | ArrayBufferView,
  palette?: Uint8Array,
): Promise<{
  textures: ExtractedTexture[];
  warnings: readonly (BspWarning | Error)[];
}> {
  const parsed = parseBspTextures(buffer);
  const warnings: Array<BspWarning | Error> = [...parsed.warnings];
  const textures: ExtractedTexture[] = [];

  for (const texture of parsed.textures) {
    try {
      const decoded = decodeMipTexture(
        texture.data,
        isQuakePaletteFormat(parsed.identification.format)
          ? palette
          : undefined,
      );
      textures.push({
        name: decoded.name,
        width: decoded.width,
        height: decoded.height,
        pngBuffer: await rgbaToPng(
          decoded.levels[0]!.rgba,
          decoded.width,
          decoded.height,
        ),
      });
    } catch (cause) {
      warnings.push(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  return { textures, warnings };
}

export function inspectWad(buffer: ArrayBuffer | ArrayBufferView): WadContents {
  const wad = parseWad(buffer);
  return {
    version: wad.version === 2 ? "WAD2" : "WAD3",
    lumpCount: wad.lumps.length,
    textures: wad.lumps.flatMap((lump) =>
      lump.mipTexture
        ? [
            {
              index: lump.sourceIndex,
              name: lump.mipTexture.name,
              width: lump.mipTexture.width,
              height: lump.mipTexture.height,
              isTransparent: lump.mipTexture.name.startsWith("{"),
            },
          ]
        : [],
    ),
    warnings: wad.warnings,
  };
}

export async function extractTextureFromWad(
  buffer: ArrayBuffer | ArrayBufferView,
  sourceIndex: number,
  palette?: Uint8Array,
): Promise<ExtractedTexture | null> {
  if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0) return null;
  const wad = parseWad(buffer);
  const texture = wad.lumps.find(
    (lump) => lump.sourceIndex === sourceIndex,
  )?.mipTexture;
  if (!texture) return null;
  const decoded = decodeMipTexture(
    texture.data,
    wad.version === 2 ? palette : undefined,
  );
  return {
    name: decoded.name,
    width: decoded.width,
    height: decoded.height,
    pngBuffer: await rgbaToPng(
      decoded.levels[0]!.rgba,
      decoded.width,
      decoded.height,
    ),
  };
}

async function rgbaToPng(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<Buffer> {
  return sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}
