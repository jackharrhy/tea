import { PALETTE_COLORS } from "../shared/palette.ts";

export function deterministicPaletteColor(subject: string): string {
  let hash = 0;
  for (let index = 0; index < subject.length; index++) {
    hash = (hash * 31 + subject.charCodeAt(index)) >>> 0;
  }
  return PALETTE_COLORS[hash % PALETTE_COLORS.length];
}
