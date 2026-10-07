import { brushVertices, deriveBrush } from "./geometry.js";
import {
  add,
  dot,
  GEOMETRY_EPSILON,
  planeFromPoints,
  scale,
  type Plane,
} from "./math.js";
import { cloneBrush, defaultTextureProjection } from "./document-structure.js";
import { mapTriple } from "./document-helpers.js";
import {
  convexHullPlanes,
  moveBrushFace,
  uniqueHullPoints,
  type VertexHullPoint,
} from "./brush-transforms.js";
import { createSequentialIdFactory } from "./types.js";
import type { FaceId, IdFactory, MapBrush, MapFace, Vec3 } from "./types.js";

function copyFaceAttributes(
  brush: MapBrush,
  faceId: FaceId,
  source: MapFace,
): MapBrush {
  return {
    ...brush,
    faces: brush.faces.map((face) =>
      face.id === faceId
        ? {
            ...face,
            material: source.material,
            projection: source.projection,
            surface: source.surface,
          }
        : face,
    ),
  };
}

/**
 * Splits a face drag into two adjacent convex brushes. Outward movement adds a slab to the original
 * volume; inward movement partitions the original volume at the destination plane.
 */
export function splitBrushFace(
  brush: MapBrush,
  faceId: FaceId,
  distance: number,
  ids: IdFactory,
): readonly [MapBrush, MapBrush] {
  if (!Number.isFinite(distance) || Math.abs(distance) <= Number.EPSILON) {
    throw new Error("Face split distance must be finite and non-zero");
  }
  const sourceFace = brush.faces.find((face) => face.id === faceId);
  if (!sourceFace)
    throw new Error(`Unknown face ${faceId} on brush ${brush.id}`);
  const moved = moveBrushFace(brush, faceId, distance);
  const movedFace = moved.faces.find((face) => face.id === faceId)!;
  const volume = distance > 0 ? moved : brush;
  const splitPlane =
    distance > 0 ? sourceFace.planePoints : movedFace.planePoints;
  const backFaceId = ids.face();
  const back = clipBrush(
    volume,
    splitPlane,
    "back",
    backFaceId,
    sourceFace.material,
  );
  const frontSource = cloneBrush(volume, ids);
  const frontFaceId = ids.face();
  const front = clipBrush(
    frontSource,
    splitPlane,
    "front",
    frontFaceId,
    sourceFace.material,
  );
  if (!back || !front || back === volume || front === frontSource) {
    throw new Error("Face split did not produce two three-dimensional brushes");
  }
  const attributedBack = copyFaceAttributes(back, backFaceId, sourceFace);
  const attributedFront = copyFaceAttributes(front, frontFaceId, sourceFace);
  for (const piece of [attributedBack, attributedFront]) {
    const derived = deriveBrush(piece);
    if (!derived.valid) {
      throw new Error(
        `Face split would create an invalid brush: ${derived.diagnostics
          .map((diagnostic) => diagnostic.message)
          .join("; ")}`,
      );
    }
  }
  return [attributedBack, attributedFront];
}

export type BrushClipSide = "front" | "back";

/** Adds an oriented plane and prunes source planes that no longer bound the clipped convex hull. */
export function clipBrush(
  brush: MapBrush,
  planePoints: readonly [Vec3, Vec3, Vec3],
  side: BrushClipSide,
  faceId: FaceId,
  material = brush.faces[0]?.material ?? "DEV/CLIP",
): MapBrush | null {
  const orientedPoints: readonly [Vec3, Vec3, Vec3] =
    side === "back"
      ? planePoints
      : [planePoints[0], planePoints[2], planePoints[1]];
  const plane = planeFromPoints(orientedPoints);
  if (!plane) throw new Error("Clip points do not define a plane");
  const duplicate = brush.faces.some((face) => {
    const candidate = planeFromPoints(face.planePoints);
    return (
      candidate &&
      candidate.normal.every(
        (value, axis) => Math.abs(value - plane.normal[axis]!) <= 1e-6,
      ) &&
      Math.abs(candidate.distance - plane.distance) <= 0.001
    );
  });
  if (duplicate) return brush;
  const clipFace: MapFace = {
    id: faceId,
    planePoints: orientedPoints,
    material,
    projection: defaultTextureProjection(plane.normal),
    surface: {},
  };
  let result: MapBrush = {
    ...brush,
    revision: brush.revision + 1,
    faces: [...brush.faces, clipFace],
  };
  let derived = deriveBrush(result);
  if (
    derived.diagnostics.some((diagnostic) => diagnostic.code === "empty-brush")
  )
    return null;
  const unused = new Set(
    derived.diagnostics
      .filter(
        (diagnostic) => diagnostic.code === "open-face" && diagnostic.faceId,
      )
      .map((diagnostic) => diagnostic.faceId!),
  );
  if (unused.has(faceId)) return brush;
  if (unused.size > 0) {
    result = {
      ...result,
      faces: result.faces.filter((face) => !unused.has(face.id)),
    };
    derived = deriveBrush(result);
  }
  if (!derived.valid) {
    throw new Error(
      `Clip plane would create an invalid brush: ${derived.diagnostics
        .map((diagnostic) => diagnostic.message)
        .join("; ")}`,
    );
  }
  return result;
}

function sameGeometricPlane(left: Plane, right: Plane): boolean {
  const alignment = dot(left.normal, right.normal);
  return alignment >= 1 - 1e-7
    ? Math.abs(left.distance - right.distance) <= GEOMETRY_EPSILON * 4
    : alignment <= -1 + 1e-7
      ? Math.abs(left.distance + right.distance) <= GEOMETRY_EPSILON * 4
      : false;
}

function csgFaceForPlane(
  plane: Plane,
  sources: readonly MapBrush[],
  ids: IdFactory,
  planePoints: readonly [Vec3, Vec3, Vec3],
  currentMaterial: string,
): MapFace {
  const source = sources
    .flatMap((brush) => brush.faces)
    .find((face) => {
      const candidate = planeFromPoints(face.planePoints);
      return candidate ? sameGeometricPlane(plane, candidate) : false;
    });
  return source
    ? {
        ...source,
        id: ids.face(),
        planePoints,
        projection: {
          ...source.projection,
          uAxis: [...source.projection.uAxis] as Vec3,
          vAxis: [...source.projection.vAxis] as Vec3,
          offset: [...source.projection.offset] as readonly [number, number],
          scale: [...source.projection.scale] as readonly [number, number],
        },
        surface: { ...source.surface },
      }
    : {
        id: ids.face(),
        planePoints,
        material: currentMaterial,
        projection: defaultTextureProjection(plane.normal),
        surface: {},
      };
}

function assertCsgBrush(brush: MapBrush, operation: string): MapBrush {
  const derived = deriveBrush(brush);
  if (!derived.valid) {
    throw new Error(
      `${operation} would create an invalid brush: ${derived.diagnostics
        .map((diagnostic) => diagnostic.message)
        .join("; ")}`,
    );
  }
  return brush;
}

export function convexMergeBrushes(
  brushes: readonly MapBrush[],
  ids: IdFactory,
  currentMaterial = brushes[0]?.faces[0]?.material ?? "DEV/CSG",
): MapBrush {
  if (brushes.length < 2)
    throw new Error("Convex merge requires at least two brushes");
  const points = uniqueHullPoints(
    brushes.flatMap((brush) =>
      brushVertices(brush).map<VertexHullPoint>((point) => ({
        point,
        sourcePoints: [point],
      })),
    ),
  );
  const hull = convexHullPlanes(points);
  if (hull.length < 4)
    throw new Error("Convex merge requires a three-dimensional hull");
  return assertCsgBrush(
    {
      kind: "brush",
      id: ids.brush(),
      revision: 0,
      faces: hull.map((candidate) =>
        csgFaceForPlane(
          { normal: candidate.normal, distance: candidate.distance },
          brushes,
          ids,
          mapTriple(candidate.points, (point) => point.point),
          currentMaterial,
        ),
      ),
    },
    "Convex merge",
  );
}

export function createConvexHullBrush(
  points: readonly Vec3[],
  material: string,
  ids: IdFactory = createSequentialIdFactory("hull"),
): MapBrush {
  if (!points.flat().every(Number.isFinite))
    throw new Error("Hull points must be finite");
  const normalizedMaterial = material.trim();
  if (!normalizedMaterial) throw new Error("Hull brushes require a material");
  const hullPoints = uniqueHullPoints(
    points.map<VertexHullPoint>((point) => ({ point, sourcePoints: [point] })),
  );
  if (hullPoints.length < 4)
    throw new Error("A hull brush requires at least four unique points");
  const hull = convexHullPlanes(hullPoints);
  if (hull.length < 4)
    throw new Error("Hull points must enclose a three-dimensional volume");
  return assertCsgBrush(
    {
      kind: "brush",
      id: ids.brush(),
      revision: 0,
      faces: hull.map<MapFace>((candidate) => ({
        id: ids.face(),
        planePoints: mapTriple(candidate.points, (point) => point.point),
        material: normalizedMaterial,
        projection: defaultTextureProjection(candidate.normal),
        surface: {},
      })),
    },
    "Hull creation",
  );
}

function clipBrushByFace(
  brush: MapBrush,
  sourceFace: MapFace,
  side: BrushClipSide,
  ids: IdFactory,
): MapBrush | null {
  const faceId = ids.face();
  const clipped = clipBrush(
    brush,
    sourceFace.planePoints,
    side,
    faceId,
    sourceFace.material,
  );
  return clipped && clipped !== brush
    ? copyFaceAttributes(clipped, faceId, sourceFace)
    : clipped;
}

/** Computes the common convex volume of all inputs, or null when it has no solid volume. */
export function intersectBrushes(
  brushes: readonly MapBrush[],
  ids: IdFactory,
): MapBrush | null {
  if (brushes.length < 2)
    throw new Error("CSG intersection requires at least two brushes");
  let result: MapBrush | null = cloneBrush(brushes[0]!, ids);
  for (const brush of brushes.slice(1)) {
    for (const face of brush.faces) {
      if (!result) return null;
      const plane = planeFromPoints(face.planePoints);
      if (!plane)
        throw new Error(`Cannot intersect degenerate face ${face.id}`);
      const distances = brushVertices(result).map(
        (point) => dot(plane.normal, point) - plane.distance,
      );
      if (distances.every((distance) => distance >= -GEOMETRY_EPSILON))
        return null;
      if (distances.every((distance) => distance <= GEOMETRY_EPSILON)) continue;
      try {
        result = clipBrushByFace(result, face, "back", ids);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("Clip plane would create")
        ) {
          return null;
        }
        throw error;
      }
      if (!result) return null;
    }
  }
  return assertCsgBrush({ ...result, revision: 0 }, "CSG intersection");
}

/**
 * Subtracts one convex brush from another. Concave results are represented as a non-overlapping
 * sequence of convex fragments cut by the subtrahend's face planes. The original brush is returned
 * unchanged when the two solid volumes do not overlap.
 */
export function subtractBrush(
  minuend: MapBrush,
  subtrahend: MapBrush,
  ids: IdFactory,
): readonly MapBrush[] {
  if (!intersectBrushes([minuend, subtrahend], ids)) return [minuend];
  let remainder: MapBrush | null = cloneBrush(minuend, ids);
  const fragments: MapBrush[] = [];
  for (const face of subtrahend.faces) {
    if (!remainder) break;
    const outsideSource = cloneBrush(remainder, ids);
    const outside = clipBrushByFace(outsideSource, face, "front", ids);
    const inside = clipBrushByFace(remainder, face, "back", ids);
    if (outside && outside !== outsideSource) {
      fragments.push(
        assertCsgBrush({ ...outside, revision: 0 }, "CSG subtraction"),
      );
    }
    remainder = inside;
  }
  return fragments;
}

/** Hollows a convex brush by subtracting an inward offset copy from it. */
export function hollowBrush(
  brush: MapBrush,
  thickness: number,
  ids: IdFactory,
): readonly MapBrush[] {
  if (!Number.isFinite(thickness) || thickness <= 0) {
    throw new Error("Hollow wall thickness must be a positive finite number");
  }
  const inner: MapBrush = {
    kind: "brush",
    id: ids.brush(),
    revision: 0,
    faces: brush.faces.map((face) => {
      const plane = planeFromPoints(face.planePoints);
      if (!plane) throw new Error(`Cannot hollow degenerate face ${face.id}`);
      const delta = scale(plane.normal, -thickness);
      return {
        ...face,
        id: ids.face(),
        planePoints: mapTriple(face.planePoints, (point) => add(point, delta)),
      };
    }),
  };
  assertCsgBrush(inner, "CSG hollow");
  return subtractBrush(brush, inner, ids);
}
