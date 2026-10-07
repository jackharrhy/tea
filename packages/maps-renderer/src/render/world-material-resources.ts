/*
 * Surface material resource behavior is adapted from noclip.website's Common/IdTech2 renderer.
 * See docs/plan.md and THIRD_PARTY_NOTICES.md.
 */

import type { TgpuBindGroup, TgpuRoot, TgpuTexture } from "typegpu";

import {
  buildLightmapPage,
  isQuakePaletteFormat,
  LightstyleState,
  type DecodedMipTexture,
  type DrawBatch,
} from "../core/index.js";
import type { LoadedMaterialTexture, RenderWorldAssets } from "./assets.js";
import { MaterialUniform, materialLayout } from "./schemas.js";
import type { TextureFiltering } from "./types.js";
import {
  goldSrcTextureScrollSpeed,
  worldRequiresContinuousAnimation,
} from "./world-frame-plan.js";
import { worldLighting } from "./world-lighting.js";

interface UploadedTexture {
  readonly texture: TgpuTexture;
  readonly view: GPUTextureView;
  readonly width: number;
  readonly height: number;
}

interface UploadedMaterial {
  readonly diffuse: UploadedTexture;
  readonly fullbright: UploadedTexture;
  readonly skyAlpha: UploadedTexture;
}

function checkerboard(): DecodedMipTexture {
  const width = 16;
  const height = 16;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const bright = ((x >> 2) + (y >> 2)) % 2 === 0;
      rgba[offset] = bright ? 255 : 24;
      rgba[offset + 1] = bright ? 48 : 8;
      rgba[offset + 2] = bright ? 220 : 28;
      rgba[offset + 3] = 255;
    }
  }
  return {
    name: "__missing__",
    width,
    height,
    levels: [{ width, height, rgba }],
    alphaTest: false,
  };
}

export class WorldMaterialResources {
  private readonly device: GPUDevice;
  private readonly sampler;
  private readonly lightmapSampler;
  private readonly skyboxSampler;
  private readonly buffers: Array<{ destroy(): void }> = [];
  private readonly textures: TgpuTexture[] = [];
  private readonly uploadedMaterials = new Map<number, UploadedMaterial>();
  private readonly lightmapTextures = new Map<number, UploadedTexture>();
  private readonly materialBindings = new Map<
    DrawBatch,
    ReadonlyMap<number, TgpuBindGroup>
  >();
  private readonly materialAnimations = new Map<number, readonly number[]>();
  private readonly lightstyles = new LightstyleState();
  private readonly animatedPages = new Set<number>();
  private lastLightstyleFrame = -1;
  private disposed = false;

  public constructor(
    private readonly root: TgpuRoot,
    private readonly loaded: RenderWorldAssets,
    filtering: TextureFiltering,
  ) {
    this.device = root.device;
    this.sampler = root.createSampler({
      addressModeU: "repeat",
      addressModeV: "repeat",
      magFilter: filtering,
      minFilter: filtering,
      mipmapFilter: filtering,
    });
    this.skyboxSampler = root.createSampler({
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: filtering,
      minFilter: filtering,
    });
    this.lightmapSampler = root.createSampler({
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
    });
    try {
      this.upload();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  public get continuouslyAnimated(): boolean {
    return worldRequiresContinuousAnimation(this.loaded.world);
  }

  public prepare(timeSeconds: number): void {
    if (this.animatedPages.size === 0) return;
    const frame = Math.floor(timeSeconds * 10);
    if (frame === this.lastLightstyleFrame) return;
    this.lastLightstyleFrame = frame;
    this.lightstyles.update(timeSeconds);
    for (const pageIndex of this.animatedPages) {
      const page = this.loaded.world.lightmapPages[pageIndex];
      const texture = this.lightmapTextures.get(pageIndex);
      if (!page || !texture) continue;
      texture.texture.write(
        buildLightmapPage(
          page,
          this.loaded.world.lightmapBytesPerTexel,
          this.lightstyles.intensities,
        ),
      );
    }
  }

  public bindingForBatch(
    batch: DrawBatch,
    timeSeconds: number,
  ): TgpuBindGroup | null {
    const materialIndex = this.animatedMaterialIndex(
      batch.materialIndex,
      timeSeconds,
    );
    return this.materialBindings.get(batch)?.get(materialIndex) ?? null;
  }

  public baseBindingForBatch(batch: DrawBatch): TgpuBindGroup | null {
    return this.materialBindings.get(batch)?.get(batch.materialIndex) ?? null;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const buffer of this.buffers) buffer.destroy();
    this.buffers.length = 0;
    for (const texture of this.textures) texture.destroy();
    this.textures.length = 0;
    this.uploadedMaterials.clear();
    this.lightmapTextures.clear();
    this.materialBindings.clear();
    this.materialAnimations.clear();
    this.animatedPages.clear();
  }

  private upload(): void {
    const lighting = worldLighting(this.loaded.world.format);
    const missing = this.uploadDecoded(checkerboard());
    const white = this.uploadRgba("__white__", 1, 1, [
      new Uint8Array([255, 255, 255, 255]),
    ]);
    const black = this.uploadRgba("__black__", 1, 1, [
      new Uint8Array([0, 0, 0, 255]),
    ]);
    const skybox = this.uploadSkybox();
    const missingLightmap =
      this.loaded.world.hasLighting && lighting.samplelessFaces === "dark"
        ? black
        : white;
    this.lightmapTextures.set(-1, missingLightmap);
    for (const page of this.loaded.world.lightmapPages) {
      const rgba = buildLightmapPage(
        page,
        this.loaded.world.lightmapBytesPerTexel,
      );
      this.lightmapTextures.set(
        page.index,
        this.uploadRgba(`lightmap-${page.index}`, page.width, page.height, [
          rgba,
        ]),
      );
      if (
        page.lightmaps.some((lightmap) =>
          lightmap.styles.some((style) => style !== 0),
        )
      ) {
        this.animatedPages.add(page.index);
      }
    }

    const uploadedByTexture = new Map<
      LoadedMaterialTexture,
      UploadedMaterial
    >();
    for (const [materialIndex, loadedMaterial] of this.loaded
      .materialTextures) {
      const material = this.loaded.world.materials[materialIndex];
      if (!material) continue;
      const existing = uploadedByTexture.get(loadedMaterial);
      if (existing) {
        this.uploadedMaterials.set(materialIndex, existing);
        continue;
      }
      let uploaded: UploadedMaterial;
      if (loadedMaterial.quakeSky) {
        const decoded = loadedMaterial.quakeSky;
        uploaded = {
          fullbright: black,
          diffuse: this.uploadRgba(
            `${decoded.name}-solid`,
            decoded.width,
            decoded.height,
            [decoded.solid],
          ),
          skyAlpha: this.uploadRgba(
            `${decoded.name}-alpha`,
            decoded.width,
            decoded.height,
            [decoded.alpha],
          ),
        };
      } else {
        const decoded = loadedMaterial.texture;
        const diffuse = this.uploadDecoded(decoded);
        const fullbright =
          lighting.paletteFullbrights &&
          decoded.levels.some((level) => level.fullbrightRgba)
            ? this.uploadRgba(
                `${decoded.name}-fullbright`,
                decoded.width,
                decoded.height,
                decoded.levels.map(
                  (level) =>
                    level.fullbrightRgba ?? new Uint8Array(level.rgba.length),
                ),
              )
            : black;
        uploaded = { diffuse, fullbright, skyAlpha: diffuse };
      }
      uploadedByTexture.set(loadedMaterial, uploaded);
      this.uploadedMaterials.set(materialIndex, uploaded);
    }

    const sharedBindings = new Map<string, TgpuBindGroup>();
    for (const batch of this.loaded.world.batches) {
      const batchBindings = new Map<number, TgpuBindGroup>();
      for (const materialIndex of this.animationMaterialIndices(
        batch.materialIndex,
      )) {
        const key = `${batch.modelIndex}:${materialIndex}:${batch.lightmapPage}`;
        const shared = sharedBindings.get(key);
        if (shared) {
          batchBindings.set(materialIndex, shared);
          continue;
        }
        const model = this.loaded.world.models[batch.modelIndex];
        const parsedMaterial = this.loaded.world.materials[materialIndex];
        const loadedTexture = this.loaded.materialTextures.get(materialIndex);
        const uploaded = this.uploadedMaterials.get(materialIndex) ?? {
          diffuse: missing,
          fullbright: black,
          skyAlpha: missing,
        };
        const lightmap =
          this.lightmapTextures.get(batch.lightmapPage) ?? missingLightmap;
        const uniform = this.root.createUniform(MaterialUniform, {
          lightmapScale: lighting.lightmapScale,
          sizes: [
            loadedTexture?.logicalWidth ?? uploaded.diffuse.width,
            loadedTexture?.logicalHeight ?? uploaded.diffuse.height,
            lightmap.width,
            lightmap.height,
          ],
          options: [
            isQuakePaletteFormat(this.loaded.world.format) ? 1 : 0,
            this.loaded.skybox ? 1 : 0,
            this.loaded.world.format === "quake2-bsp38" ? 1 : 0,
            parsedMaterial?.scrollSpeed ??
              goldSrcTextureScrollSpeed(this.loaded.world, batch),
          ],
          renderColor: [
            (model?.renderColor[0] ?? 255) / 255,
            (model?.renderColor[1] ?? 255) / 255,
            (model?.renderColor[2] ?? 255) / 255,
            ((model?.renderAmount ?? 255) / 255) *
              (parsedMaterial?.opacity ?? 1),
          ],
        });
        this.buffers.push(uniform.buffer);
        const group = this.root.createBindGroup(materialLayout, {
          material: uniform,
          diffuse: uploaded.diffuse.view,
          fullbright: uploaded.fullbright.view,
          lightmap: lightmap.view,
          skyAlpha: uploaded.skyAlpha.view,
          skybox: skybox.view,
          textureSampler: this.sampler,
          lightmapSampler: this.lightmapSampler,
          skyboxSampler: this.skyboxSampler,
        });
        sharedBindings.set(key, group);
        batchBindings.set(materialIndex, group);
      }
      this.materialBindings.set(batch, batchBindings);
    }
  }

  private uploadDecoded(decoded: DecodedMipTexture): UploadedTexture {
    return this.uploadRgba(
      decoded.name,
      decoded.width,
      decoded.height,
      decoded.levels.map((level) => level.rgba),
    );
  }

  private uploadRgba(
    label: string,
    width: number,
    height: number,
    levels: readonly Uint8Array[],
  ): UploadedTexture {
    const texture = this.trackTexture(
      this.root
        .createTexture({
          size: [width, height],
          format: "rgba8unorm",
          mipLevelCount: levels.length,
        })
        .$usage("sampled")
        .$name(label),
    );
    levels.forEach((rgba, level) => texture.write(rgba, level));
    return {
      texture,
      view: this.root.unwrap(texture).createView(),
      width,
      height,
    };
  }

  private uploadSkybox(): UploadedTexture {
    const sides = this.loaded.skybox?.sides;
    const width = sides?.rt.width ?? 1;
    const height = sides?.rt.height ?? 1;
    const texture = this.trackTexture(
      this.root
        .createTexture({ size: [width, height, 6], format: "rgba8unorm" })
        .$usage("sampled")
        .$name(this.loaded.skybox?.name ?? "__empty_skybox__"),
    );
    const raw = this.root.unwrap(texture);
    const layers = sides
      ? [sides.rt, sides.lf, sides.bk, sides.ft, sides.up, sides.dn]
      : Array.from({ length: 6 }, () => ({
          rgba: new Uint8Array([0, 0, 0, 255]),
        }));
    layers.forEach((side, layer) => {
      this.device.queue.writeTexture(
        { texture: raw, origin: { x: 0, y: 0, z: layer } },
        side.rgba,
        { bytesPerRow: width * 4, rowsPerImage: height },
        { width, height, depthOrArrayLayers: 1 },
      );
    });
    return {
      texture,
      view: raw.createView({ dimension: "2d-array", arrayLayerCount: 6 }),
      width,
      height,
    };
  }

  private trackTexture<T extends TgpuTexture>(texture: T): T {
    this.textures.push(texture);
    return texture;
  }

  private animationMaterialIndices(first: number): readonly number[] {
    const cached = this.materialAnimations.get(first);
    if (cached) return cached;
    const indices: number[] = [];
    const seen = new Set<number>();
    let current = first;
    while (!seen.has(current)) {
      seen.add(current);
      indices.push(current);
      const next = this.loaded.world.materials[current]?.nextMaterialIndex;
      if (next === null || next === undefined) break;
      current = next;
    }
    this.materialAnimations.set(first, indices);
    return indices;
  }

  private animatedMaterialIndex(first: number, timeSeconds: number): number {
    const indices = this.animationMaterialIndices(first);
    return indices[Math.floor(timeSeconds * 2) % indices.length] ?? first;
  }
}
