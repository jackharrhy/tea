import type { BspFormat } from "./types.js";

export function isQuakePaletteFormat(
  format: BspFormat,
): format is "quake-bsp29" | "quake-bsp2" {
  return format === "quake-bsp29" || format === "quake-bsp2";
}
