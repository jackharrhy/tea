import { BinaryView } from "./binary.js";
import { invariant } from "./errors.js";
import type { BspFormat } from "./types.js";

export const BSP2_MAGIC = 0x32505342;
export const BSP2_2PSB_MAGIC = 0x42535032;

export interface QuakeBspLayout {
  readonly format: Extract<
    BspFormat,
    "quake-bsp29" | "quake-bsp2" | "goldsrc-bsp30"
  >;
  readonly version: 29 | 30 | "BSP2";
  readonly lightmapBytesPerTexel: 1 | 3;
  readonly embeddedPalette: boolean;
  readonly wide: boolean;
  readonly edgeSize: 4 | 8;
  readonly faceSize: 20 | 28;
  readonly nodeSize: 24 | 44;
  readonly leafSize: 28 | 44;
  readonly clipnodeSize: 8 | 12;
  readonly marksurfaceSize: 2 | 4;
}

export interface QuakeFaceRecord {
  readonly planeIndex: number;
  readonly side: number;
  readonly firstEdge: number;
  readonly edgeCount: number;
  readonly mappingIndex: number;
  readonly styles: readonly [number, number, number, number];
  readonly lightOffset: number;
}

export interface QuakeLeafRecord {
  readonly contents: number;
  readonly visibilityOffset: number;
  readonly firstMarkSurface: number;
  readonly markSurfaceCount: number;
}

const CLASSIC_LAYOUT = {
  wide: false,
  edgeSize: 4,
  faceSize: 20,
  nodeSize: 24,
  leafSize: 28,
  clipnodeSize: 8,
  marksurfaceSize: 2,
} as const;

const BSP2_LAYOUT = {
  format: "quake-bsp2",
  version: "BSP2",
  lightmapBytesPerTexel: 1,
  embeddedPalette: false,
  wide: true,
  edgeSize: 8,
  faceSize: 28,
  nodeSize: 44,
  leafSize: 44,
  clipnodeSize: 12,
  marksurfaceSize: 4,
} as const satisfies QuakeBspLayout;

export function quakeBspLayout(version: number): QuakeBspLayout | null {
  if (version === 29) {
    return {
      ...CLASSIC_LAYOUT,
      format: "quake-bsp29",
      version: 29,
      lightmapBytesPerTexel: 1,
      embeddedPalette: false,
    };
  }
  if (version === 30) {
    return {
      ...CLASSIC_LAYOUT,
      format: "goldsrc-bsp30",
      version: 30,
      lightmapBytesPerTexel: 3,
      embeddedPalette: true,
    };
  }
  return version === BSP2_MAGIC ? BSP2_LAYOUT : null;
}

export function readQuakeEdge(
  lump: BinaryView,
  index: number,
  layout: QuakeBspLayout,
): readonly [number, number] {
  const offset = index * layout.edgeSize;
  return layout.wide
    ? [lump.u32(offset), lump.u32(offset + 4)]
    : [lump.u16(offset), lump.u16(offset + 2)];
}

export function readQuakeFace(
  lump: BinaryView,
  index: number,
  layout: QuakeBspLayout,
): QuakeFaceRecord {
  const offset = index * layout.faceSize;
  const stylesOffset = layout.wide ? offset + 20 : offset + 12;
  return {
    planeIndex: layout.wide ? lump.i32(offset) : lump.u16(offset),
    side: layout.wide ? lump.i32(offset + 4) : lump.u16(offset + 2),
    firstEdge: layout.wide ? lump.i32(offset + 8) : lump.u32(offset + 4),
    edgeCount: layout.wide ? lump.i32(offset + 12) : lump.u16(offset + 8),
    mappingIndex: layout.wide ? lump.i32(offset + 16) : lump.u16(offset + 10),
    styles: [
      lump.u8(stylesOffset),
      lump.u8(stylesOffset + 1),
      lump.u8(stylesOffset + 2),
      lump.u8(stylesOffset + 3),
    ],
    lightOffset: lump.i32(layout.wide ? offset + 24 : offset + 16),
  };
}

function validateFiniteBounds(
  lump: BinaryView,
  offset: number,
  label: string,
): void {
  for (let component = 0; component < 6; component += 1) {
    invariant(
      Number.isFinite(lump.f32(offset + component * 4)),
      `${label} contains non-finite bounds`,
    );
  }
}

export function readQuakeTraceNode(
  lump: BinaryView,
  index: number,
  layout: QuakeBspLayout,
): readonly [number, number, number] {
  const offset = index * layout.nodeSize;
  if (layout.wide) validateFiniteBounds(lump, offset + 12, `node ${index}`);
  return layout.wide
    ? [lump.i32(offset), lump.i32(offset + 4), lump.i32(offset + 8)]
    : [lump.u32(offset), lump.i16(offset + 4), lump.i16(offset + 6)];
}

export function readQuakeLeaf(
  lump: BinaryView,
  index: number,
  layout: QuakeBspLayout,
): QuakeLeafRecord {
  const offset = index * layout.leafSize;
  if (layout.wide) validateFiniteBounds(lump, offset + 8, `leaf ${index}`);
  return {
    contents: lump.i32(offset),
    visibilityOffset: lump.i32(offset + 4),
    firstMarkSurface: layout.wide
      ? lump.u32(offset + 32)
      : lump.u16(offset + 20),
    markSurfaceCount: layout.wide
      ? lump.u32(offset + 36)
      : lump.u16(offset + 22),
  };
}

export function readQuakeClipnode(
  lump: BinaryView,
  index: number,
  layout: QuakeBspLayout,
): readonly [number, number, number] {
  const offset = index * layout.clipnodeSize;
  return layout.wide
    ? [lump.i32(offset), lump.i32(offset + 4), lump.i32(offset + 8)]
    : [lump.i32(offset), lump.i16(offset + 4), lump.i16(offset + 6)];
}

export function readQuakeMarkSurface(
  lump: BinaryView,
  index: number,
  layout: QuakeBspLayout,
): number {
  const offset = index * layout.marksurfaceSize;
  return layout.wide ? lump.u32(offset) : lump.u16(offset);
}
