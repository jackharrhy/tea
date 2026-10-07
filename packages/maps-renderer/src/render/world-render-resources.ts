/*
 * Surface resource behavior is adapted from noclip.website's Common/IdTech2 renderer.
 * See docs/plan.md and THIRD_PARTY_NOTICES.md.
 */

import type { TgpuBindGroup, TgpuRoot, TgpuTexture } from "typegpu";

import {
  isQuakePaletteFormat,
  type DrawBatch,
  type ParsedWorld,
} from "../core/index.js";
import type { WalkabilityCutawayGrid } from "../walkability/index.js";
import type { RenderWorldAssets } from "./assets.js";
import { createGpuBuffer } from "./gpu-buffer.js";
import { SceneUniform, sceneLayout, worldVertexLayout } from "./schemas.js";
import type { CameraState, TextureFiltering } from "./types.js";
import { WorldMaterialResources } from "./world-material-resources.js";
import {
  createWorldPipelines,
  selectedWorldPipeline,
  type WorldPipelines,
} from "./world-pipelines.js";

export interface SceneFrameOptions {
  readonly fullbright: boolean;
  readonly zMin: number;
  readonly zMax: number;
  readonly clipZ: boolean;
  readonly cutaway: WalkabilityCutawayGrid | null;
}

function skyboxGeometry(): { vertices: Float32Array; indices: Uint32Array } {
  const radius = 30_000;
  const vertices: number[] = [];
  for (const [x, y, z] of [
    [-radius, -radius, -radius],
    [radius, -radius, -radius],
    [radius, radius, -radius],
    [-radius, radius, -radius],
    [-radius, -radius, radius],
    [radius, -radius, radius],
    [radius, radius, radius],
    [-radius, radius, radius],
  ] as const) {
    vertices.push(x, y, z, 0, 0, 0, 0);
  }
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array([
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2,
      3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
    ]),
  };
}

function createWorldResourceParts(
  root: TgpuRoot,
  format: GPUTextureFormat,
  loaded: RenderWorldAssets,
  filtering: TextureFiltering,
) {
  const buffers: GPUBuffer[] = [];
  const sceneBuffers: Array<{ destroy(): void }> = [];
  const sceneTextures: TgpuTexture[] = [];
  let materials: WorldMaterialResources | null = null;
  try {
    const pipelines = createWorldPipelines(root, format);
    const vertexBuffer = createGpuBuffer(
      root.device,
      loaded.world.vertices,
      GPUBufferUsage.VERTEX,
    );
    buffers.push(vertexBuffer);
    const indexBuffer = createGpuBuffer(
      root.device,
      loaded.world.indices,
      GPUBufferUsage.INDEX,
    );
    buffers.push(indexBuffer);
    const skybox = skyboxGeometry();
    const skyboxVertexBuffer = createGpuBuffer(
      root.device,
      skybox.vertices,
      GPUBufferUsage.VERTEX,
    );
    buffers.push(skyboxVertexBuffer);
    const skyboxIndexBuffer = createGpuBuffer(
      root.device,
      skybox.indices,
      GPUBufferUsage.INDEX,
    );
    buffers.push(skyboxIndexBuffer);
    const sceneUniform = root.createUniform(SceneUniform, {
      projectionView: new Float32Array(16),
      eyeTime: [0, 0, 0, 0],
      frameOptions: [0, 0, 0, 0],
      cutawayTransform: [0, 0, 0, 0],
      cutawayOptions: [0, 0, 0, 0],
      cutawayHeight: [0, 1, 0, 0],
    });
    sceneBuffers.push(sceneUniform.buffer);
    const emptyCutaway = root
      .createTexture({ size: [1, 1], format: "rgba8unorm" })
      .$usage("sampled")
      .$name("__empty_cutaway__");
    sceneTextures.push(emptyCutaway);
    emptyCutaway.write(new Uint8Array([0, 0, 0, 0]));
    const sceneGroup = root.createBindGroup(sceneLayout, {
      scene: sceneUniform,
      cutaway: root.unwrap(emptyCutaway).createView(),
    });
    materials = new WorldMaterialResources(root, loaded, filtering);
    return {
      pipelines,
      vertexBuffer,
      indexBuffer,
      skyboxVertexBuffer,
      skyboxIndexBuffer,
      sceneUniform,
      sceneGroup,
      sceneBuffers,
      sceneTextures,
      materials,
    };
  } catch (error) {
    materials?.dispose();
    for (const buffer of buffers) buffer.destroy();
    for (const buffer of sceneBuffers) buffer.destroy();
    for (const texture of sceneTextures) texture.destroy();
    throw error;
  }
}

export class WorldRenderResources {
  private readonly pipelines: WorldPipelines;
  private readonly vertexBuffer: GPUBuffer;
  private readonly indexBuffer: GPUBuffer;
  private readonly skyboxVertexBuffer: GPUBuffer;
  private readonly skyboxIndexBuffer: GPUBuffer;
  private readonly sceneUniform;
  public readonly sceneGroup: TgpuBindGroup;
  private readonly sceneBuffers: Array<{ destroy(): void }>;
  private readonly sceneTextures: TgpuTexture[];
  private readonly facesBySourceIndex: ReadonlyMap<
    number,
    ParsedWorld["faces"][number]
  >;
  private readonly materials: WorldMaterialResources;
  private disposed = false;

  public constructor(
    private readonly root: TgpuRoot,
    format: GPUTextureFormat,
    private readonly loaded: RenderWorldAssets,
    filtering: TextureFiltering,
  ) {
    this.facesBySourceIndex = new Map(
      loaded.world.faces.map((face) => [face.sourceIndex, face] as const),
    );
    const parts = createWorldResourceParts(root, format, loaded, filtering);
    this.pipelines = parts.pipelines;
    this.vertexBuffer = parts.vertexBuffer;
    this.indexBuffer = parts.indexBuffer;
    this.skyboxVertexBuffer = parts.skyboxVertexBuffer;
    this.skyboxIndexBuffer = parts.skyboxIndexBuffer;
    this.sceneUniform = parts.sceneUniform;
    this.sceneGroup = parts.sceneGroup;
    this.sceneBuffers = parts.sceneBuffers;
    this.sceneTextures = parts.sceneTextures;
    this.materials = parts.materials;
  }

  public get continuouslyAnimated(): boolean {
    return this.materials.continuouslyAnimated;
  }

  public async initialize(): Promise<void> {
    await Promise.all(
      Object.values(this.pipelines).map((pipeline) => pipeline.initAsync()),
    );
  }

  public createSceneGroup(cutaway: GPUTextureView): TgpuBindGroup {
    return this.root.createBindGroup(sceneLayout, {
      scene: this.sceneUniform,
      cutaway,
    });
  }

  public prepareScene(
    projectionView: Float32Array,
    camera: CameraState,
    timeSeconds: number,
    options: SceneFrameOptions,
  ): void {
    this.sceneUniform.write({
      projectionView,
      eyeTime: [
        camera.position[0],
        camera.position[1],
        camera.position[2],
        timeSeconds,
      ],
      frameOptions: [
        options.zMin,
        options.zMax,
        options.fullbright ? 1 : 0,
        options.clipZ ? 1 : 0,
      ],
      cutawayTransform: options.cutaway
        ? [
            options.cutaway.bounds.min[0],
            options.cutaway.bounds.min[1],
            1 /
              Math.max(
                1,
                options.cutaway.bounds.max[0] - options.cutaway.bounds.min[0],
              ),
            1 /
              Math.max(
                1,
                options.cutaway.bounds.max[1] - options.cutaway.bounds.min[1],
              ),
          ]
        : [0, 0, 0, 0],
      cutawayOptions: options.cutaway
        ? [1, options.cutaway.width, options.cutaway.height, 0]
        : [0, 0, 0, 0],
      cutawayHeight: options.cutaway
        ? [
            options.cutaway.bounds.min[2],
            Math.max(
              1,
              options.cutaway.bounds.max[2] - options.cutaway.bounds.min[2],
            ),
            0,
            0,
          ]
        : [0, 1, 0, 0],
    });
    this.materials.prepare(timeSeconds);
  }

  public drawBatch(
    pass: GPURenderPassEncoder,
    batch: DrawBatch,
    worldFaceVisibility: Uint8Array | null,
    sceneGroup: TgpuBindGroup,
    timeSeconds: number,
  ): void {
    if (batch.modelIndex !== 0 || !worldFaceVisibility) {
      this.drawRange(
        pass,
        batch,
        batch.firstIndex,
        batch.indexCount,
        sceneGroup,
        timeSeconds,
      );
      return;
    }

    let firstIndex = -1;
    let indexCount = 0;
    const flush = () => {
      if (firstIndex >= 0) {
        this.drawRange(
          pass,
          batch,
          firstIndex,
          indexCount,
          sceneGroup,
          timeSeconds,
        );
      }
      firstIndex = -1;
      indexCount = 0;
    };
    for (const faceIndex of batch.faceIndices) {
      if (worldFaceVisibility[faceIndex] === 0) {
        flush();
        continue;
      }
      const face = this.facesBySourceIndex.get(faceIndex);
      if (!face) continue;
      if (firstIndex >= 0 && firstIndex + indexCount !== face.firstIndex)
        flush();
      if (firstIndex < 0) firstIndex = face.firstIndex;
      indexCount += face.indexCount;
    }
    flush();
  }

  public drawSkyboxBackground(
    pass: GPURenderPassEncoder,
    batch: DrawBatch,
    sceneGroup: TgpuBindGroup,
  ): void {
    if (!isQuakePaletteFormat(this.loaded.world.format) && !this.loaded.skybox)
      return;
    const binding = this.materials.baseBindingForBatch(batch);
    if (!binding) return;
    const pipeline = isQuakePaletteFormat(this.loaded.world.format)
      ? this.pipelines.quakeSkyBackground
      : this.pipelines.unlitSkyBackground;
    pipeline
      .with(worldVertexLayout, this.skyboxVertexBuffer)
      .withIndexBuffer(this.skyboxIndexBuffer, "uint32")
      .with(sceneGroup)
      .with(binding)
      .with(pass)
      .drawIndexed(36);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.materials.dispose();
    this.disposeSceneResources();
  }

  private disposeSceneResources(): void {
    this.vertexBuffer.destroy();
    this.indexBuffer.destroy();
    this.skyboxVertexBuffer.destroy();
    this.skyboxIndexBuffer.destroy();
    for (const buffer of this.sceneBuffers) buffer.destroy();
    this.sceneBuffers.length = 0;
    for (const texture of this.sceneTextures) texture.destroy();
    this.sceneTextures.length = 0;
  }

  private drawRange(
    pass: GPURenderPassEncoder,
    batch: DrawBatch,
    firstIndex: number,
    indexCount: number,
    sceneGroup: TgpuBindGroup,
    timeSeconds: number,
  ): void {
    const binding = this.materials.bindingForBatch(batch, timeSeconds);
    if (!binding) return;
    selectedWorldPipeline(this.pipelines, this.loaded.world, batch)
      .with(worldVertexLayout, this.vertexBuffer)
      .withIndexBuffer(this.indexBuffer, "uint32")
      .with(sceneGroup)
      .with(binding)
      .with(pass)
      .drawIndexed(indexCount, 1, firstIndex);
  }
}
