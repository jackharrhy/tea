/*
 * Lightmap reconstruction and skyline packing are adapted from noclip.website's
 * Common/IdTech2/Render.ts and SourceEngine/BSPFile.ts. See THIRD_PARTY_NOTICES.md.
 */

import { invariant } from "./errors.js";
import type { LightmapPage, ParsedLightmap } from "./types.js";

export const LIGHTMAP_PAGE_SIZE = 2048;
export const LIGHTSTYLE_FRAMERATE = 10;
/** Face light-style indices are stored as bytes; 255 remains the on-disk terminator. */
const MAX_LIGHTSTYLES = 256;

const DEFAULT_PATTERNS = [
  "m",
  "mmnmmommommnonmmonqnmmo",
  "abcdefghijklmnopqrstuvwxyzyxwvutsrqponmlkjihgfedcba",
  "mmmmmaaaaammmmmaaaaaabcdefgabcdefg",
  "mamamamamama",
  "jklmnopqrstuvwxyzyxwvutsrqponmlkj",
  "nmonqnmomnmomomno",
  "mmmaaaabcdefgmmmmaaaammmaamm",
  "mmmaaammmaaammmabcdefaaaammmmabcdefmmmaaaa",
  "aaaaaaaazzzzzzzz",
  "mmamammmmammamamaaamammma",
  "abcdefghijklmnopqrrqponmlkjihgfedcba",
  "mmnnmmnnnmmnn",
] as const;

interface Allocation {
  width: number;
  height: number;
  pageIndex: number;
  pageX: number;
  pageY: number;
}

class SkylinePage {
  private readonly skyline: Uint16Array;
  public width = 0;
  public height = 0;

  public constructor(
    private readonly maxWidth: number,
    private readonly maxHeight: number,
  ) {
    invariant(
      maxWidth <= 65_535,
      "lightmap atlas is wider than its skyline representation",
    );
    this.skyline = new Uint16Array(maxHeight);
  }

  public allocate(allocation: Allocation): boolean {
    const { width, height } = allocation;
    if (width > this.maxWidth || height > this.maxHeight) return false;
    let bestY = -1;
    let minimumX = this.maxWidth - width + 1;
    for (let y = 0; y <= this.maxHeight - height;) {
      const searchY = this.search(y, height);
      const x = this.skyline[searchY] ?? this.maxWidth;
      if (x < minimumX && x + width <= this.maxWidth) {
        minimumX = x;
        bestY = y;
      }
      y = searchY + 1;
    }
    if (bestY < 0) return false;
    allocation.pageX = minimumX;
    allocation.pageY = bestY;
    for (let y = bestY; y < bestY + height; y += 1)
      this.skyline[y] = minimumX + width;
    this.width = Math.max(this.width, minimumX + width);
    this.height = Math.max(this.height, bestY + height);
    return true;
  }

  private search(startY: number, height: number): number {
    let winner = startY;
    let maximumX = -1;
    for (let y = startY; y < startY + height; y += 1) {
      const x = this.skyline[y] ?? 0;
      if (x >= maximumX) {
        winner = y;
        maximumX = x;
      }
    }
    return winner;
  }
}

export class LightmapPacker {
  private readonly pages: SkylinePage[] = [];

  public constructor(
    private readonly pageWidth = LIGHTMAP_PAGE_SIZE,
    private readonly pageHeight = LIGHTMAP_PAGE_SIZE,
  ) {}

  public allocate(allocation: Allocation): void {
    for (let index = 0; index < this.pages.length; index += 1) {
      const page = this.pages[index];
      if (page?.allocate(allocation)) {
        allocation.pageIndex = index;
        return;
      }
    }
    const page = new SkylinePage(this.pageWidth, this.pageHeight);
    invariant(
      page.allocate(allocation),
      `lightmap ${allocation.width}x${allocation.height} exceeds atlas page`,
    );
    this.pages.push(page);
    allocation.pageIndex = this.pages.length - 1;
  }

  public finish(lightmaps: readonly ParsedLightmap[]): LightmapPage[] {
    return this.pages.map((page, index) => ({
      index,
      width: Math.max(1, page.width),
      height: Math.max(1, page.height),
      lightmaps: lightmaps.filter((lightmap) => lightmap.pageIndex === index),
    }));
  }
}

export class LightstyleState {
  public readonly intensities = new Float32Array(MAX_LIGHTSTYLES).fill(1);
  private readonly patterns: string[] = Array.from(
    { length: MAX_LIGHTSTYLES },
    (_, index) => DEFAULT_PATTERNS[index] ?? "m",
  );

  public setPattern(index: number, pattern: string): void {
    if (index >= 0 && index < MAX_LIGHTSTYLES)
      this.patterns[index] = pattern || "m";
  }

  public update(timeSeconds: number): void {
    const frame = Math.floor(timeSeconds * LIGHTSTYLE_FRAMERATE);
    for (let index = 0; index < this.intensities.length; index += 1) {
      const pattern = this.patterns[index] ?? "m";
      const character = pattern.charCodeAt(frame % pattern.length);
      this.intensities[index] = ((character - 0x61) * 22) / 264;
    }
  }
}

export function buildLightmapPage(
  page: LightmapPage,
  bytesPerTexel: 1 | 3,
  intensities: Float32Array = new LightstyleState().intensities,
): Uint8Array {
  const output = new Uint8ClampedArray(page.width * page.height * 4);
  output.fill(255);
  for (const lightmap of page.lightmaps) {
    if (!lightmap.samples) continue;
    const styleSize = lightmap.width * lightmap.height * bytesPerTexel;
    for (let y = 0; y < lightmap.height; y += 1) {
      for (let x = 0; x < lightmap.width; x += 1) {
        let red = 0;
        let green = 0;
        let blue = 0;
        for (
          let styleIndex = 0;
          styleIndex < lightmap.styles.length;
          styleIndex += 1
        ) {
          const intensity = intensities[lightmap.styles[styleIndex] ?? 0] ?? 1;
          const source =
            styleIndex * styleSize + (y * lightmap.width + x) * bytesPerTexel;
          if (bytesPerTexel === 1) {
            const gray = (lightmap.samples[source] ?? 0) * intensity;
            red += gray;
            green += gray;
            blue += gray;
          } else {
            red += (lightmap.samples[source] ?? 0) * intensity;
            green += (lightmap.samples[source + 1] ?? 0) * intensity;
            blue += (lightmap.samples[source + 2] ?? 0) * intensity;
          }
        }
        const destination =
          ((lightmap.pageY + y) * page.width + lightmap.pageX + x) * 4;
        output[destination] = Math.min(255, red);
        output[destination + 1] = Math.min(255, green);
        output[destination + 2] = Math.min(255, blue);
        output[destination + 3] = 255;
      }
    }
  }
  return new Uint8Array(output.buffer);
}
