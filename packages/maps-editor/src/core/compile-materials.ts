import { classifyMaterial, parseWad } from "@tea/maps-renderer/core";
import { documentWithoutOmittedLayers } from "./layers.js";
import { materialUsageInDocument } from "./material-usage.js";
import { serializeMap } from "./map-serializer.js";
import type { MapDocument } from "./types.js";

export interface MapCompileWad {
  readonly name: string;
  readonly data: ArrayBuffer | Uint8Array;
}

/** Uses the same last-pack-wins order as the editor material catalog. */
export function serializeMapForCompile(
  source: MapDocument,
  wads: readonly MapCompileWad[],
  game: "quake" | "goldsrc",
): string {
  const document = documentWithoutOmittedLayers(source);
  const available = new Set<string>();
  for (const wad of wads) {
    const parsed = parseWad(wad.data);
    const expected = game === "quake" ? 2 : 3;
    if (parsed.version !== expected) {
      throw new Error(
        `${game === "quake" ? "Quake" : "GoldSrc"} builds require WAD${expected} textures; ${wad.name} is WAD${parsed.version}. Use texture packs for the selected game.`,
      );
    }
    if (parsed.warnings.length) {
      throw new Error(
        `Texture pack ${wad.name}: ${parsed.warnings[0]!.message}`,
      );
    }
    for (const lump of parsed.lumps) {
      if (lump.mipTexture) available.add(lump.mipTexture.name.toLowerCase());
    }
  }
  const format = game === "quake" ? "quake-bsp29" : "goldsrc-bsp30";
  const missing = materialUsageInDocument(document)
    .map(({ material }) => material)
    .filter(
      (name) =>
        classifyMaterial(name, format) !== "tool" &&
        !available.has(name.toLowerCase()),
    );
  if (missing.length) {
    throw new Error(
      `Missing build textures: ${missing.join(", ")}. Add their texture packs to the project before building.`,
    );
  }
  const worldspawn = document.entities.find(
    (entity) => entity.properties.classname?.toLowerCase() === "worldspawn",
  );
  if (!worldspawn) throw new Error("The map document has no worldspawn entity");
  const compileWorldspawn = {
    ...worldspawn,
    properties: {
      ...worldspawn.properties,
      wad: wads.map(({ name }) => name).join(";"),
    },
  };
  return serializeMap({
    ...document,
    entities: document.entities.map((entity) =>
      entity === worldspawn ? compileWorldspawn : entity,
    ),
  });
}
