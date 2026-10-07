import {
  brushDefsInDocument,
  deriveBrushDef,
  derivePatch,
  patchesInDocument,
  type MapDocument,
  type Vec3,
} from "../core/index.js";
import type { SolidBatchBuilder } from "./scene-solid-batches.js";
import type { EditorRenderTheme } from "./theme.js";

interface NonBrushPrimitiveSceneTarget {
  readonly source: MapDocument;
  readonly offset: Vec3;
  readonly lines: number[];
  readonly solidBatches: SolidBatchBuilder | null;
  readonly theme: EditorRenderTheme;
}

function appendBrushDefinitions(target: NonBrushPrimitiveSceneTarget): void {
  const { source, offset, lines, solidBatches, theme } = target;
  for (const brushDef of brushDefsInDocument(source)) {
    const derived = deriveBrushDef(brushDef);
    if (!derived.valid || !derived.bounds) continue;
    const signature = `${brushDef.id}:${brushDef.revision}:brush-def`;
    for (const face of derived.faces) {
      const solid = solidBatches?.vertices(
        face.material,
        derived.bounds,
        offset,
        signature,
      );
      if (solid?.retained) continue;
      for (let index = 1; index < face.vertices.length - 1; index += 1) {
        for (const vertexIndex of [0, index, index + 1]) {
          const point = face.vertices[vertexIndex]!;
          const uv = face.textureCoordinates[vertexIndex]!;
          solid?.push(
            point[0] + offset[0],
            point[1] + offset[1],
            point[2] + offset[2],
            ...theme.material,
            uv[0],
            uv[1],
          );
        }
      }
    }
    for (const edge of derived.edges) {
      lines.push(
        edge.start[0] + offset[0],
        edge.start[1] + offset[1],
        edge.start[2] + offset[2],
        ...theme.edge,
        edge.end[0] + offset[0],
        edge.end[1] + offset[1],
        edge.end[2] + offset[2],
        ...theme.edge,
      );
    }
  }
}

function appendPatches(target: NonBrushPrimitiveSceneTarget): void {
  const { source, offset, solidBatches, theme } = target;
  for (const patch of patchesInDocument(source)) {
    const derived = derivePatch(patch);
    if (!derived.valid || !derived.bounds) continue;
    const solid = solidBatches?.vertices(
      patch.material,
      derived.bounds,
      offset,
      `${patch.id}:${patch.revision}:patch`,
    );
    if (solid?.retained) continue;
    for (const vertex of derived.triangles) {
      solid?.push(
        vertex.position[0] + offset[0],
        vertex.position[1] + offset[1],
        vertex.position[2] + offset[2],
        ...theme.material,
        vertex.uv[0],
        vertex.uv[1],
      );
    }
  }
}

/** Adds format-specific primitives that deliberately do not participate in brush tools yet. */
export function appendNonBrushPrimitives(
  target: NonBrushPrimitiveSceneTarget,
): void {
  appendBrushDefinitions(target);
  appendPatches(target);
}
