import { BinaryView } from "./binary.js";
import { invalidData, invariant } from "./errors.js";

const IDSP = 0x5053_4449;
const SPRITE_VERSION = 2;
const MAX_FRAME_COUNT = 4096;
const MAX_FRAME_DIMENSION = 8192;
const MAX_DECODED_PIXELS = 64 * 1024 * 1024;

export type GoldSrcSpriteOrientation = 0 | 1 | 2 | 3 | 4;
export type GoldSrcSpriteTextureFormat = 0 | 1 | 2 | 3;
export type GoldSrcSpriteFrameKind = "single" | "group";

export interface SpriteReference {
  readonly declaredPath: string;
  readonly normalizedPath: string;
  readonly basename: string;
}

export function spriteReference(path: string): SpriteReference | undefined {
  const declaredPath = path.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!declaredPath.toLowerCase().endsWith(".spr")) return undefined;
  const parts = declaredPath
    .split("/")
    .filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === ".."))
    return undefined;
  const normalizedPath = parts.join("/").toLowerCase();
  const basename = parts.at(-1)?.toLowerCase();
  if (!basename) return undefined;
  return { declaredPath: parts.join("/"), normalizedPath, basename };
}

export interface DecodedSpriteFrame {
  readonly origin: readonly [number, number];
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export interface SpriteFrameSequence {
  readonly kind: GoldSrcSpriteFrameKind;
  readonly intervals: readonly number[];
  readonly frames: readonly DecodedSpriteFrame[];
}

export interface ParsedGoldSrcSprite {
  readonly version: 2;
  readonly orientation: GoldSrcSpriteOrientation;
  readonly textureFormat: GoldSrcSpriteTextureFormat;
  readonly radius: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly beamLength: number;
  readonly syncType: number;
  readonly frames: readonly SpriteFrameSequence[];
}

class SpriteCursor {
  public offset: number;

  public constructor(
    private readonly source: BinaryView,
    offset: number,
  ) {
    this.offset = offset;
  }

  public u16(label: string): number {
    this.source.require(this.offset, 2, label);
    const value = this.source.u16(this.offset);
    this.offset += 2;
    return value;
  }

  public u32(label: string): number {
    this.source.require(this.offset, 4, label);
    const value = this.source.u32(this.offset);
    this.offset += 4;
    return value;
  }

  public i32(label: string): number {
    this.source.require(this.offset, 4, label);
    const value = this.source.i32(this.offset);
    this.offset += 4;
    return value;
  }

  public f32(label: string): number {
    this.source.require(this.offset, 4, label);
    const value = this.source.f32(this.offset);
    this.offset += 4;
    return value;
  }

  public bytes(length: number, label: string): Uint8Array {
    this.source.require(this.offset, length, label);
    const value = this.source.uint8Array(this.offset, length);
    this.offset += length;
    return value;
  }
}

function decodePixels(
  indices: Uint8Array,
  palette: Uint8Array,
  textureFormat: GoldSrcSpriteTextureFormat,
): Uint8Array {
  const rgba = new Uint8Array(indices.length * 4);
  const indexAlphaColor = palette.subarray(255 * 3, 256 * 3);
  for (let index = 0; index < indices.length; index += 1) {
    const paletteIndex = indices[index]!;
    const destination = index * 4;
    if (textureFormat === 2) {
      rgba[destination] = indexAlphaColor[0] ?? 0;
      rgba[destination + 1] = indexAlphaColor[1] ?? 0;
      rgba[destination + 2] = indexAlphaColor[2] ?? 0;
      rgba[destination + 3] = paletteIndex;
      continue;
    }
    if (textureFormat === 3 && paletteIndex === 255) continue;
    const paletteOffset = paletteIndex * 3;
    rgba[destination] = palette[paletteOffset] ?? 0;
    rgba[destination + 1] = palette[paletteOffset + 1] ?? 0;
    rgba[destination + 2] = palette[paletteOffset + 2] ?? 0;
    rgba[destination + 3] = 255;
  }
  return rgba;
}

export function parseGoldSrcSprite(
  input: ArrayBuffer | ArrayBufferView,
): ParsedGoldSrcSprite {
  const source = new BinaryView(input);
  source.require(0, 42, "GoldSrc sprite header");
  invariant(
    source.u32(0) === IDSP,
    "GoldSrc sprite has an invalid IDSP signature",
  );
  invariant(
    source.u32(4) === SPRITE_VERSION,
    "only GoldSrc sprite version 2 is supported",
  );

  const orientation = source.u32(8);
  const textureFormat = source.u32(12);
  invariant(
    orientation <= 4,
    `GoldSrc sprite orientation ${orientation} is unsupported`,
  );
  invariant(
    textureFormat <= 3,
    `GoldSrc sprite texture format ${textureFormat} is unsupported`,
  );
  const radius = source.f32(16);
  const maxWidth = source.i32(20);
  const maxHeight = source.i32(24);
  const frameCount = source.i32(28);
  invariant(
    Number.isFinite(radius) && radius >= 0,
    "GoldSrc sprite radius is invalid",
  );
  invariant(
    maxWidth > 0 && maxWidth <= MAX_FRAME_DIMENSION,
    "GoldSrc sprite maximum width is invalid",
  );
  invariant(
    maxHeight > 0 && maxHeight <= MAX_FRAME_DIMENSION,
    "GoldSrc sprite maximum height is invalid",
  );
  invariant(
    frameCount > 0 && frameCount <= MAX_FRAME_COUNT,
    "GoldSrc sprite frame count is invalid",
  );

  const cursor = new SpriteCursor(source, 40);
  const paletteCount = cursor.u16("GoldSrc sprite palette count");
  invariant(
    paletteCount > 0 && paletteCount <= 256,
    "GoldSrc sprite palette count must be between 1 and 256",
  );
  const palette = new Uint8Array(256 * 3);
  palette.set(cursor.bytes(paletteCount * 3, "GoldSrc sprite palette"));

  let decodedPixels = 0;
  const readFrame = (label: string): DecodedSpriteFrame => {
    const originX = cursor.i32(`${label} origin x`);
    const originY = cursor.i32(`${label} origin y`);
    const width = cursor.i32(`${label} width`);
    const height = cursor.i32(`${label} height`);
    invariant(
      width > 0 && width <= MAX_FRAME_DIMENSION,
      `${label} width is outside the supported range`,
    );
    invariant(
      height > 0 && height <= MAX_FRAME_DIMENSION,
      `${label} height is outside the supported range`,
    );
    const pixelCount = width * height;
    invariant(
      Number.isSafeInteger(pixelCount),
      `${label} pixel count is invalid`,
    );
    decodedPixels += pixelCount;
    invariant(
      decodedPixels <= MAX_DECODED_PIXELS,
      "GoldSrc sprite is too large to decode safely",
    );
    const indices = cursor.bytes(pixelCount, `${label} pixels`);
    return {
      origin: [originX, originY],
      width,
      height,
      rgba: decodePixels(
        indices,
        palette,
        textureFormat as GoldSrcSpriteTextureFormat,
      ),
    };
  };

  const frames: SpriteFrameSequence[] = [];
  for (let sequenceIndex = 0; sequenceIndex < frameCount; sequenceIndex += 1) {
    const frameType = cursor.u32(`GoldSrc sprite frame ${sequenceIndex} type`);
    if (frameType === 0) {
      frames.push({
        kind: "single",
        intervals: [],
        frames: [readFrame(`GoldSrc sprite frame ${sequenceIndex}`)],
      });
      continue;
    }
    if (frameType !== 1) {
      invalidData(
        `GoldSrc sprite frame ${sequenceIndex} has unknown type ${frameType}`,
      );
    }
    const groupCount = cursor.i32(
      `GoldSrc sprite frame ${sequenceIndex} group count`,
    );
    invariant(
      groupCount >= 1 && groupCount <= MAX_FRAME_COUNT,
      `GoldSrc sprite frame ${sequenceIndex} group count is invalid`,
    );
    const intervals: number[] = [];
    for (
      let intervalIndex = 0;
      intervalIndex < groupCount;
      intervalIndex += 1
    ) {
      const interval = cursor.f32(
        `GoldSrc sprite frame ${sequenceIndex} interval ${intervalIndex}`,
      );
      invariant(
        Number.isFinite(interval) && interval > 0,
        `GoldSrc sprite frame ${sequenceIndex} interval ${intervalIndex} is invalid`,
      );
      invariant(
        intervalIndex === 0 || interval >= intervals[intervalIndex - 1]!,
        `GoldSrc sprite frame ${sequenceIndex} intervals must be cumulative`,
      );
      intervals.push(interval);
    }
    const groupFrames: DecodedSpriteFrame[] = [];
    for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
      groupFrames.push(
        readFrame(`GoldSrc sprite frame ${sequenceIndex}.${groupIndex}`),
      );
    }
    frames.push({
      kind: "group",
      intervals,
      frames: groupFrames,
    });
  }

  return {
    version: 2,
    orientation: orientation as GoldSrcSpriteOrientation,
    textureFormat: textureFormat as GoldSrcSpriteTextureFormat,
    radius,
    maxWidth,
    maxHeight,
    beamLength: source.f32(32),
    syncType: source.u32(36),
    frames,
  };
}
