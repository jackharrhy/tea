import { invariant } from "./errors.js";
import { findBspLeaf, type ParsedBspTrace } from "./trace.js";
import type { Vec3Tuple } from "./types.js";

export interface ParsedBspVisibility {
  /** Number of non-solid world leaves represented by each PVS row. */
  readonly leafCount: number;
  readonly worldFaceCount: number;
  /** One compressed-visibility offset per BSP leaf. Leaf zero is the solid leaf. */
  readonly leafVisOffsets: Int32Array;
  readonly leafMarkSurfaceStarts: Uint32Array;
  readonly leafMarkSurfaceCounts: Uint32Array;
  readonly markSurfaces: Uint32Array;
  readonly data: Uint8Array;
}

function decompressedLeafMask(
  visibility: ParsedBspVisibility,
  offset: number,
): Uint8Array | null {
  if (offset < 0) return null;
  const byteCount = Math.ceil(visibility.leafCount / 8);
  const result = new Uint8Array(byteCount);
  let source = offset;
  let destination = 0;
  while (destination < byteCount) {
    invariant(
      source < visibility.data.length,
      "BSP visibility row is truncated",
    );
    const value = visibility.data[source++]!;
    if (value !== 0) {
      result[destination++] = value;
      continue;
    }
    invariant(
      source < visibility.data.length,
      "BSP visibility run is truncated",
    );
    const length = visibility.data[source++]!;
    invariant(length > 0, "BSP visibility contains an empty zero run");
    destination = Math.min(byteCount, destination + length);
  }
  return result;
}

/**
 * Marks world-model faces in the potentially visible set containing `point`.
 * Returns null when the BSP has no usable PVS for the point, which means callers should draw all.
 */
export function visibleWorldFaceMask(
  trace: ParsedBspTrace | null,
  visibility: ParsedBspVisibility | null,
  point: Vec3Tuple,
): Uint8Array | null {
  if (!trace || !visibility) return null;
  const leafIndex = findBspLeaf(trace, point);
  if (leafIndex === null || leafIndex <= 0 || leafIndex > visibility.leafCount)
    return null;
  const visOffset = visibility.leafVisOffsets[leafIndex];
  if (visOffset === undefined) return null;
  const visibleLeaves = decompressedLeafMask(visibility, visOffset);
  if (!visibleLeaves) return null;

  const faces = new Uint8Array(visibility.worldFaceCount);
  for (let cluster = 0; cluster < visibility.leafCount; cluster += 1) {
    if ((visibleLeaves[cluster >> 3]! & (1 << (cluster & 7))) === 0) continue;
    const visibleLeaf = cluster + 1;
    const first = visibility.leafMarkSurfaceStarts[visibleLeaf]!;
    const count = visibility.leafMarkSurfaceCounts[visibleLeaf]!;
    for (let index = first; index < first + count; index += 1) {
      const faceIndex = visibility.markSurfaces[index]!;
      if (faceIndex < faces.length) faces[faceIndex] = 1;
    }
  }
  return faces;
}
