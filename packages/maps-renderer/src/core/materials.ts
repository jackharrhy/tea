/*
 * Surface classification follows noclip.website's Common/IdTech2/Render.ts.
 * See docs/plan.md and THIRD_PARTY_NOTICES.md for the pinned source reference.
 */

import type { MaterialKind } from "./types.js";

const toolNames = new Set([
  "trigger",
  "clip",
  "skip",
  "hint",
  "origin",
  "aaatrigger",
  "null",
  "nodraw",
  "invisible",
]);

export function classifyMaterial(
  name: string,
  format: "quake-bsp29" | "quake-bsp2" | "goldsrc-bsp30" | "quake2-bsp38",
  surfaceFlags = 0,
): MaterialKind {
  const lower = name.toLowerCase();
  if (format === "quake2-bsp38") {
    if ((surfaceFlags & 0x80) !== 0) return "tool";
    if ((surfaceFlags & 0x04) !== 0) return "sky";
    if ((surfaceFlags & 0x08) !== 0) return "water";
  }
  if (
    lower.startsWith("__invalid_") ||
    lower.startsWith("tools/") ||
    toolNames.has(lower)
  )
    return "tool";
  if (lower.startsWith("sky")) return "sky";
  if ((lower.startsWith("*") && lower !== "*default") || lower.startsWith("!"))
    return "water";
  if (format === "goldsrc-bsp30" && lower.startsWith("water")) return "water";
  if (lower.startsWith("{")) return "alpha-test";
  return "opaque";
}
