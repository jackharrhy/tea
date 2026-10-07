import type { TgpuRoot, TgpuTexture } from "typegpu";

import { EDITOR_SAMPLE_COUNT } from "./renderer-gpu.js";

export interface EditorViewportRenderTargets {
  readonly color: TgpuTexture;
  readonly depth: TgpuTexture;
}

export function createViewportRenderTargets(
  root: TgpuRoot,
  format: GPUTextureFormat,
  width: number,
  height: number,
  label: string,
): EditorViewportRenderTargets {
  const textures: TgpuTexture[] = [];
  const track = <Texture extends TgpuTexture>(texture: Texture): Texture => {
    textures.push(texture);
    return texture;
  };
  try {
    const depth = track(
      root.createTexture({
        size: [width, height],
        format: "depth24plus",
        sampleCount: EDITOR_SAMPLE_COUNT,
      }),
    )
      .$usage("render")
      .$name(`${label} depth`);
    const color = track(
      root.createTexture({
        size: [width, height],
        format,
        sampleCount: EDITOR_SAMPLE_COUNT,
      }),
    )
      .$usage("render")
      .$name(`${label} color`);
    return { color, depth };
  } catch (error) {
    for (const texture of textures) texture.destroy();
    throw error;
  }
}
