import { identifyBsp, type BspIdentification } from "./bsp-identification.js";
import { parseQuakeBspContainer } from "./quake-bsp-container.js";
import { parseQuakeTextures } from "./quake-bsp-textures.js";
import type { BspWarning, ParsedMipTexture } from "./types.js";

export interface ParsedBspTextures {
  readonly identification: BspIdentification;
  readonly textures: readonly ParsedMipTexture[];
  readonly warnings: readonly BspWarning[];
}

/** Parses only the embedded texture table; it does not validate unrelated BSP geometry. */
export function parseBspTextures(
  input: ArrayBuffer | ArrayBufferView,
): ParsedBspTextures {
  const identification = identifyBsp(input);
  if (identification?.format === "quake2-bsp38") {
    return { identification, textures: [], warnings: [] };
  }

  const container = parseQuakeBspContainer(input);
  const { textures, warnings } = parseQuakeTextures(
    container.lumps.textures,
    container.layout,
  );
  return { identification: container.identification, textures, warnings };
}
