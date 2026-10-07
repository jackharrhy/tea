import { defaultTextureProjection } from "./document-structure.js";
import { deriveBrush } from "./geometry.js";
import { add, planeFromPoints, scale } from "./math.js";
import type {
  Bounds,
  DerivedBrush,
  MapBrush,
  MapBrushDef,
  MapFace,
  MapPatch,
  MapPatchPoint,
  Vec2,
  Vec3,
} from "./types.js";

export interface DerivedPatchVertex {
  readonly position: Vec3;
  readonly uv: Vec2;
}

export interface DerivedPatch {
  readonly patchId: MapPatch["id"];
  readonly valid: boolean;
  readonly bounds: Bounds | null;
  readonly triangles: readonly DerivedPatchVertex[];
  readonly diagnostics: readonly string[];
}

function combineAxes(
  first: Vec3,
  firstScale: number,
  second: Vec3,
  secondScale: number,
): Vec3 {
  return add(scale(first, firstScale), scale(second, secondScale));
}

/** Converts idTech 3 brush-primitive texture matrices into the canonical convex-brush view. */
export function brushDefToBrush(brushDef: MapBrushDef): MapBrush {
  return {
    kind: "brush",
    id: brushDef.id,
    revision: brushDef.revision,
    faces: brushDef.faces.map<MapFace>((face) => {
      const plane = planeFromPoints(face.planePoints);
      const base = defaultTextureProjection(plane?.normal ?? [0, 0, 1]);
      return {
        id: face.id,
        planePoints: face.planePoints,
        material: face.material,
        projection: {
          kind: "valve-220",
          uAxis: combineAxes(
            base.uAxis,
            face.textureMatrix[0][0],
            base.vAxis,
            face.textureMatrix[0][1],
          ),
          vAxis: combineAxes(
            base.uAxis,
            face.textureMatrix[1][0],
            base.vAxis,
            face.textureMatrix[1][1],
          ),
          offset: [face.textureMatrix[0][2], face.textureMatrix[1][2]],
          rotationDegrees: 0,
          scale: [1, 1],
        },
        surface: face.surface,
      };
    }),
  };
}

export function deriveBrushDef(brushDef: MapBrushDef): DerivedBrush {
  return deriveBrush(brushDefToBrush(brushDef));
}

function quadraticWeights(value: number): readonly [number, number, number] {
  const inverse = 1 - value;
  return [inverse * inverse, 2 * inverse * value, value * value];
}

function patchPoint(
  controlPoints: readonly (readonly MapPatchPoint[])[],
  x: number,
  y: number,
  u: number,
  v: number,
): DerivedPatchVertex {
  const uWeights = quadraticWeights(u);
  const vWeights = quadraticWeights(v);
  const position: [number, number, number] = [0, 0, 0];
  const uv: [number, number] = [0, 0];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const point = controlPoints[y + row]![x + column]!;
      const weight = uWeights[column]! * vWeights[row]!;
      position[0] += point.position[0] * weight;
      position[1] += point.position[1] * weight;
      position[2] += point.position[2] * weight;
      uv[0] += point.uv[0] * weight;
      uv[1] += point.uv[1] * weight;
    }
  }
  return { position, uv };
}

function boundsForVertices(
  vertices: readonly DerivedPatchVertex[],
): Bounds | null {
  if (vertices.length === 0) return null;
  const min = [...vertices[0]!.position] as [number, number, number];
  const max = [...min] as [number, number, number];
  for (const { position } of vertices.slice(1)) {
    for (const axis of [0, 1, 2] as const) {
      min[axis] = Math.min(min[axis], position[axis]!);
      max[axis] = Math.max(max[axis], position[axis]!);
    }
  }
  return { min, max };
}

/** Tessellates odd-sized quadratic patch grids into renderable triangles. */
export function derivePatch(
  patch: MapPatch,
  segmentsPerSpan = 4,
): DerivedPatch {
  const diagnostics: string[] = [];
  const [width, height] = patch.dimensions;
  if (width < 3 || height < 3 || width % 2 === 0 || height % 2 === 0) {
    diagnostics.push("Patch dimensions must be odd and at least 3x3");
  }
  if (
    patch.controlPoints.length !== height ||
    patch.controlPoints.some((row) => row.length !== width)
  ) {
    diagnostics.push("Patch control grid does not match its dimensions");
  }
  if (!Number.isInteger(segmentsPerSpan) || segmentsPerSpan < 1) {
    diagnostics.push(
      "Patch tessellation must use at least one segment per span",
    );
  }
  if (diagnostics.length > 0) {
    return {
      patchId: patch.id,
      valid: false,
      bounds: null,
      triangles: [],
      diagnostics,
    };
  }
  const triangles: DerivedPatchVertex[] = [];
  for (let y = 0; y < height - 1; y += 2) {
    for (let x = 0; x < width - 1; x += 2) {
      for (let row = 0; row < segmentsPerSpan; row += 1) {
        for (let column = 0; column < segmentsPerSpan; column += 1) {
          const u0 = column / segmentsPerSpan;
          const u1 = (column + 1) / segmentsPerSpan;
          const v0 = row / segmentsPerSpan;
          const v1 = (row + 1) / segmentsPerSpan;
          const topLeft = patchPoint(patch.controlPoints, x, y, u0, v0);
          const topRight = patchPoint(patch.controlPoints, x, y, u1, v0);
          const bottomLeft = patchPoint(patch.controlPoints, x, y, u0, v1);
          const bottomRight = patchPoint(patch.controlPoints, x, y, u1, v1);
          triangles.push(
            topLeft,
            bottomLeft,
            topRight,
            topRight,
            bottomLeft,
            bottomRight,
          );
        }
      }
    }
  }
  return {
    patchId: patch.id,
    valid: true,
    bounds: boundsForVertices(triangles),
    triangles,
    diagnostics,
  };
}
