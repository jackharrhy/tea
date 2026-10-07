import type {
  DecodedMipTexture,
  DecodedQuakeSky,
  DecodedTga,
  ParsedGoldSrcSprite,
  ParsedWorld,
  SpriteReference,
  Vec3Tuple,
} from "../core/index.js";

export interface LoadedMaterialTexture {
  readonly texture: DecodedMipTexture;
  /** Dimensions used to normalize BSP texture-space coordinates. */
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly quakeSky?: DecodedQuakeSky;
}

export interface LoadedSpriteEntity {
  readonly entityIndex: number;
  readonly reference: SpriteReference;
  readonly sprite: ParsedGoldSrcSprite;
  readonly origin: Vec3Tuple;
  readonly angles: Vec3Tuple;
  readonly scale: number;
  readonly renderMode: number;
  readonly renderAmount: number;
  readonly renderColor: readonly [number, number, number];
  readonly frame: number;
  readonly frameRate: number;
  readonly receivesLight: boolean;
  readonly lightColor: readonly [number, number, number];
}

export type SkyboxSuffix = "rt" | "bk" | "lf" | "ft" | "up" | "dn";

export interface LoadedSkybox {
  readonly name: string;
  readonly sides: Readonly<Record<SkyboxSuffix, DecodedTga>>;
}

/** GPU resources required to render a loaded world, separate from fetching and Web Audio. */
export interface RenderWorldAssets {
  readonly world: ParsedWorld;
  readonly materialTextures: ReadonlyMap<number, LoadedMaterialTexture>;
  readonly skybox?: LoadedSkybox;
  readonly sprites: readonly LoadedSpriteEntity[];
}
