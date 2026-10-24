import {
  deriveBrush,
  findBrush,
  pointEntitiesInDocument,
  pointEntityBounds,
  type Bounds,
  type BrushId,
  type EntityDefinitionCatalog,
  type MapDocument,
  type Vec3,
} from "../core/index.js";
import { uploadFloatBuffer } from "./gpu-buffer.js";
import {
  brushSolidSignature,
  SolidBatchBuilder,
  type SolidBatch,
} from "./scene-solid-batches.js";

export interface SelectionOverlaySource {
  readonly key: string;
  readonly color: readonly [number, number, number];
  readonly document: MapDocument;
  readonly objectIds: readonly string[];
  readonly pointer?: Vec3;
}

export interface SelectionOverlayBuffers {
  readonly lines: GPUBuffer;
  readonly lineCount: number;
  readonly solids: readonly SolidBatch[];
}

function appendBounds(
  lines: number[],
  bounds: Bounds,
  color: readonly number[],
): void {
  const [x0, y0, z0] = bounds.min;
  const [x1, y1, z1] = bounds.max;
  const corners: readonly Vec3[] = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  for (const [start, end] of [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ] as const)
    lines.push(...corners[start]!, ...color, ...corners[end]!, ...color);
}

/** Builds the common textured-face tint and X-ray edge treatment for local and remote selection. */
export function buildSelectionOverlayBuffers(
  device: GPUDevice,
  sources: readonly SelectionOverlaySource[],
  entityDefinitions?: EntityDefinitionCatalog,
): SelectionOverlayBuffers {
  const lines: number[] = [];
  const solids = new SolidBatchBuilder();
  for (const source of sources) {
    const ids = new Set(source.objectIds);
    for (const id of ids) {
      const brush = findBrush(source.document, id as BrushId);
      const derived = brush ? deriveBrush(brush) : null;
      if (!brush || !derived?.valid || !derived.bounds) continue;
      for (const edge of derived.edges) {
        lines.push(
          ...edge.start,
          ...source.color,
          ...edge.end,
          ...source.color,
        );
      }
      const solid = solids.vertices(
        `__maps_selection__:${source.key}`,
        derived.bounds,
        [0, 0, 0],
        `${source.key}:${brushSolidSignature(brush, [0, 0, 0])}`,
      );
      for (const face of derived.faces) {
        for (let index = 1; index < face.vertices.length - 1; index += 1) {
          for (const vertexIndex of [0, index, index + 1]) {
            solid.push(...face.vertices[vertexIndex]!, ...source.color, 0, 0);
          }
        }
      }
    }
    for (const entity of pointEntitiesInDocument(
      source.document,
      entityDefinitions,
    )) {
      if (!ids.has(entity.id)) continue;
      const bounds = pointEntityBounds(entity, entityDefinitions);
      if (bounds) appendBounds(lines, bounds, source.color);
    }
    if (source.pointer) {
      for (let axis = 0; axis < 3; axis += 1) {
        const start: [number, number, number] = [...source.pointer];
        const end: [number, number, number] = [...source.pointer];
        start[axis] = start[axis]! - 6;
        end[axis] = end[axis]! + 6;
        lines.push(...start, ...source.color, ...end, ...source.color);
      }
    }
  }
  const data = new Float32Array(lines);
  return {
    lines: uploadFloatBuffer(
      device,
      data,
      GPUBufferUsage.VERTEX,
      "Selection edges",
    ),
    lineCount: data.length / 6,
    solids: solids.finish(device),
  };
}
