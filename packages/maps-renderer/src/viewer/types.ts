import type {
  BspFormat,
  BspVersion,
  BspWarning,
  OverviewLayout,
  OverviewRotation,
  ParsedWorld,
  SoundReference,
  SpriteReference,
  WadReference,
} from "../core/index.js";
import type { CameraState, TextureFiltering } from "../render/types.js";
import type {
  GenerateWalkabilityOptions,
  PlanWalkabilityCutawayOptions,
  WalkabilityMap,
} from "../walkability/index.js";

export type { CameraState, TextureFiltering } from "../render/types.js";

export type BinarySource = string | URL | Blob | ArrayBuffer | ArrayBufferView;
/** Initial navigation mode. Pressing V switches between walk and fly unless controls are disabled. */
export type MapsControls = "walk" | "fly" | "none";
export type MapsMovementMode = "walk" | "fly" | "none";
export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type OverviewLighting = "lightmapped" | "fullbright";
export type OverviewImageType = "image/png" | "image/webp";
export type OverviewCutaway = "auto" | "none" | "walkability";

export interface OverviewCaptureOptions {
  readonly width?: number;
  readonly height?: number;
  readonly padding?: number;
  readonly rotation?: OverviewRotation;
  readonly zMin?: number;
  readonly zMax?: number;
  readonly lighting?: OverviewLighting;
  readonly background?:
    | "transparent"
    | readonly [number, number, number, number];
  readonly includeSky?: boolean;
  readonly includeSprites?: boolean;
  /** Uses loaded walkability by default, falling back to an ordinary height slice. */
  readonly cutaway?: OverviewCutaway;
  readonly cutawayOptions?: PlanWalkabilityCutawayOptions;
  readonly imageType?: OverviewImageType;
  readonly quality?: number;
}

export interface OverviewCaptureResult {
  readonly image: Blob;
  readonly layout: OverviewLayout;
}

/** Runtime movement and mouse settings, expressed in GoldSrc-compatible units. */
export interface MapsMovementSettings {
  /** Player speed cap in map units per second. */
  readonly maxSpeed: number;
  readonly accelerate: number;
  readonly airAccelerate: number;
  readonly friction: number;
  readonly stopSpeed: number;
  readonly edgeFriction: number;
  /** GoldSrc-style `sensitivity`; 3 is the original default. */
  readonly mouseSensitivity: number;
  /** GoldSrc-style custom acceleration scale; zero disables acceleration. */
  readonly mouseAcceleration: number;
  /** Multiplier for the original `cl_bob 0.01` camera response. */
  readonly viewBob: number;
}

export type MapsMovementUpdate = Partial<MapsMovementSettings>;

export interface GoldSrcSkyboxSources {
  readonly rt: BinarySource;
  readonly bk: BinarySource;
  readonly lf: BinarySource;
  readonly ft: BinarySource;
  readonly up: BinarySource;
  readonly dn: BinarySource;
}

export type SpriteSources = Readonly<Record<string, BinarySource>>;
export type SoundSources = Readonly<Record<string, BinarySource>>;
export type GameAssetKind = "palette" | "texture" | "skybox";

export interface GameAssetReference {
  /** Normalized game-root path, such as `textures/e1u1/metal.wal`. */
  readonly path: string;
  readonly kind: GameAssetKind;
}

export type GameAssetSources = Readonly<Record<string, BinarySource>>;

export interface WorldSource {
  readonly bsp: BinarySource;
  /**
   * Base URL of a Quake, GoldSrc, or Quake II game/mod directory. Relative BSP URLs resolve beneath
   * it. Quake and GoldSrc use the legacy WAD/palette/sprite/skybox/sound layout; Quake II logical
   * assets resolve below `textures/`, `pics/`, and `env/`. More specific sources below override it.
   */
  readonly gameBaseUrl?: string | URL;
  /** Explicit game-root files. Keys use forward-slash paths and are matched case-insensitively. */
  readonly gameAssets?: GameAssetSources;
  /** Resolves a logical game-root path from a directory, archive mount, or remote asset service. */
  readonly resolveGameAsset?: (
    reference: GameAssetReference,
  ) =>
    | BinarySource
    | null
    | undefined
    | Promise<BinarySource | null | undefined>;
  /** Overrides game-root palettes and the bundled standard Quake palette. */
  readonly palette?: BinarySource;
  readonly wads?: readonly BinarySource[];
  readonly wadBaseUrl?: string | URL;
  readonly skybox?: GoldSrcSkyboxSources;
  readonly skyboxBaseUrl?: string | URL;
  readonly sprites?: SpriteSources;
  readonly spriteBaseUrl?: string | URL;
  readonly sounds?: SoundSources;
  /** Base URL of the game or mod's `sound` directory. */
  readonly soundBaseUrl?: string | URL;
  readonly resolveWad?: (
    reference: WadReference,
  ) =>
    | BinarySource
    | null
    | undefined
    | Promise<BinarySource | null | undefined>;
  readonly resolveSprite?: (
    reference: SpriteReference,
  ) =>
    | BinarySource
    | null
    | undefined
    | Promise<BinarySource | null | undefined>;
  readonly resolveSound?: (
    reference: SoundReference,
  ) =>
    | BinarySource
    | null
    | undefined
    | Promise<BinarySource | null | undefined>;
}

export interface LoadOptions {
  readonly signal?: AbortSignal;
}

export interface CreateMapsOptions {
  readonly canvas: HTMLCanvasElement;
  readonly source?: WorldSource;
  readonly controls?: MapsControls;
  readonly autoStart?: boolean;
  readonly textureFiltering?: TextureFiltering;
  readonly clearColor?: readonly [number, number, number, number];
  readonly maxDevicePixelRatio?: number;
  readonly signal?: AbortSignal;
  readonly fetch?: FetchLike;
  /** Enables map audio after the first explicit `enableAudio()` call or canvas interaction. */
  readonly audio?: boolean;
  readonly audioVolume?: number;
  readonly playerAudioVolume?: number;
  readonly musicVolume?: number;
  readonly movement?: MapsMovementUpdate;
}

export interface CameraUpdate {
  readonly position?: CameraState["position"];
  readonly yaw?: number;
  readonly pitch?: number;
  readonly fieldOfView?: number;
}

export interface MapDiagnostics {
  readonly format: BspFormat;
  readonly version: BspVersion;
  readonly vertices: number;
  readonly triangles: number;
  readonly faces: number;
  readonly batches: number;
  readonly materials: number;
  readonly lightmapPages: number;
  readonly sprites: number;
  readonly ambientSounds: number;
  readonly envSounds: number;
  readonly musicTracks: number;
  readonly loadedSounds: number;
  readonly loadedMusic: number;
  readonly playerSounds: number;
  readonly missingTextures: readonly string[];
  readonly missingSprites: readonly string[];
  readonly missingSounds: readonly string[];
  readonly missingMusic: readonly string[];
  readonly warnings: readonly string[];
  readonly loadMilliseconds: number;
}

export interface ProgressDetail {
  readonly phase:
    | "bsp"
    | "palette"
    | "wad"
    | "skybox"
    | "sprite"
    | "sound"
    | "walkability"
    | "parse"
    | "textures"
    | "gpu";
  /** Progress for the current transfer. This is normally measured in bytes. */
  readonly loaded: number;
  readonly total?: number;
  readonly label?: string;
  /** Stable item counts for concurrent work within this phase. */
  readonly phaseProgress?: {
    readonly completed: number;
    readonly total: number;
  };
}

export interface ReadyDetail {
  readonly world: ParsedWorld;
  readonly diagnostics: MapDiagnostics;
}

export type WarningDetail =
  | BspWarning
  | {
      readonly message: string;
      readonly code:
        | "missing-wad"
        | "missing-texture"
        | "missing-skybox"
        | "missing-sprite"
        | "missing-sound"
        | "audio-warning"
        | "asset-warning";
    };

export interface AudioState {
  readonly enabled: boolean;
  readonly suspended: boolean;
  readonly muted: boolean;
  readonly volume: number;
  readonly playerVolume: number;
  readonly musicVolume: number;
  readonly musicPlaying: boolean;
  readonly musicEntityIndex: number | null;
  readonly roomType: number;
}

export interface AudioChangeDetail {
  readonly state: AudioState;
}

export interface MovementChangeDetail {
  readonly mode: MapsMovementMode;
  readonly settings: MapsMovementSettings;
}

export interface WalkabilityChangeDetail {
  readonly walkability: WalkabilityMap | null;
  readonly visible: boolean;
}

export interface ErrorDetail {
  readonly error: Error;
}

export interface MapsEventMap {
  progress: CustomEvent<ProgressDetail>;
  ready: CustomEvent<ReadyDetail>;
  warning: CustomEvent<WarningDetail>;
  error: CustomEvent<ErrorDetail>;
  audiochange: CustomEvent<AudioChangeDetail>;
  movementchange: CustomEvent<MovementChangeDetail>;
  walkabilitychange: CustomEvent<WalkabilityChangeDetail>;
}

export interface MapsViewer extends EventTarget {
  readonly canvas: HTMLCanvasElement;
  readonly camera: CameraState;
  readonly diagnostics: MapDiagnostics | null;
  readonly world: ParsedWorld | null;
  readonly running: boolean;
  readonly audio: AudioState;
  readonly movementMode: MapsMovementMode;
  readonly movement: MapsMovementSettings;
  readonly walkability: WalkabilityMap | null;
  readonly walkabilityVisible: boolean;
  load(source: WorldSource, options?: LoadOptions): Promise<void>;
  start(): void;
  stop(): void;
  render(): void;
  captureOverview(
    options?: OverviewCaptureOptions,
  ): Promise<OverviewCaptureResult>;
  resize(): void;
  setCamera(update: CameraUpdate): void;
  setMovementMode(mode: Exclude<MapsMovementMode, "none">): void;
  setMovement(update: MapsMovementUpdate): void;
  generateWalkability(
    options?: GenerateWalkabilityOptions,
  ): Promise<WalkabilityMap>;
  loadWalkability(
    source: BinarySource,
    options?: LoadOptions,
  ): Promise<WalkabilityMap>;
  setWalkability(walkability: WalkabilityMap | null): void;
  setWalkabilityVisible(visible: boolean): void;
  enableAudio(): Promise<void>;
  setAudioMuted(muted: boolean): void;
  setAudioVolume(volume: number): void;
  setPlayerAudioVolume(volume: number): void;
  setMusicVolume(volume: number): void;
  playMusic(entityIndex?: number): Promise<void>;
  stopMusic(): void;
  dispose(): void;
  addEventListener<K extends keyof MapsEventMap>(
    type: K,
    listener: (this: MapsViewer, event: MapsEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof MapsEventMap>(
    type: K,
    listener: (this: MapsViewer, event: MapsEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
}
