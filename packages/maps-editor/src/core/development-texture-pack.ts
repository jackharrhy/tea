import {
  createQuakePalette,
  decodeMipTexture,
  parseWad,
} from "@jackharrhy/tea-maps-renderer/core";
import {
  createCompilerToolMaterials,
  createDevelopmentMaterials,
} from "./development-materials.js";
import { mapsGameProfile, type MapsGameProfile } from "./game-profiles.js";
import type { EditorMaterial } from "./materials.js";
import { encodeGoldSrcWad3, encodeQuakeWad2 } from "./wad-encoding.js";

/** Preview pixels are decoded from the same WAD bytes sent to the compiler. */
export function developmentTexturePack(
  game: MapsGameProfile,
  palette?: Uint8Array,
): {
  readonly wad: ArrayBuffer;
  readonly materials: readonly EditorMaterial[];
} | null {
  if (mapsGameProfile(game).materialFormat === "wal") return null;
  const quakePalette =
    game === "quake" ? (palette ?? createQuakePalette()) : undefined;
  const originals = createDevelopmentMaterials();
  const inputs = [...originals, ...createCompilerToolMaterials()];
  const wad =
    game === "quake"
      ? encodeQuakeWad2(inputs, quakePalette!)
      : encodeGoldSrcWad3(inputs);
  const lumps = parseWad(wad).lumps;
  const materials: EditorMaterial[] = [];
  for (const [index, material] of originals.entries()) {
    materials.push({
      ...material,
      rgba: decodeMipTexture(lumps[index]!.data, quakePalette).levels[0]!.rgba,
    });
  }
  return { wad, materials };
}
