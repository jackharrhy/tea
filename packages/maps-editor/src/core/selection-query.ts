import { brushVertices, deriveBrush } from "./geometry.js";
import { cross, dot, GEOMETRY_EPSILON } from "./math.js";
import {
  pointEntitiesInDocument,
  pointEntityBounds,
} from "./point-entities.js";
import {
  brushesInDocument,
  findBrush,
  type Bounds,
  type BrushId,
  type EntityId,
  type MapBrush,
  type MapDocument,
  type Vec2,
  type Vec3,
} from "./types.js";

export type SelectionBrushQueryMode =
  | "touching"
  | "inside"
  | "inside-projected";
export type SelectionBrushProjection = "xy" | "xz" | "yz";

export interface SelectionBrushQueryOptions {
  readonly mode: SelectionBrushQueryMode;
  readonly projection?: SelectionBrushProjection;
  /** Optional editable-object boundary supplied by the session. */
  readonly candidateBrushIds?: readonly BrushId[];
  /** Optional editable-object boundary supplied by the session. */
  readonly candidateEntityIds?: readonly EntityId[];
}

export interface SelectionBrushQueryResult {
  readonly brushIds: readonly BrushId[];
  readonly entityIds: readonly EntityId[];
}

interface ConvexVolume {
  readonly vertices: readonly Vec3[];
  readonly faceNormals: readonly Vec3[];
  readonly edgeDirections: readonly Vec3[];
  readonly bounds: Bounds;
}

function boundsVertices(bounds: Bounds): readonly Vec3[] {
  const [minX, minY, minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;
  return [
    [minX, minY, minZ],
    [maxX, minY, minZ],
    [minX, maxY, minZ],
    [maxX, maxY, minZ],
    [minX, minY, maxZ],
    [maxX, minY, maxZ],
    [minX, maxY, maxZ],
    [maxX, maxY, maxZ],
  ];
}

function normalize(vector: Vec3): Vec3 | null {
  const length = Math.hypot(...vector);
  if (length <= GEOMETRY_EPSILON) return null;
  let result: Vec3 = [
    vector[0] / length,
    vector[1] / length,
    vector[2] / length,
  ];
  const firstSignificant =
    result.find((component) => Math.abs(component) > 1e-8) ?? 0;
  if (firstSignificant < 0) result = [-result[0], -result[1], -result[2]];
  return result;
}

function uniqueAxes(axes: readonly Vec3[]): readonly Vec3[] {
  const unique = new Map<string, Vec3>();
  for (const axis of axes) {
    const normalized = normalize(axis);
    if (!normalized) continue;
    const key = normalized
      .map((component) => Math.round(component * 1e6))
      .join(",");
    unique.set(key, normalized);
  }
  return [...unique.values()];
}

function brushVolume(brush: MapBrush): ConvexVolume | null {
  const derived = deriveBrush(brush);
  if (!derived.valid || !derived.bounds) return null;
  return {
    vertices: brushVertices(brush),
    faceNormals: derived.faces.map((face) => face.normal),
    edgeDirections: derived.edges.map((edge) => [
      edge.end[0] - edge.start[0],
      edge.end[1] - edge.start[1],
      edge.end[2] - edge.start[2],
    ]),
    bounds: derived.bounds,
  };
}

function boundsVolume(bounds: Bounds): ConvexVolume {
  return {
    vertices: boundsVertices(bounds),
    faceNormals: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    edgeDirections: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    bounds,
  };
}

function boundsOverlap(left: Bounds, right: Bounds): boolean {
  return [0, 1, 2].every(
    (axis) =>
      left.max[axis]! >= right.min[axis]! - GEOMETRY_EPSILON &&
      right.max[axis]! >= left.min[axis]! - GEOMETRY_EPSILON,
  );
}

function interval(
  vertices: readonly Vec3[],
  axis: Vec3,
): readonly [number, number] {
  const values = vertices.map((vertex) => dot(vertex, axis));
  return [Math.min(...values), Math.max(...values)];
}

/** Separating-axis test for arbitrary convex source brushes and point-entity bounds. */
function volumesTouch(left: ConvexVolume, right: ConvexVolume): boolean {
  if (!boundsOverlap(left.bounds, right.bounds)) return false;
  const edgeAxes = left.edgeDirections.flatMap((leftEdge) =>
    right.edgeDirections.map((rightEdge) => cross(leftEdge, rightEdge)),
  );
  const axes = uniqueAxes([
    ...left.faceNormals,
    ...right.faceNormals,
    ...edgeAxes,
  ]);
  return axes.every((axis) => {
    const leftInterval = interval(left.vertices, axis);
    const rightInterval = interval(right.vertices, axis);
    return (
      leftInterval[1] >= rightInterval[0] - GEOMETRY_EPSILON &&
      rightInterval[1] >= leftInterval[0] - GEOMETRY_EPSILON
    );
  });
}

function brushContainsVertices(
  brush: MapBrush,
  vertices: readonly Vec3[],
): boolean {
  const derived = deriveBrush(brush);
  return (
    derived.valid &&
    vertices.every((vertex) =>
      derived.faces.every(
        (face) =>
          dot(face.normal, vertex) <= face.distance + GEOMETRY_EPSILON * 4,
      ),
    )
  );
}

function projectionAxes(
  projection: SelectionBrushProjection,
): readonly [number, number] {
  if (projection === "xy") return [0, 1];
  if (projection === "xz") return [0, 2];
  return [1, 2];
}

function projected(
  points: readonly Vec3[],
  projection: SelectionBrushProjection,
): readonly Vec2[] {
  const axes = projectionAxes(projection);
  return points.map((point) => [point[axes[0]]!, point[axes[1]]!]);
}

function cross2(origin: Vec2, left: Vec2, right: Vec2): number {
  return (
    (left[0] - origin[0]) * (right[1] - origin[1]) -
    (left[1] - origin[1]) * (right[0] - origin[0])
  );
}

function hullHalf(input: readonly Vec2[]): Vec2[] {
  const output: Vec2[] = [];
  for (const point of input) {
    while (
      output.length >= 2 &&
      cross2(output.at(-2)!, output.at(-1)!, point) <= GEOMETRY_EPSILON
    ) {
      output.pop();
    }
    output.push(point);
  }
  return output;
}

function convexHull2(points: readonly Vec2[]): readonly Vec2[] {
  const sorted = [
    ...new Map(
      points.map((point) => [`${point[0]}\u0000${point[1]}`, point]),
    ).values(),
  ].toSorted((left, right) => left[0] - right[0] || left[1] - right[1]);
  if (sorted.length <= 2) return sorted;
  const lower = hullHalf(sorted);
  const upper = hullHalf(sorted.toReversed());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function convexPolygonContains(polygon: readonly Vec2[], point: Vec2): boolean {
  if (polygon.length < 3) return false;
  return polygon.every(
    (start, index) =>
      cross2(start, polygon[(index + 1) % polygon.length]!, point) >=
      -GEOMETRY_EPSILON * 4,
  );
}

function brushProjectionContainsVertices(
  brush: MapBrush,
  vertices: readonly Vec3[],
  projection: SelectionBrushProjection,
): boolean {
  const hull = convexHull2(projected(brushVertices(brush), projection));
  return projected(vertices, projection).every((point) =>
    convexPolygonContains(hull, point),
  );
}

function matchesQuery(
  queryBrushes: readonly MapBrush[],
  target: ConvexVolume,
  options: SelectionBrushQueryOptions,
): boolean {
  if (options.mode === "touching") {
    return queryBrushes.some((brush) => {
      const query = brushVolume(brush);
      return query ? volumesTouch(query, target) : false;
    });
  }
  if (options.mode === "inside") {
    return queryBrushes.some((brush) =>
      brushContainsVertices(brush, target.vertices),
    );
  }
  if (!options.projection) {
    throw new Error(
      "Projected selection-brush queries require an orthographic projection",
    );
  }
  return queryBrushes.some((brush) =>
    brushProjectionContainsVertices(
      brush,
      target.vertices,
      options.projection!,
    ),
  );
}

/** Tests convex selection volumes without mutating them or including them in the results. */
export function querySelectionBrushes(
  document: MapDocument,
  selectionBrushIds: readonly BrushId[],
  options: SelectionBrushQueryOptions,
): SelectionBrushQueryResult {
  const uniqueSelectionIds = [...new Set(selectionBrushIds)];
  if (uniqueSelectionIds.length === 0)
    throw new Error("Select one or more selection brushes");
  if (uniqueSelectionIds.length !== selectionBrushIds.length) {
    throw new Error("Selection brush IDs must be unique");
  }
  const queryBrushes = uniqueSelectionIds.map((brushId) => {
    const brush = findBrush(document, brushId);
    if (!brush) throw new Error(`Unknown selection brush ${brushId}`);
    if (!deriveBrush(brush).valid)
      throw new Error(`Selection brush ${brushId} is invalid`);
    return brush;
  });
  if (options.mode === "inside-projected" && !options.projection) {
    throw new Error(
      "Projected selection-brush queries require an orthographic projection",
    );
  }

  const excluded = new Set(uniqueSelectionIds);
  const candidateBrushIds = options.candidateBrushIds
    ? new Set(options.candidateBrushIds)
    : null;
  const candidateEntityIds = options.candidateEntityIds
    ? new Set(options.candidateEntityIds)
    : null;
  const brushIds = brushesInDocument(document).flatMap((brush) => {
    if (
      excluded.has(brush.id) ||
      (candidateBrushIds && !candidateBrushIds.has(brush.id))
    ) {
      return [];
    }
    const target = brushVolume(brush);
    return target && matchesQuery(queryBrushes, target, options)
      ? [brush.id]
      : [];
  });
  const entityIds = pointEntitiesInDocument(document).flatMap((entity) => {
    if (candidateEntityIds && !candidateEntityIds.has(entity.id)) return [];
    const bounds = pointEntityBounds(entity);
    return bounds && matchesQuery(queryBrushes, boundsVolume(bounds), options)
      ? [entity.id]
      : [];
  });
  return { brushIds, entityIds };
}
