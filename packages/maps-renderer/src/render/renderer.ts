import type { TgpuBindGroup, TgpuRoot } from "typegpu";

import {
  findBspLeaf,
  visibleWorldFaceMask,
  type DrawBatch,
  type Vec3Tuple,
} from "../core/index.js";
import type {
  WalkabilityCutawayGrid,
  WalkabilityMap,
} from "../walkability/index.js";
import { TypeGpuWalkabilityRenderer } from "./walkability-renderer.js";
import type { RenderWorldAssets } from "./assets.js";
import { TypeGpuSpriteRenderer } from "./sprite-renderer.js";
import type { CameraState, TextureFiltering } from "./types.js";
import {
  createWorldBatchCenters,
  createWorldFramePlan,
} from "./world-frame-plan.js";
import { encodeWorldPasses } from "./world-pass-encoder.js";
import {
  WorldRenderResources,
  type SceneFrameOptions,
} from "./world-render-resources.js";
import {
  WorldCanvasTarget,
  WorldCaptureTarget,
  type WorldRenderTarget,
} from "./world-render-targets.js";

export { goldSrcBrushPipeline } from "./world-pipelines.js";
export { goldSrcTextureScrollSpeed } from "./world-frame-plan.js";

interface FrameOptions extends SceneFrameOptions {
  readonly allFaces: boolean;
  readonly includeSky: boolean;
  readonly includeSprites: boolean;
  readonly sceneGroup: TgpuBindGroup;
  readonly clearColor: readonly [number, number, number, number];
}

export interface OverviewRenderSettings {
  readonly width: number;
  readonly height: number;
  readonly zMin: number;
  readonly zMax: number;
  readonly fullbright: boolean;
  readonly includeSky: boolean;
  readonly includeSprites: boolean;
  readonly clearColor: readonly [number, number, number, number];
  readonly cutaway: WalkabilityCutawayGrid | null;
}

interface RendererParts {
  readonly resources: WorldRenderResources;
  readonly sprites: TypeGpuSpriteRenderer;
  readonly walkability: TypeGpuWalkabilityRenderer;
  readonly canvasTarget: WorldCanvasTarget;
}

function createRendererParts(
  root: TgpuRoot,
  context: GPUCanvasContext,
  format: GPUTextureFormat,
  loaded: RenderWorldAssets,
  filtering: TextureFiltering,
): RendererParts {
  const resources = new WorldRenderResources(root, format, loaded, filtering);
  let sprites: TypeGpuSpriteRenderer | null = null;
  let walkability: TypeGpuWalkabilityRenderer | null = null;
  let canvasTarget: WorldCanvasTarget | null = null;
  try {
    sprites = new TypeGpuSpriteRenderer(
      root,
      format,
      loaded.sprites,
      filtering,
    );
    walkability = new TypeGpuWalkabilityRenderer(root, format);
    canvasTarget = new WorldCanvasTarget(root, context, format);
    return { resources, sprites, walkability, canvasTarget };
  } catch (error) {
    canvasTarget?.dispose();
    walkability?.dispose();
    sprites?.dispose();
    resources.dispose();
    throw error;
  }
}

export class TypeGpuWorldRenderer {
  private readonly root: TgpuRoot;
  private readonly device: GPUDevice;
  private readonly resources: WorldRenderResources;
  private readonly sprites: TypeGpuSpriteRenderer;
  private readonly walkability: TypeGpuWalkabilityRenderer;
  private readonly canvasTarget: WorldCanvasTarget;
  private readonly batchCenters: ReadonlyMap<DrawBatch, Vec3Tuple>;
  private visibilityLeaf: number | null | undefined;
  private worldFaceVisibility: Uint8Array | null = null;
  private disposed = false;

  public constructor(
    root: TgpuRoot,
    context: GPUCanvasContext,
    private readonly format: GPUTextureFormat,
    private readonly loaded: RenderWorldAssets,
    filtering: TextureFiltering,
    private readonly clearColor: readonly [number, number, number, number],
  ) {
    this.root = root;
    this.device = root.device;
    const parts = createRendererParts(root, context, format, loaded, filtering);
    this.resources = parts.resources;
    this.sprites = parts.sprites;
    this.walkability = parts.walkability;
    this.canvasTarget = parts.canvasTarget;
    this.batchCenters = createWorldBatchCenters(loaded.world);
  }

  public async initialize(): Promise<void> {
    await Promise.all([
      this.resources.initialize(),
      this.sprites.initialize(),
      this.walkability.initialize(),
    ]);
  }

  public setWalkability(map: WalkabilityMap | null): void {
    if (this.disposed) return;
    this.walkability.setMap(map);
  }

  public get continuouslyAnimated(): boolean {
    return (
      this.resources.continuouslyAnimated || this.sprites.continuouslyAnimated
    );
  }

  public resize(width: number, height: number): void {
    this.canvasTarget.resize(width, height);
  }

  public render(
    projectionView: Float32Array,
    camera: CameraState,
    timeSeconds: number,
  ): void {
    if (this.disposed) return;
    const target = this.canvasTarget.current();
    if (!target) return;
    const encoder = this.device.createCommandEncoder({
      label: "Worldview frame",
    });
    this.encodeFrame(projectionView, camera, timeSeconds, encoder, target, {
      allFaces: false,
      includeSky: true,
      includeSprites: true,
      fullbright: false,
      zMin: 0,
      zMax: 0,
      clipZ: false,
      cutaway: null,
      sceneGroup: this.resources.sceneGroup,
      clearColor: this.clearColor,
    });
    this.device.queue.submit([encoder.finish()]);
  }

  public async captureOverview(
    projectionView: Float32Array,
    camera: CameraState,
    settings: OverviewRenderSettings,
  ): Promise<Uint8ClampedArray> {
    if (this.disposed) throw new Error("Worldview renderer has been disposed");
    const capture = new WorldCaptureTarget(
      this.root,
      this.format,
      settings.width,
      settings.height,
      settings.cutaway,
    );
    try {
      const cutawayView = capture.cutawayView;
      const sceneGroup = cutawayView
        ? this.resources.createSceneGroup(cutawayView)
        : this.resources.sceneGroup;
      const encoder = this.device.createCommandEncoder({
        label: "Worldview overview",
      });
      this.encodeFrame(
        projectionView,
        camera,
        0,
        encoder,
        capture.renderTarget,
        {
          allFaces: true,
          includeSky: settings.includeSky,
          includeSprites: settings.includeSprites,
          fullbright: settings.fullbright,
          zMin: settings.zMin,
          zMax: settings.zMax,
          clipZ: true,
          cutaway: settings.cutaway,
          sceneGroup,
          clearColor: settings.clearColor,
        },
      );
      capture.encodeCopy(encoder);
      this.device.queue.submit([encoder.finish()]);
      return await capture.readRgba();
    } finally {
      capture.dispose();
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvasTarget.dispose();
    this.sprites.dispose();
    this.walkability.dispose();
    this.resources.dispose();
  }

  private encodeFrame(
    projectionView: Float32Array,
    camera: CameraState,
    timeSeconds: number,
    encoder: GPUCommandEncoder,
    target: WorldRenderTarget,
    options: FrameOptions,
  ): void {
    this.resources.prepareScene(projectionView, camera, timeSeconds, options);
    const hasSprites = options.includeSprites && this.sprites.hasSprites;
    if (hasSprites) this.sprites.prepare(camera, timeSeconds);
    const worldFaceVisibility = options.allFaces
      ? null
      : this.visibleFaces(camera.position);
    const plan = createWorldFramePlan(this.loaded.world, {
      cameraPosition: camera.position,
      includeSky: options.includeSky,
      worldFaceVisibility,
      batchCenters: this.batchCenters,
      hasSprites,
      hasWalkability: !options.allFaces && this.walkability.hasContent,
    });
    encodeWorldPasses({
      encoder,
      target,
      plan,
      resources: this.resources,
      sprites: this.sprites,
      walkability: this.walkability,
      sceneGroup: options.sceneGroup,
      clearColor: options.clearColor,
      camera,
      timeSeconds,
    });
  }

  private visibleFaces(cameraPosition: Vec3Tuple): Uint8Array | null {
    const visibilityLeaf = this.loaded.world.visibility
      ? findBspLeaf(this.loaded.world.trace, cameraPosition)
      : null;
    if (visibilityLeaf !== this.visibilityLeaf) {
      this.visibilityLeaf = visibilityLeaf;
      this.worldFaceVisibility = visibleWorldFaceMask(
        this.loaded.world.trace,
        this.loaded.world.visibility,
        cameraPosition,
      );
    }
    return this.worldFaceVisibility;
  }
}
