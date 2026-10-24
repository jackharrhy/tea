import type { WorldSource } from "@jackharrhy/tea-maps-renderer";
import {
  syntheticGoldSrcAudioBsp,
  syntheticGoldSrcBsp,
  syntheticGoldSrcPlayerSounds,
  syntheticGoldSrcSkybox,
  syntheticGoldSrcSkyBsp,
  syntheticGoldSrcSprite,
  syntheticGoldSrcSpriteBsp,
  syntheticGoldSrcWave,
  syntheticQuakeBsp,
  syntheticQuakeBsp2,
  syntheticQuakePalette,
} from "./synthetic.ts";
import {
  syntheticQuake2Bsp,
  syntheticQuake2Palette,
  syntheticQuake2Wal,
} from "./synthetic-quake2.ts";

export const examples = [
  { id: "goldsrc", label: "GoldSrc room", selectable: true },
  { id: "alpha", label: "Alpha fence", selectable: true },
  { id: "water", label: "Water", selectable: true },
  { id: "quake", label: "Quake sky", selectable: true },
  { id: "quake2", label: "Quake II room", selectable: true },
  { id: "audio", label: "Audio room", selectable: true },
  { id: "quake-bsp2", label: "Quake BSP2", selectable: false },
  { id: "goldsrc-sky", label: "GoldSrc sky test", selectable: false },
  { id: "sprite", label: "GoldSrc sprite test", selectable: false },
  { id: "audio-decode-failure", label: "Broken audio test", selectable: false },
] as const;

export function exampleSource(id: string): WorldSource | undefined {
  switch (id) {
    case "goldsrc":
    case "synthetic":
      return {
        bsp: syntheticGoldSrcBsp(),
        sounds: syntheticGoldSrcPlayerSounds(),
      };
    case "alpha":
      return { bsp: syntheticGoldSrcBsp("{wv_fence") };
    case "water":
      return { bsp: syntheticGoldSrcBsp("!wv_water") };
    case "quake":
      return { bsp: syntheticQuakeBsp(), palette: syntheticQuakePalette() };
    case "quake2":
      return {
        bsp: syntheticQuake2Bsp(),
        gameAssets: {
          "pics/colormap.pcx": syntheticQuake2Palette(),
          "textures/e1u1/fixture.wal": syntheticQuake2Wal(),
        },
      };
    case "quake-bsp2":
      return { bsp: syntheticQuakeBsp2(), palette: syntheticQuakePalette() };
    case "audio":
      return {
        bsp: syntheticGoldSrcAudioBsp(),
        sounds: {
          ...syntheticGoldSrcPlayerSounds(),
          "ambience/tone.wav": syntheticGoldSrcWave(),
          "music/tone.wav": syntheticGoldSrcWave(),
        },
      };
    case "goldsrc-sky":
      return {
        bsp: syntheticGoldSrcSkyBsp(),
        skybox: syntheticGoldSrcSkybox(),
      };
    case "sprite":
      return {
        bsp: syntheticGoldSrcSpriteBsp(),
        sprites: { "sprites/fixture.spr": syntheticGoldSrcSprite() },
      };
    case "audio-decode-failure":
      return {
        bsp: syntheticGoldSrcAudioBsp(2),
        sounds: {
          "ambience/tone.wav": syntheticGoldSrcWave(),
          "music/tone.wav": new Uint8Array([0, 1, 2, 3]),
        },
      };
    default:
      return undefined;
  }
}
