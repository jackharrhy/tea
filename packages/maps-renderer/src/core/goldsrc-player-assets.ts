import { soundReference, type SoundReference } from "./audio.js";

export type GoldSrcPlayerSurfaceMaterial =
  | "concrete"
  | "dirt"
  | "grate"
  | "metal"
  | "slosh"
  | "tile"
  | "wood";

const concrete = [1, 2, 3, 4].map((index) => `player/pl_step${index}.wav`);

export const GOLDSRC_PLAYER_SOUND_PATHS: Readonly<
  Record<GoldSrcPlayerSurfaceMaterial, readonly string[]>
> = {
  concrete,
  dirt: [1, 2, 3, 4].map((index) => `player/pl_dirt${index}.wav`),
  grate: [1, 2, 3, 4].map((index) => `player/pl_grate${index}.wav`),
  metal: [1, 2, 3, 4].map((index) => `player/pl_metal${index}.wav`),
  slosh: [1, 2, 3, 4].map((index) => `player/pl_slosh${index}.wav`),
  tile: [1, 2, 3, 4, 5].map((index) => `player/pl_tile${index}.wav`),
  // The available player sample families have no dedicated wood set, so wood uses concrete.
  wood: concrete,
};

export const GOLDSRC_PLAYER_SOUND_REFERENCES: readonly SoundReference[] = [
  ...new Set(Object.values(GOLDSRC_PLAYER_SOUND_PATHS).flat()),
]
  .map((path) => soundReference(path))
  .filter((reference): reference is SoundReference => reference !== undefined);
