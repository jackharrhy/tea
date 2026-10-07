import {
  GOLDSRC_PLAYER_SOUND_PATHS,
  GOLDSRC_PLAYER_SOUND_REFERENCES,
  type GoldSrcPlayerSurfaceMaterial,
} from "../core/goldsrc-player-assets.js";

export type PlayerSurfaceMaterial = GoldSrcPlayerSurfaceMaterial;

export function playerSurfaceMaterial(
  textureName: string,
): PlayerSurfaceMaterial {
  const name = textureName
    .toLowerCase()
    .replace(/^[-+][0-9a-j]/, "")
    .replace(/^[{!~]/, "");
  if (/(water|slime|slosh|liquid|sew)/.test(name)) return "slosh";
  if (/(grate|grid|vent|duct)/.test(name)) return "grate";
  if (/(metal|steel|pipe|girder|iron|chrome|mtl)/.test(name)) return "metal";
  if (/(wood|crate|board|plank|box|card)/.test(name)) return "wood";
  if (/(dirt|sand|grass|mud|ground|forest|flower)/.test(name)) return "dirt";
  if (/(tile|marble|glass|ceramic)/.test(name)) return "tile";
  return "concrete";
}

export { GOLDSRC_PLAYER_SOUND_REFERENCES };

/** Selects alternating left/right variants with the occasional fifth tile sample. */
export function goldSrcPlayerSoundPath(
  material: PlayerSurfaceMaterial,
  sequence: number,
): string {
  const family = GOLDSRC_PLAYER_SOUND_PATHS[material];
  if (material === "tile" && sequence % 10 === 9) return family[4]!;
  const foot = sequence % 2;
  const variation = Math.floor(sequence / 2) % 2;
  return family[foot + variation * 2]!;
}
