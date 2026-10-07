import type { BspFormat } from "./types.js";

const QUAKE_PLAYER_SPAWNS = new Set([
  "info_player_start",
  "info_player_deathmatch",
]);
const GOLDSRC_PLAYER_SPAWNS = new Set([
  ...QUAKE_PLAYER_SPAWNS,
  "info_player_counterterrorist",
  "info_player_terrorist",
]);

interface BspPlayerProfile {
  readonly eyeHeight: number;
  readonly spawnClasses: ReadonlySet<string>;
}

const PLAYER_PROFILES: Readonly<Record<BspFormat, BspPlayerProfile>> = {
  "quake-bsp29": { eyeHeight: 22, spawnClasses: QUAKE_PLAYER_SPAWNS },
  "quake-bsp2": { eyeHeight: 22, spawnClasses: QUAKE_PLAYER_SPAWNS },
  "goldsrc-bsp30": { eyeHeight: 28, spawnClasses: GOLDSRC_PLAYER_SPAWNS },
  "quake2-bsp38": { eyeHeight: 22, spawnClasses: QUAKE_PLAYER_SPAWNS },
};

export function bspPlayerProfile(format: BspFormat): BspPlayerProfile {
  return PLAYER_PROFILES[format];
}
