import type { BspFormat } from "../core/index.js";

interface WorldLighting {
  readonly paletteFullbrights: boolean;
  readonly lightmapScale: number;
  readonly samplelessFaces: "dark" | "unlit";
}

// Quake's normal lightstyle is 264/256; its overbright lightmap unit is 128.
// The GPU atlas normalizes bytes by 255. QSS-M is the neutral gamma/contrast reference.
const quakeLighting: WorldLighting = {
  paletteFullbrights: true,
  lightmapScale: (264 / 256) * (255 / 128),
  samplelessFaces: "dark",
};

// GoldSrc texture gamma and user brightness settings are not emulated.
const goldSrcLighting: WorldLighting = {
  paletteFullbrights: false,
  lightmapScale: 2,
  samplelessFaces: "dark",
};

const quake2Lighting: WorldLighting = {
  paletteFullbrights: false,
  lightmapScale: 2,
  samplelessFaces: "unlit",
};

export function worldLighting(format: BspFormat): WorldLighting {
  switch (format) {
    case "quake-bsp29":
    case "quake-bsp2":
      return quakeLighting;
    case "goldsrc-bsp30":
      return goldSrcLighting;
    case "quake2-bsp38":
      return quake2Lighting;
  }
}
