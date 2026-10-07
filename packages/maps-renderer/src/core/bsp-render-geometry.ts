import { invariant } from "./errors.js";
import type {
  DrawBatch,
  MaterialKind,
  ParsedFace,
  ParsedLightmap,
  ParsedMaterial,
  Vec3Tuple,
} from "./types.js";

export interface BspTextureMapping {
  readonly s: readonly [number, number, number, number];
  readonly t: readonly [number, number, number, number];
  readonly materialIndex: number;
}

export interface BspLightmapMapping {
  readonly s: readonly [number, number, number, number];
  readonly t: readonly [number, number, number, number];
  readonly scale: number;
  readonly minimumS: number;
  readonly minimumT: number;
}

export interface BspRenderFace {
  readonly sourceIndex: number;
  readonly modelIndex: number;
  readonly materialIndex: number;
  readonly kind: MaterialKind;
  readonly firstEdge: number;
  readonly edgeCount: number;
  readonly mapping: BspTextureMapping;
  readonly lightmapMapping: BspLightmapMapping;
  readonly lightmap: ParsedLightmap;
}

export interface BspRenderGeometry {
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly faces: readonly ParsedFace[];
  readonly batches: readonly DrawBatch[];
}

function dotMapping(
  position: Vec3Tuple,
  mapping: readonly [number, number, number, number],
): number {
  return (
    position[0] * mapping[0] +
    position[1] * mapping[1] +
    position[2] * mapping[2] +
    mapping[3]
  );
}

export function buildBspRenderGeometry(
  positions: readonly Vec3Tuple[],
  surfaceVertexIndices: Uint32Array,
  materials: readonly ParsedMaterial[],
  rawFaces: readonly BspRenderFace[],
): BspRenderGeometry {
  const renderOrder = rawFaces.toSorted(
    (left, right) =>
      left.modelIndex - right.modelIndex ||
      left.kind.localeCompare(right.kind) ||
      left.materialIndex - right.materialIndex ||
      left.lightmap.pageIndex - right.lightmap.pageIndex ||
      left.sourceIndex - right.sourceIndex,
  );
  const vertexValues: number[] = [];
  const indexValues: number[] = [];
  const parsedFaces: ParsedFace[] = [];
  const batches: DrawBatch[] = [];

  for (const face of renderOrder) {
    const baseVertex = vertexValues.length / 7;
    const firstIndex = indexValues.length;
    for (let edge = 0; edge < face.edgeCount; edge += 1) {
      const positionIndex = surfaceVertexIndices[face.firstEdge + edge];
      const position = positions[positionIndex ?? positions.length];
      invariant(
        position !== undefined,
        `face ${face.sourceIndex} references a missing vertex`,
      );
      const s = dotMapping(position, face.mapping.s);
      const t = dotMapping(position, face.mapping.t);
      const lightmapSCoordinate =
        dotMapping(position, face.lightmapMapping.s) *
        face.lightmapMapping.scale;
      const lightmapTCoordinate =
        dotMapping(position, face.lightmapMapping.t) *
        face.lightmapMapping.scale;
      const lightmapS =
        face.lightmap.pageIndex < 0
          ? 0.5
          : face.lightmap.pageX +
            lightmapSCoordinate -
            face.lightmapMapping.minimumS +
            0.5;
      const lightmapT =
        face.lightmap.pageIndex < 0
          ? 0.5
          : face.lightmap.pageY +
            lightmapTCoordinate -
            face.lightmapMapping.minimumT +
            0.5;
      vertexValues.push(
        position[0],
        position[1],
        position[2],
        s,
        t,
        lightmapS,
        lightmapT,
      );
    }
    for (let edge = 2; edge < face.edgeCount; edge += 1) {
      indexValues.push(baseVertex, baseVertex + edge - 1, baseVertex + edge);
    }
    const indexCount = (face.edgeCount - 2) * 3;
    parsedFaces.push({
      sourceIndex: face.sourceIndex,
      modelIndex: face.modelIndex,
      materialIndex: face.materialIndex,
      kind: face.kind,
      firstIndex,
      indexCount,
      lightmap: face.lightmap,
    });

    if (face.kind === "tool") continue;
    invariant(
      materials[face.materialIndex] !== undefined,
      "face references a missing material",
    );
    const previous = batches.at(-1);
    if (
      previous &&
      previous.modelIndex === face.modelIndex &&
      previous.materialIndex === face.materialIndex &&
      previous.kind === face.kind &&
      previous.lightmapPage === face.lightmap.pageIndex &&
      previous.firstIndex + previous.indexCount === firstIndex
    ) {
      batches[batches.length - 1] = {
        ...previous,
        indexCount: previous.indexCount + indexCount,
        faceIndices: [...previous.faceIndices, face.sourceIndex],
      };
    } else {
      batches.push({
        modelIndex: face.modelIndex,
        materialIndex: face.materialIndex,
        kind: face.kind,
        lightmapPage: face.lightmap.pageIndex,
        firstIndex,
        indexCount,
        faceIndices: [face.sourceIndex],
      });
    }
  }

  return {
    vertices: new Float32Array(vertexValues),
    indices: new Uint32Array(indexValues),
    faces: parsedFaces.toSorted(
      (left, right) => left.sourceIndex - right.sourceIndex,
    ),
    batches,
  };
}
