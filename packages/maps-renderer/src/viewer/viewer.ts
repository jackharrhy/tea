import tgpu, { type TgpuRoot } from "typegpu";

import { planOverview, MapsError, type ParsedWorld } from "../core/index.js";
import { AnimationFrameScheduler } from "../runtime/frame-scheduler.js";
import { TypeGpuWorldRenderer } from "../render/renderer.js";
import {
  assertWalkabilityCompatible,
  generateWalkability as buildWalkability,
  planWalkabilityCutaway,
  type GenerateWalkabilityOptions,
  type WalkabilityMap,
} from "../walkability/index.js";
import { loadWorldAssets } from "./assets.js";
import { WorldAudio } from "./audio.js";
import { WorldCamera } from "./camera.js";
import { DEFAULT_MAPS_MOVEMENT, WorldControls } from "./controls.js";
import {
  overviewBlob,
  overviewCamera,
  overviewProjectionView,
} from "./overview.js";
import { WorldSurfaceIndex } from "./surface.js";
import { loadWalkabilitySource } from "./walkability-source.js";
import type {
  BinarySource,
  CameraState,
  CameraUpdate,
  CreateMapsOptions,
  LoadOptions,
  MapDiagnostics,
  OverviewCaptureOptions,
  OverviewCaptureResult,
  MapsMovementMode,
  MapsMovementUpdate,
  WorldSource,
  MapsEventMap,
  MapsViewer,
} from "./types.js";

const DEFAULT_CLEAR = [0.025, 0.035, 0.03, 1] as const;

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function combinedSignal(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal {
  const defined = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  return defined.length === 1 ? defined[0]! : AbortSignal.any(defined);
}

class MapsViewerImplementation extends EventTarget implements MapsViewer {
  public readonly canvas: HTMLCanvasElement;
  private readonly root: TgpuRoot;
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly cameraController = new WorldCamera();
  private readonly controls: WorldControls | null;
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private readonly fetchImplementation;
  private readonly maxDevicePixelRatio: number;
  private readonly clearColor: readonly [number, number, number, number];
  private readonly textureFiltering;
  private readonly creationSignal: AbortSignal | undefined;
  private readonly audioRuntime: WorldAudio;
  private readonly frameScheduler = new AnimationFrameScheduler();
  private readonly enableAudioOnInteraction: boolean;
  private renderer: TypeGpuWorldRenderer | null = null;
  private parsedWorld: ParsedWorld | null = null;
  private surfaceIndex: WorldSurfaceIndex | null = null;
  private mapDiagnostics: MapDiagnostics | null = null;
  private loadController: AbortController | null = null;
  private walkabilityController: AbortController | null = null;
  private walkabilityMap: WalkabilityMap | null = null;
  private walkabilityVisibleValue = false;
  private loadGeneration = 0;
  private lastFrameTime = 0;
  private visible = true;
  private isRunning = false;
  private disposed = false;

  public constructor(
    root: TgpuRoot,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    options: CreateMapsOptions,
  ) {
    super();
    this.root = root;
    this.context = context;
    this.format = format;
    this.canvas = options.canvas;
    this.fetchImplementation =
      options.fetch ?? globalThis.fetch.bind(globalThis);
    this.maxDevicePixelRatio = Math.max(0.5, options.maxDevicePixelRatio ?? 2);
    this.clearColor = options.clearColor ?? DEFAULT_CLEAR;
    this.textureFiltering = options.textureFiltering ?? "linear";
    this.creationSignal = options.signal;
    this.enableAudioOnInteraction = options.audio ?? true;
    this.audioRuntime = new WorldAudio(
      options.audioVolume ?? 0.8,
      (state) => {
        if (!this.disposed) this.emit("audiochange", { state });
      },
      options.playerAudioVolume ?? 1,
      options.musicVolume ?? 1,
      (message) => {
        if (!this.disposed)
          this.emit("warning", { code: "audio-warning", message });
      },
    );
    this.canvas.addEventListener("pointerdown", this.onAudioInteraction);
    const initialControls = options.controls ?? "walk";
    this.controls =
      initialControls !== "none"
        ? new WorldControls(
            this.canvas,
            initialControls,
            (look) => {
              if (look) {
                const camera = this.cameraController.value;
                this.cameraController.update({
                  yaw: camera.yaw + look.yaw,
                  pitch: camera.pitch + look.pitch,
                });
              }
              this.requestFrame();
            },
            () => this.emitMovementChange(),
            (event) => {
              const surfaceIndex = this.surfaceIndex;
              if (!surfaceIndex) return;
              this.audioRuntime.playPlayerSound(
                surfaceIndex.textureBelow(event.origin),
                event.kind,
                event.strength,
              );
            },
            options.movement,
          )
        : null;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.intersectionObserver = new IntersectionObserver((entries) => {
      this.visible = entries.at(-1)?.isIntersecting ?? true;
      this.updateAudioActiveState();
      if (this.visible && this.isRunning) {
        this.lastFrameTime = performance.now();
        this.frameScheduler.start();
      } else {
        this.frameScheduler.stop();
      }
    });
    this.intersectionObserver.observe(this.canvas);
    this.frameScheduler.setTarget({ render: this.renderFrame });
    void root.device.lost.then((info) => {
      if (this.disposed) return;
      const error = new MapsError(
        "device-lost",
        `WebGPU device lost: ${info.message || info.reason}`,
      );
      this.emit("error", { error });
      this.stop();
    });
  }

  public get camera(): CameraState {
    return this.cameraController.value;
  }

  public get diagnostics(): MapDiagnostics | null {
    return this.mapDiagnostics;
  }

  public get world(): ParsedWorld | null {
    return this.parsedWorld;
  }

  public get running(): boolean {
    return this.isRunning;
  }

  public get audio() {
    return this.audioRuntime.state;
  }

  public get movementMode(): MapsMovementMode {
    return this.controls?.mode ?? "none";
  }

  public get movement() {
    return this.controls?.settings ?? { ...DEFAULT_MAPS_MOVEMENT };
  }

  public get walkability(): WalkabilityMap | null {
    return this.walkabilityMap;
  }

  public get walkabilityVisible(): boolean {
    return this.walkabilityVisibleValue;
  }

  public async load(
    source: WorldSource,
    options: LoadOptions = {},
  ): Promise<void> {
    this.assertUsable();
    this.walkabilityController?.abort(
      new DOMException("Superseded by a newer map load", "AbortError"),
    );
    this.walkabilityController = null;
    this.loadController?.abort(
      new DOMException("Superseded by a newer map load", "AbortError"),
    );
    const controller = new AbortController();
    this.loadController = controller;
    const generation = ++this.loadGeneration;
    const signal = combinedSignal(
      controller.signal,
      options.signal,
      this.creationSignal,
    );
    const started = performance.now();

    try {
      const loaded = await loadWorldAssets(source, {
        fetch: this.fetchImplementation,
        signal,
        progress: (detail) => this.emit("progress", detail),
      });
      signal.throwIfAborted();
      this.emit("progress", {
        phase: "gpu",
        label: "GPU resources",
        loaded: 0,
        total: 1,
      });
      let renderer: TypeGpuWorldRenderer | undefined;
      try {
        renderer = new TypeGpuWorldRenderer(
          this.root,
          this.context,
          this.format,
          loaded,
          this.textureFiltering,
          this.clearColor,
        );
        await renderer.initialize();
      } catch (error) {
        renderer?.dispose();
        throw new MapsError(
          "gpu-initialization",
          "failed to compile Maps GPU pipelines",
          {
            cause: error,
          },
        );
      }
      if (
        generation !== this.loadGeneration ||
        signal.aborted ||
        this.disposed
      ) {
        renderer.dispose();
        signal.throwIfAborted();
        return;
      }

      this.renderer?.dispose();
      this.renderer = renderer;
      this.walkabilityMap = null;
      this.parsedWorld = loaded.world;
      this.surfaceIndex = new WorldSurfaceIndex(loaded.world);
      this.cameraController.reset(loaded.world);
      const collisionFallback =
        this.controls?.setWorld(loaded.world, this.cameraController) ?? false;
      this.emitMovementChange();
      this.audioRuntime.load(loaded);
      this.audioRuntime.updateCamera(this.cameraController.value);
      const collisionWarning = collisionFallback
        ? "this BSP has no standing player collision hull; navigation is using noclip"
        : null;
      const warningMessages = [
        ...loaded.warnings.map((warning) => warning.message),
        ...(collisionWarning ? [collisionWarning] : []),
      ];
      this.mapDiagnostics = {
        format: loaded.world.format,
        version: loaded.world.version,
        vertices: loaded.world.vertices.length / 7,
        triangles: loaded.world.indices.length / 3,
        faces: loaded.world.faces.length,
        batches: loaded.world.batches.length,
        materials: loaded.world.materials.length,
        lightmapPages: loaded.world.lightmapPages.length,
        sprites: loaded.sprites.length,
        ambientSounds: loaded.world.ambientSounds.length,
        envSounds: loaded.world.envSounds.length,
        musicTracks: loaded.world.musicTracks.length,
        loadedSounds: loaded.sounds.size,
        loadedMusic: loaded.music.size,
        playerSounds: loaded.playerSounds.size,
        missingTextures: loaded.missingTextures,
        missingSprites: loaded.missingSprites,
        missingSounds: loaded.missingSounds,
        missingMusic: loaded.missingMusic,
        warnings: warningMessages,
        loadMilliseconds: performance.now() - started,
      };
      for (const warning of loaded.warnings) this.emit("warning", warning);
      if (collisionWarning) {
        this.emit("warning", {
          code: "asset-warning",
          message: collisionWarning,
        });
      }
      this.emit("progress", {
        phase: "gpu",
        label: "GPU resources",
        loaded: 1,
        total: 1,
      });
      this.resize();
      this.emit("ready", {
        world: loaded.world,
        diagnostics: this.mapDiagnostics,
      });
      this.emitWalkabilityChange();
      this.requestFrame();
    } catch (error) {
      if (
        generation !== this.loadGeneration ||
        isAbort(error) ||
        signal.aborted
      )
        throw error;
      const typed = error instanceof Error ? error : new Error(String(error));
      this.emit("error", { error: typed });
      throw typed;
    } finally {
      if (generation === this.loadGeneration) this.loadController = null;
    }
  }

  public start(): void {
    this.assertUsable();
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.frameScheduler.start();
    this.updateAudioActiveState();
    this.requestFrame();
  }

  public stop(): void {
    this.isRunning = false;
    this.frameScheduler.stop();
    this.updateAudioActiveState();
  }

  public render(): void {
    if (this.disposed || !this.renderer) return;
    this.resizeCanvas();
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    this.renderer.render(
      this.cameraController.projectionView(aspect),
      this.cameraController.value,
      performance.now() / 1000,
    );
    this.audioRuntime.updateCamera(this.cameraController.value);
  }

  public async captureOverview(
    options: OverviewCaptureOptions = {},
  ): Promise<OverviewCaptureResult> {
    this.assertUsable();
    if (!this.renderer || !this.parsedWorld)
      throw new Error("Maps has no loaded map");
    const layout = planOverview(this.parsedWorld, {
      ...(options.width === undefined ? {} : { width: options.width }),
      ...(options.height === undefined ? {} : { height: options.height }),
      ...(options.padding === undefined ? {} : { padding: options.padding }),
      ...(options.rotation === undefined ? {} : { rotation: options.rotation }),
      ...(options.zMin === undefined ? {} : { zMin: options.zMin }),
      ...(options.zMax === undefined ? {} : { zMax: options.zMax }),
      ...(options.includeSky === undefined
        ? {}
        : { includeSky: options.includeSky }),
    });
    const cutawayMode = options.cutaway ?? "auto";
    if (
      cutawayMode !== "auto" &&
      cutawayMode !== "none" &&
      cutawayMode !== "walkability"
    ) {
      throw new RangeError(
        "Overview cutaway must be auto, none, or walkability",
      );
    }
    if (cutawayMode === "walkability" && !this.walkabilityMap) {
      throw new Error(
        "Overview walkability cutaway requires a loaded walkability graph",
      );
    }
    const useWalkability =
      cutawayMode === "walkability" ||
      (cutawayMode === "auto" && this.walkabilityMap !== null);
    const cutaway =
      useWalkability && this.walkabilityMap
        ? planWalkabilityCutaway(
            this.walkabilityMap,
            layout.bounds,
            options.cutawayOptions,
          )
        : null;
    const background = options.background ?? "transparent";
    if (
      background !== "transparent" &&
      background.some((value) => !Number.isFinite(value))
    ) {
      throw new RangeError("Overview background components must be finite");
    }
    const clearColor =
      background === "transparent"
        ? ([0, 0, 0, 0] as const)
        : (background.map((value) =>
            Math.min(1, Math.max(0, value)),
          ) as unknown as readonly [number, number, number, number]);
    const rgba = await this.renderer.captureOverview(
      overviewProjectionView(layout),
      overviewCamera(layout),
      {
        width: layout.width,
        height: layout.height,
        zMin: layout.zMin,
        zMax: layout.zMax,
        fullbright: options.lighting === "fullbright",
        includeSky: options.includeSky ?? false,
        includeSprites: options.includeSprites ?? false,
        clearColor,
        cutaway,
      },
    );
    const quality = options.quality;
    if (quality !== undefined && !Number.isFinite(quality)) {
      throw new RangeError("Overview image quality must be finite");
    }
    const image = await overviewBlob(
      rgba,
      layout.width,
      layout.height,
      options.imageType ?? "image/png",
      quality === undefined ? undefined : Math.min(1, Math.max(0, quality)),
    );
    return { image, layout };
  }

  public resize(): void {
    if (this.disposed) return;
    const changed = this.resizeCanvas();
    this.renderer?.resize(this.canvas.width, this.canvas.height);
    if (changed) this.requestFrame();
  }

  public setCamera(update: CameraUpdate): void {
    this.assertUsable();
    this.cameraController.update(update);
    if (update.position)
      this.controls?.synchronizeCamera(this.cameraController);
    this.audioRuntime.updateCamera(this.cameraController.value);
    this.requestFrame();
  }

  public setMovementMode(mode: Exclude<MapsMovementMode, "none">): void {
    this.assertUsable();
    if (!this.controls) throw new Error("Maps controls are disabled");
    if (!this.controls.setMode(mode, this.cameraController)) {
      throw new Error(
        "The loaded BSP does not contain a standing player collision hull",
      );
    }
  }

  public setMovement(update: MapsMovementUpdate): void {
    this.assertUsable();
    if (!this.controls) throw new Error("Maps controls are disabled");
    this.controls.setSettings(update);
    this.emitMovementChange();
  }

  public async generateWalkability(
    options: GenerateWalkabilityOptions = {},
  ): Promise<WalkabilityMap> {
    this.assertUsable();
    const world = this.parsedWorld;
    if (!world) throw new Error("Maps has no loaded map");
    this.walkabilityController?.abort(
      new DOMException(
        "Superseded by newer walkability generation",
        "AbortError",
      ),
    );
    const controller = new AbortController();
    this.walkabilityController = controller;
    const generation = this.loadGeneration;
    const signal = combinedSignal(
      controller.signal,
      options.signal,
      this.creationSignal,
    );
    try {
      const walkability = await buildWalkability(world, { ...options, signal });
      signal.throwIfAborted();
      if (this.disposed || generation !== this.loadGeneration) {
        throw new DOMException(
          "Map changed during walkability generation",
          "AbortError",
        );
      }
      this.applyWalkability(walkability);
      return walkability;
    } finally {
      if (this.walkabilityController === controller)
        this.walkabilityController = null;
    }
  }

  public async loadWalkability(
    source: BinarySource,
    options: LoadOptions = {},
  ): Promise<WalkabilityMap> {
    this.assertUsable();
    const world = this.parsedWorld;
    if (!world) throw new Error("Maps has no loaded map");
    this.walkabilityController?.abort(
      new DOMException("Superseded by newer walkability loading", "AbortError"),
    );
    const controller = new AbortController();
    this.walkabilityController = controller;
    const generation = this.loadGeneration;
    const signal = combinedSignal(
      controller.signal,
      options.signal,
      this.creationSignal,
    );
    try {
      const walkability = await loadWalkabilitySource(world, source, {
        fetch: this.fetchImplementation,
        signal,
        progress: (detail) => this.emit("progress", detail),
      });
      signal.throwIfAborted();
      if (this.disposed || generation !== this.loadGeneration) {
        throw new DOMException(
          "Map changed during walkability loading",
          "AbortError",
        );
      }
      this.applyWalkability(walkability);
      return walkability;
    } finally {
      if (this.walkabilityController === controller)
        this.walkabilityController = null;
    }
  }

  public setWalkability(walkability: WalkabilityMap | null): void {
    this.assertUsable();
    this.walkabilityController?.abort(
      new DOMException(
        "Superseded by direct walkability assignment",
        "AbortError",
      ),
    );
    this.walkabilityController = null;
    this.applyWalkability(walkability);
  }

  private applyWalkability(walkability: WalkabilityMap | null): void {
    if (walkability) {
      if (!this.parsedWorld) throw new Error("Maps has no loaded map");
      assertWalkabilityCompatible(this.parsedWorld, walkability);
    }
    this.walkabilityMap = walkability;
    this.renderer?.setWalkability(
      this.walkabilityVisibleValue ? walkability : null,
    );
    this.emitWalkabilityChange();
    this.requestFrame();
  }

  public setWalkabilityVisible(visible: boolean): void {
    this.assertUsable();
    this.walkabilityVisibleValue = visible;
    this.renderer?.setWalkability(visible ? this.walkabilityMap : null);
    this.emitWalkabilityChange();
    this.requestFrame();
  }

  public async enableAudio(): Promise<void> {
    this.assertUsable();
    await this.audioRuntime.enable();
    this.audioRuntime.updateCamera(this.cameraController.value);
    this.updateAudioActiveState();
  }

  public setAudioMuted(muted: boolean): void {
    this.assertUsable();
    this.audioRuntime.setMuted(muted);
  }

  public setAudioVolume(volume: number): void {
    this.assertUsable();
    this.audioRuntime.setVolume(volume);
  }

  public setPlayerAudioVolume(volume: number): void {
    this.assertUsable();
    this.audioRuntime.setPlayerVolume(volume);
  }

  public setMusicVolume(volume: number): void {
    this.assertUsable();
    this.audioRuntime.setMusicVolume(volume);
  }

  public async playMusic(entityIndex?: number): Promise<void> {
    this.assertUsable();
    await this.audioRuntime.playMusic(entityIndex);
    this.updateAudioActiveState();
  }

  public stopMusic(): void {
    this.assertUsable();
    this.audioRuntime.stopMusic();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.frameScheduler.dispose();
    this.loadGeneration += 1;
    this.loadController?.abort(
      new DOMException("Maps viewer disposed", "AbortError"),
    );
    this.loadController = null;
    this.walkabilityController?.abort(
      new DOMException("Maps viewer disposed", "AbortError"),
    );
    this.walkabilityController = null;
    this.stop();
    this.controls?.dispose();
    this.canvas.removeEventListener("pointerdown", this.onAudioInteraction);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.renderer?.dispose();
    this.audioRuntime.dispose();
    this.renderer = null;
    this.parsedWorld = null;
    this.surfaceIndex = null;
    this.mapDiagnostics = null;
    this.walkabilityMap = null;
    this.context.unconfigure();
    this.root.destroy();
  }

  public override addEventListener<K extends keyof MapsEventMap>(
    type: K,
    listener: (this: MapsViewer, event: MapsEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  public override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  public override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, callback, options);
  }

  public override removeEventListener<K extends keyof MapsEventMap>(
    type: K,
    listener: (this: MapsViewer, event: MapsEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  public override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
  public override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, callback, options);
  }

  private requestFrame(): void {
    if (
      this.disposed ||
      !this.isRunning ||
      !this.visible ||
      !this.canvas.isConnected
    )
      return;
    if (this.frameScheduler.request()) this.lastFrameTime = performance.now();
  }

  private readonly renderFrame = (time: number): boolean => {
    if (
      !this.isRunning ||
      !this.visible ||
      this.disposed ||
      !this.canvas.isConnected
    )
      return false;
    const delta = Math.min(
      0.1,
      Math.max(0, (time - this.lastFrameTime) / 1000),
    );
    this.lastFrameTime = time;
    const moved = this.controls?.update(this.cameraController, delta) ?? false;
    this.render();
    return Boolean(
      moved || this.controls?.active || this.renderer?.continuouslyAnimated,
    );
  };

  private updateAudioActiveState(): void {
    this.audioRuntime.setRuntimeActive(
      this.isRunning &&
        this.visible &&
        this.canvas.isConnected &&
        !this.disposed,
    );
  }

  private readonly onAudioInteraction = (): void => {
    const audio = this.audio;
    if (!this.enableAudioOnInteraction || (audio.enabled && !audio.suspended))
      return;
    void this.enableAudio().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.emit("warning", {
        code: "audio-warning",
        message: `audio could not be enabled: ${message}`,
      });
    });
  };

  private resizeCanvas(): boolean {
    const ratio = Math.min(
      this.maxDevicePixelRatio,
      Math.max(1, globalThis.devicePixelRatio || 1),
    );
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width === width && this.canvas.height === height)
      return false;
    this.canvas.width = width;
    this.canvas.height = height;
    this.renderer?.resize(width, height);
    return true;
  }

  private emit<K extends keyof MapsEventMap>(
    type: K,
    detail: MapsEventMap[K]["detail"],
  ): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  private emitMovementChange(): void {
    this.emit("movementchange", {
      mode: this.movementMode,
      settings: this.movement,
    });
  }

  private emitWalkabilityChange(): void {
    this.emit("walkabilitychange", {
      walkability: this.walkabilityMap,
      visible: this.walkabilityVisibleValue,
    });
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error("Maps viewer has been disposed");
  }
}

export async function createMapsViewer(
  options: CreateMapsOptions,
): Promise<MapsViewer> {
  if (!globalThis.navigator?.gpu) {
    throw new MapsError(
      "webgpu-unavailable",
      "Maps requires a browser with WebGPU support",
    );
  }
  options.signal?.throwIfAborted();
  let root: TgpuRoot;
  try {
    root = await tgpu.init();
  } catch (error) {
    throw new MapsError(
      "gpu-initialization",
      "Maps could not initialize WebGPU",
      {
        cause: error,
      },
    );
  }
  try {
    options.signal?.throwIfAborted();
  } catch (error) {
    root.destroy();
    throw error;
  }
  let context: GPUCanvasContext;
  let format: GPUTextureFormat;
  try {
    format = navigator.gpu.getPreferredCanvasFormat();
    context = root.configureContext({
      canvas: options.canvas,
      format,
      alphaMode: "opaque",
    });
  } catch (error) {
    root.destroy();
    throw new MapsError(
      "gpu-initialization",
      "Maps could not configure the canvas",
      {
        cause: error,
      },
    );
  }
  const viewer = new MapsViewerImplementation(root, context, format, options);
  if (options.autoStart ?? true) viewer.start();
  if (options.source) {
    try {
      await viewer.load(options.source);
    } catch (error) {
      viewer.dispose();
      throw error;
    }
  }
  return viewer;
}
