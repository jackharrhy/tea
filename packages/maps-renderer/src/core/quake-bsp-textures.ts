import { BinaryView } from "./binary.js";
import { invariant, MapsError } from "./errors.js";
import { classifyMaterial } from "./materials.js";
import { parseMipTexturePayload } from "./miptex-payload.js";
import { readMipTextureHeader } from "./miptex.js";
import type { QuakeBspLayout } from "./quake-bsp-layout.js";
import type { BspWarning, ParsedMaterial, ParsedMipTexture } from "./types.js";

export interface ParsedQuakeTextures {
  readonly materials: readonly ParsedMaterial[];
  readonly textures: readonly ParsedMipTexture[];
  readonly warnings: readonly BspWarning[];
}

function invalidDataReason(error: unknown): string | null {
  return error instanceof MapsError && error.code === "invalid-data"
    ? error.message
    : null;
}

export function parseQuakeTextures(
  textures: BinaryView,
  layout: QuakeBspLayout,
): ParsedQuakeTextures {
  invariant(textures.byteLength >= 4, "texture lump is truncated");
  const textureCount = textures.u32(0);
  invariant(
    textureCount <= 1_000_000,
    "texture lump has an unreasonable record count",
  );
  textures.require(4, textureCount * 4, "texture offset table");
  const textureTableEnd = 4 + textureCount * 4;
  const textureOffsets = Array.from({ length: textureCount }, (_, index) =>
    textures.i32(4 + index * 4),
  );
  const sortedTextureOffsets = [
    ...new Set(textureOffsets.filter((offset) => offset >= 0)),
  ].toSorted((left, right) => left - right);
  const textureEndByOffset = new Map(
    sortedTextureOffsets.map((offset, index) => [
      offset,
      sortedTextureOffsets[index + 1] ?? textures.byteLength,
    ]),
  );
  const materials: ParsedMaterial[] = [];
  const parsedTextures: ParsedMipTexture[] = [];
  const warnings: BspWarning[] = [];

  for (let index = 0; index < textureCount; index += 1) {
    const offset = textureOffsets[index]!;
    if (offset < 0) {
      // A missing MIPTEX has no name from which to infer surface semantics. Keep its
      // faces drawable with a fallback instead of treating missing artwork as a tool.
      const name = `__missing_${index}__`;
      materials.push({ name, kind: "opaque" });
      warnings.push({
        code: "unusable-miptex",
        message: `MIPTEX ${index} is missing and will use a fallback material`,
        textureIndex: index,
        textureName: name,
        reason: "Texture offset is negative; no MIPTEX record is present",
      });
      continue;
    }
    invariant(
      offset >= textureTableEnd,
      `MIPTEX ${index} overlaps the texture offset table`,
    );
    textures.require(offset, 40, `MIPTEX ${index}`);
    const recordEnd = textureEndByOffset.get(offset);
    invariant(
      recordEnd !== undefined,
      `MIPTEX ${index} has no record boundary`,
    );
    const texture = textures.slice(offset, recordEnd - offset);
    const name = texture.string(0, 16, true);
    const kind = classifyMaterial(name, layout.format);
    try {
      const header = readMipTextureHeader(texture.bytes);
      const { width, height } = header;
      if (width % 16 !== 0 || height % 16 !== 0) {
        warnings.push({
          code: "noncanonical-miptex-dimensions",
          message: `MIPTEX ${name} has noncanonical dimensions ${width}x${height}; expected 16-unit alignment`,
          textureIndex: index,
          textureName: name,
          width,
          height,
        });
      }
      const embeddedTexture = parseMipTexturePayload(
        texture,
        header,
        index,
        layout.embeddedPalette,
      );
      if (embeddedTexture) parsedTextures.push(embeddedTexture);
      materials.push(
        embeddedTexture ? { name, kind, embeddedTexture } : { name, kind },
      );
    } catch (error) {
      const reason = invalidDataReason(error);
      if (!reason) throw error;
      warnings.push({
        code: "unusable-miptex",
        message: `MIPTEX ${name || index} could not be decoded and will use a fallback material: ${reason}`,
        textureIndex: index,
        textureName: name,
        reason,
      });
      materials.push({ name, kind });
    }
  }

  return { materials, textures: parsedTextures, warnings };
}
