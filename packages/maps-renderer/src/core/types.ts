import type {
  ParsedAmbientSound,
  ParsedEnvSound,
  ParsedMusicTrack,
} from "./audio.js";
import type { ParsedBspCollision } from "./collision.js";
import type { BspEntity, WadReference } from "./entities.js";
import type { ParsedBspTrace } from "./trace.js";
import type { ParsedBspVisibility } from "./visibility.js";

export type Vec3Tuple = readonly [number, number, number];
export type BspFormat =
  | "quake-bsp29"
  | "quake-bsp2"
  | "goldsrc-bsp30"
  | "quake2-bsp38";
export type BspVersion = 29 | 30 | 38 | "BSP2";
export type MaterialKind = "opaque" | "alpha-test" | "water" | "sky" | "tool";
export type GoldSrcRenderMode = 0 | 1 | 2 | 3 | 4 | 5;

export interface Bounds {
  readonly min: Vec3Tuple;
  readonly max: Vec3Tuple;
}

export interface ParsedMipTexture {
  /** Index in the BSP texture table or WAD directory that owns this record. */
  readonly sourceIndex: number;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface DecodedMipLevel {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  /** Quake palette indices 224–255, excluding transparent pixels; rgba keeps the original color. */
  readonly fullbrightRgba?: Uint8Array;
}

export interface DecodedMipTexture {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly levels: readonly DecodedMipLevel[];
  readonly alphaTest: boolean;
}

export interface DecodedQuakeSky {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly solid: Uint8Array;
  readonly alpha: Uint8Array;
}

export interface ParsedMaterial {
  readonly name: string;
  readonly kind: MaterialKind;
  readonly embeddedTexture?: ParsedMipTexture;
  /** Surface opacity after format-specific flags have been normalized. */
  readonly opacity?: number;
  /** Texture-space scrolling speed in pixels per second. */
  readonly scrollSpeed?: number;
  /** Quake II texinfo animation link; absent for formats without texinfo chains. */
  readonly nextMaterialIndex?: number | null;
  /** Raw Quake II texinfo metadata retained for diagnostics and format-specific consumers. */
  readonly surfaceFlags?: number;
  readonly surfaceValue?: number;
}

export type BspWarning =
  | {
      readonly code: "noncanonical-miptex-dimensions";
      readonly message: string;
      readonly textureIndex: number;
      readonly textureName: string;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly code: "degenerate-face";
      readonly message: string;
      readonly faceIndex: number;
      readonly modelIndex: number;
      readonly edgeCount: number;
    }
  | {
      readonly code: "unusable-miptex";
      readonly message: string;
      readonly textureIndex: number;
      readonly textureName: string;
      readonly reason: string;
    }
  | {
      readonly code: "noncanonical-visibility-run";
      readonly message: string;
    }
  | {
      readonly code: "noncanonical-collision-headnode";
      readonly message: string;
      readonly modelIndex: number;
      readonly hullIndex: number;
      readonly headNode: number;
    }
  | {
      readonly code: "noncanonical-inverted-model-bounds";
      readonly message: string;
      readonly modelIndex: number;
      readonly axes: readonly ("x" | "y" | "z")[];
    };

export interface ParsedLightmap {
  readonly faceIndex: number;
  readonly width: number;
  readonly height: number;
  readonly styles: readonly number[];
  readonly samples: Uint8Array | null;
  readonly pageIndex: number;
  readonly pageX: number;
  readonly pageY: number;
}

export interface LightmapPage {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly lightmaps: readonly ParsedLightmap[];
}

export interface ParsedFace {
  readonly sourceIndex: number;
  readonly modelIndex: number;
  readonly materialIndex: number;
  readonly kind: MaterialKind;
  readonly firstIndex: number;
  readonly indexCount: number;
  readonly lightmap: ParsedLightmap;
}

export interface DrawBatch {
  readonly modelIndex: number;
  readonly materialIndex: number;
  readonly kind: Exclude<MaterialKind, "tool">;
  readonly lightmapPage: number;
  readonly firstIndex: number;
  readonly indexCount: number;
  readonly faceIndices: readonly number[];
}

export interface ParsedModel {
  readonly bounds: Bounds;
  readonly headnodes: readonly number[];
  readonly faceIndices: readonly number[];
  readonly visible: boolean;
  readonly entityIndex: number | null;
  readonly classname: string;
  /** True for the world and supported, non-moving solid brush entities. */
  readonly collidable: boolean;
  readonly renderMode: GoldSrcRenderMode;
  readonly renderAmount: number;
  readonly renderColor: Vec3Tuple;
  /** Signed texture-space units per second for GoldSrc `scroll*` materials. */
  readonly textureScrollSpeed: number;
}

export interface ParsedWorld {
  readonly format: BspFormat;
  readonly version: BspVersion;
  readonly warnings: readonly BspWarning[];
  readonly bounds: Bounds;
  readonly entities: readonly BspEntity[];
  readonly skyName: string | null;
  readonly wadReferences: readonly WadReference[];
  readonly ambientSounds: readonly ParsedAmbientSound[];
  readonly envSounds: readonly ParsedEnvSound[];
  readonly musicTracks: readonly ParsedMusicTrack[];
  readonly trace: ParsedBspTrace | null;
  readonly visibility: ParsedBspVisibility | null;
  readonly collision: ParsedBspCollision | null;
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly materials: readonly ParsedMaterial[];
  readonly faces: readonly ParsedFace[];
  readonly batches: readonly DrawBatch[];
  readonly models: readonly ParsedModel[];
  /** Whether the BSP contains baked lighting, even if individual faces have no samples. */
  readonly hasLighting: boolean;
  readonly lightmapPages: readonly LightmapPage[];
  readonly lightmapBytesPerTexel: 1 | 3;
  readonly hasAnimatedLightmaps: boolean;
}
