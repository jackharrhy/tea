import type { GardenIndex } from "./garden-routing.mjs";
import type { Transformer } from "unified";
export function remarkObsidian(options?: {
  gardenIndex?: GardenIndex;
}): Transformer;
