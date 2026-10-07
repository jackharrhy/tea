import { brushVertices, textureCoordinates } from "./geometry.js";
import {
  distanceSquared,
  dot,
  GEOMETRY_EPSILON,
  planeFromPoints,
  subtract,
} from "./math.js";
import { mapTriple } from "./document-helpers.js";
import type {
  FaceId,
  IdFactory,
  MapBrush,
  MapFace,
  TextureProjection,
  Vec3,
} from "./types.js";

export function translateBrush(
  brush: MapBrush,
  delta: Vec3,
  textureLock = true,
): MapBrush {
  return {
    ...brush,
    revision: brush.revision + 1,
    faces: brush.faces.map((face) => {
      const scaleU =
        Math.abs(face.projection.scale[0]) <= Number.EPSILON
          ? 1
          : face.projection.scale[0];
      const scaleV =
        Math.abs(face.projection.scale[1]) <= Number.EPSILON
          ? 1
          : face.projection.scale[1];
      const projection = textureLock
        ? {
            ...face.projection,
            offset: [
              face.projection.offset[0] -
                (delta[0] * face.projection.uAxis[0] +
                  delta[1] * face.projection.uAxis[1] +
                  delta[2] * face.projection.uAxis[2]) /
                  scaleU,
              face.projection.offset[1] -
                (delta[0] * face.projection.vAxis[0] +
                  delta[1] * face.projection.vAxis[1] +
                  delta[2] * face.projection.vAxis[2]) /
                  scaleV,
            ] as const,
          }
        : face.projection;
      return {
        ...face,
        projection,
        planePoints: mapTriple(face.planePoints, (point) => [
          point[0] + delta[0],
          point[1] + delta[1],
          point[2] + delta[2],
        ]),
      };
    }),
  };
}

export type TransformAxis = 0 | 1 | 2;
type Matrix3 = readonly [Vec3, Vec3, Vec3];

function multiplyMatrixVector(matrix: Matrix3, vector: Vec3): Vec3 {
  return [
    dot(matrix[0], vector),
    dot(matrix[1], vector),
    dot(matrix[2], vector),
  ];
}

function determinant(matrix: Matrix3): number {
  return (
    matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
    matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
    matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
  );
}

function inverseTranspose(matrix: Matrix3): Matrix3 {
  const value = determinant(matrix);
  if (!Number.isFinite(value) || Math.abs(value) <= 1e-9) {
    throw new Error("Brush transform must be invertible");
  }
  const inverse: Matrix3 = [
    [
      (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) / value,
      (matrix[0][2] * matrix[2][1] - matrix[0][1] * matrix[2][2]) / value,
      (matrix[0][1] * matrix[1][2] - matrix[0][2] * matrix[1][1]) / value,
    ],
    [
      (matrix[1][2] * matrix[2][0] - matrix[1][0] * matrix[2][2]) / value,
      (matrix[0][0] * matrix[2][2] - matrix[0][2] * matrix[2][0]) / value,
      (matrix[0][2] * matrix[1][0] - matrix[0][0] * matrix[1][2]) / value,
    ],
    [
      (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]) / value,
      (matrix[0][1] * matrix[2][0] - matrix[0][0] * matrix[2][1]) / value,
      (matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0]) / value,
    ],
  ];
  return [
    [inverse[0][0], inverse[1][0], inverse[2][0]],
    [inverse[0][1], inverse[1][1], inverse[2][1]],
    [inverse[0][2], inverse[1][2], inverse[2][2]],
  ];
}

function transformPoint(point: Vec3, matrix: Matrix3, pivot: Vec3): Vec3 {
  const relative: Vec3 = [
    point[0] - pivot[0],
    point[1] - pivot[1],
    point[2] - pivot[2],
  ];
  const transformed = multiplyMatrixVector(matrix, relative);
  return [
    transformed[0] + pivot[0],
    transformed[1] + pivot[1],
    transformed[2] + pivot[2],
  ];
}

function rotationMatrix(axis: TransformAxis, degrees: number): Matrix3 {
  if (!Number.isFinite(degrees))
    throw new Error("Rotation angle must be finite");
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return axis === 0
    ? [
        [1, 0, 0],
        [0, cosine, -sine],
        [0, sine, cosine],
      ]
    : axis === 1
      ? [
          [cosine, 0, sine],
          [0, 1, 0],
          [-sine, 0, cosine],
        ]
      : [
          [cosine, -sine, 0],
          [sine, cosine, 0],
          [0, 0, 1],
        ];
}

function scaleMatrix(factors: Vec3): Matrix3 {
  if (
    !factors.every(Number.isFinite) ||
    factors.some((factor) => Math.abs(factor) <= 1e-6)
  ) {
    throw new Error("Scale factors must be finite and non-zero");
  }
  return [
    [factors[0], 0, 0],
    [0, factors[1], 0],
    [0, 0, factors[2]],
  ];
}

function shearMatrix(
  sourceAxis: TransformAxis,
  targetAxis: TransformAxis,
  factor: number,
): Matrix3 {
  if (sourceAxis === targetAxis)
    throw new Error("Shear axes must be different");
  if (!Number.isFinite(factor)) throw new Error("Shear factor must be finite");
  const rows: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  rows[targetAxis]![sourceAxis] = factor;
  return rows;
}

function transformProjection(
  projection: TextureProjection,
  matrix: Matrix3,
  pivot: Vec3,
): TextureProjection {
  const covectorTransform = inverseTranspose(matrix);
  const transformAxis = (axis: Vec3, textureScale: number) => {
    const safeScale = Math.abs(textureScale) <= 1e-9 ? 1 : textureScale;
    const originalCovector: Vec3 = [
      axis[0] / safeScale,
      axis[1] / safeScale,
      axis[2] / safeScale,
    ];
    const transformedCovector = multiplyMatrixVector(
      covectorTransform,
      originalCovector,
    );
    const magnitude = Math.hypot(...transformedCovector);
    if (magnitude <= 1e-9)
      throw new Error("Brush transform collapsed a texture axis");
    const transformedScale = Math.sign(safeScale) / magnitude;
    const transformedAxis: Vec3 = [
      transformedCovector[0] * transformedScale,
      transformedCovector[1] * transformedScale,
      transformedCovector[2] * transformedScale,
    ];
    const offsetDelta =
      dot(originalCovector, pivot) - dot(transformedCovector, pivot);
    return { axis: transformedAxis, scale: transformedScale, offsetDelta };
  };
  const u = transformAxis(projection.uAxis, projection.scale[0]);
  const v = transformAxis(projection.vAxis, projection.scale[1]);
  return {
    ...projection,
    uAxis: u.axis,
    vAxis: v.axis,
    offset: [
      projection.offset[0] + u.offsetDelta,
      projection.offset[1] + v.offsetDelta,
    ],
    scale: [u.scale, v.scale],
  };
}

export function transformBrush(
  brush: MapBrush,
  matrix: Matrix3,
  pivot: Vec3,
  textureLock = true,
): MapBrush {
  if (![...matrix.flat(), ...pivot].every(Number.isFinite)) {
    throw new Error("Brush transform values must be finite");
  }
  const matrixDeterminant = determinant(matrix);
  if (Math.abs(matrixDeterminant) <= 1e-9)
    throw new Error("Brush transform must be invertible");
  return {
    ...brush,
    revision: brush.revision + 1,
    faces: brush.faces.map((face) => {
      const transformed = mapTriple(face.planePoints, (point) =>
        transformPoint(point, matrix, pivot),
      );
      const planePoints: readonly [Vec3, Vec3, Vec3] =
        matrixDeterminant < 0
          ? [transformed[0], transformed[2], transformed[1]]
          : transformed;
      return {
        ...face,
        planePoints,
        projection: textureLock
          ? transformProjection(face.projection, matrix, pivot)
          : face.projection,
      };
    }),
  };
}

export function rotateBrush(
  brush: MapBrush,
  pivot: Vec3,
  axis: TransformAxis,
  degrees: number,
  textureLock = true,
): MapBrush {
  return transformBrush(
    brush,
    rotationMatrix(axis, degrees),
    pivot,
    textureLock,
  );
}

export function scaleBrush(
  brush: MapBrush,
  pivot: Vec3,
  factors: Vec3,
  textureLock = true,
): MapBrush {
  return transformBrush(brush, scaleMatrix(factors), pivot, textureLock);
}

export function flipBrush(
  brush: MapBrush,
  pivot: Vec3,
  axis: TransformAxis,
  textureLock = true,
): MapBrush {
  const factors: [number, number, number] = [1, 1, 1];
  factors[axis] = -1;
  return scaleBrush(brush, pivot, factors, textureLock);
}

export function shearBrush(
  brush: MapBrush,
  pivot: Vec3,
  sourceAxis: TransformAxis,
  targetAxis: TransformAxis,
  factor: number,
  textureLock = true,
): MapBrush {
  return transformBrush(
    brush,
    shearMatrix(sourceAxis, targetAxis, factor),
    pivot,
    textureLock,
  );
}

export interface VertexHullPoint {
  readonly point: Vec3;
  readonly sourcePoints: readonly Vec3[];
}

export interface VertexHullPlane {
  readonly normal: Vec3;
  readonly distance: number;
  readonly points: readonly [VertexHullPoint, VertexHullPoint, VertexHullPoint];
  readonly support: readonly VertexHullPoint[];
}

function samePoint(left: Vec3, right: Vec3): boolean {
  return distanceSquared(left, right) <= GEOMETRY_EPSILON * GEOMETRY_EPSILON;
}

export function uniqueHullPoints(
  points: readonly VertexHullPoint[],
): VertexHullPoint[] {
  const result: VertexHullPoint[] = [];
  for (const point of points) {
    const existing = result.find((candidate) =>
      samePoint(candidate.point, point.point),
    );
    if (!existing) {
      result.push(point);
      continue;
    }
    const index = result.indexOf(existing);
    result[index] = {
      point: existing.point,
      sourcePoints: [...existing.sourcePoints, ...point.sourcePoints].filter(
        (source, sourceIndex, all) =>
          all.findIndex((candidate) => samePoint(candidate, source)) ===
          sourceIndex,
      ),
    };
  }
  return result;
}

export function convexHullPlanes(
  points: readonly VertexHullPoint[],
): VertexHullPlane[] {
  const planes: VertexHullPlane[] = [];
  for (let first = 0; first < points.length - 2; first += 1) {
    for (let second = first + 1; second < points.length - 1; second += 1) {
      for (let third = second + 1; third < points.length; third += 1) {
        const a = points[first]!;
        let b = points[second]!;
        let c = points[third]!;
        let plane = planeFromPoints([a.point, b.point, c.point]);
        if (!plane) continue;
        const distances = points.map(
          (point) => dot(plane!.normal, point.point) - plane!.distance,
        );
        if (distances.every((distance) => distance >= -GEOMETRY_EPSILON)) {
          [b, c] = [c, b];
          plane = {
            normal: [-plane.normal[0], -plane.normal[1], -plane.normal[2]],
            distance: -plane.distance,
          };
        } else if (
          !distances.every((distance) => distance <= GEOMETRY_EPSILON)
        ) {
          continue;
        }
        if (
          planes.some(
            (candidate) =>
              dot(candidate.normal, plane.normal) >= 1 - 1e-7 &&
              Math.abs(candidate.distance - plane.distance) <=
                GEOMETRY_EPSILON * 4,
          )
        ) {
          continue;
        }
        const support = points.filter(
          (point) =>
            Math.abs(dot(plane.normal, point.point) - plane.distance) <=
            GEOMETRY_EPSILON * 4,
        );
        if (support.length < 3) continue;
        planes.push({
          normal: plane.normal,
          distance: plane.distance,
          points: [a, b, c],
          support,
        });
      }
    }
  }
  return planes;
}

function projectionFromLockedVertices(
  source: MapFace,
  normal: Vec3,
  points: readonly [VertexHullPoint, VertexHullPoint, VertexHullPoint],
): TextureProjection {
  const sourcePlane = planeFromPoints(source.planePoints);
  const sourcePoint = (point: VertexHullPoint): Vec3 =>
    point.sourcePoints.toSorted((left, right) => {
      if (!sourcePlane) return 0;
      const leftDistance = Math.abs(
        dot(sourcePlane.normal, left) - sourcePlane.distance,
      );
      const rightDistance = Math.abs(
        dot(sourcePlane.normal, right) - sourcePlane.distance,
      );
      return leftDistance - rightDistance;
    })[0] ?? point.point;
  const uv = mapTriple(points, (point) =>
    textureCoordinates(source, sourcePoint(point)),
  );
  const edge1 = subtract(points[1].point, points[0].point);
  const edge2 = subtract(points[2].point, points[0].point);
  const firstFirst = dot(edge1, edge1);
  const firstSecond = dot(edge1, edge2);
  const secondSecond = dot(edge2, edge2);
  const gramDeterminant = firstFirst * secondSecond - firstSecond * firstSecond;
  if (Math.abs(gramDeterminant) <= 1e-9) return source.projection;
  const fit = (
    coordinate: 0 | 1,
    fallbackAxis: Vec3,
    fallbackScale: number,
  ) => {
    const firstDelta = uv[1][coordinate] - uv[0][coordinate];
    const secondDelta = uv[2][coordinate] - uv[0][coordinate];
    const firstWeight =
      (firstDelta * secondSecond - secondDelta * firstSecond) / gramDeterminant;
    const secondWeight =
      (secondDelta * firstFirst - firstDelta * firstSecond) / gramDeterminant;
    const covector: Vec3 = [
      edge1[0] * firstWeight + edge2[0] * secondWeight,
      edge1[1] * firstWeight + edge2[1] * secondWeight,
      edge1[2] * firstWeight + edge2[2] * secondWeight,
    ];
    const tangentCovector: Vec3 = [
      covector[0] - normal[0] * dot(covector, normal),
      covector[1] - normal[1] * dot(covector, normal),
      covector[2] - normal[2] * dot(covector, normal),
    ];
    const magnitude = Math.hypot(...tangentCovector);
    if (magnitude <= 1e-9) {
      const safeScale = Math.abs(fallbackScale) <= 1e-9 ? 1 : fallbackScale;
      const fallbackCovector: Vec3 = [
        fallbackAxis[0] / safeScale,
        fallbackAxis[1] / safeScale,
        fallbackAxis[2] / safeScale,
      ];
      return {
        axis: fallbackAxis,
        scale: safeScale,
        offset: uv[0][coordinate] - dot(fallbackCovector, points[0].point),
      };
    }
    const axis: Vec3 = [
      tangentCovector[0] / magnitude,
      tangentCovector[1] / magnitude,
      tangentCovector[2] / magnitude,
    ];
    return {
      axis,
      scale: 1 / magnitude,
      offset: uv[0][coordinate] - dot(tangentCovector, points[0].point),
    };
  };
  const u = fit(0, source.projection.uAxis, source.projection.scale[0]);
  const v = fit(1, source.projection.vAxis, source.projection.scale[1]);
  return {
    ...source.projection,
    uAxis: u.axis,
    vAxis: v.axis,
    offset: [u.offset, v.offset],
    scale: [u.scale, v.scale],
  };
}

function rebuildBrushFromHullPoints(
  brush: MapBrush,
  points: readonly VertexHullPoint[],
  ids: IdFactory,
  textureLock: boolean,
): MapBrush {
  const hullPoints = uniqueHullPoints(points);
  if (hullPoints.length < 4)
    throw new Error("Vertex edit would collapse the brush");
  const hull = convexHullPlanes(hullPoints);
  if (hull.length < 4) throw new Error("Vertex edit would collapse the brush");
  const sourceFaces = brush.faces.map((face) => {
    const plane = planeFromPoints(face.planePoints);
    return { face, plane };
  });
  const sourceFor = (hullPlane: VertexHullPlane) =>
    sourceFaces
      .map(({ face, plane }) => {
        const shared = plane
          ? hullPlane.support.filter((point) =>
              point.sourcePoints.some(
                (source) =>
                  Math.abs(dot(plane.normal, source) - plane.distance) <=
                  GEOMETRY_EPSILON * 4,
              ),
            ).length
          : 0;
        const alignment = plane ? dot(hullPlane.normal, plane.normal) : -1;
        const exact =
          plane &&
          alignment >= 1 - 1e-7 &&
          Math.abs(hullPlane.distance - plane.distance) <= GEOMETRY_EPSILON * 4;
        return {
          face,
          exact: Boolean(exact),
          score: (exact ? 10_000 : 0) + shared * 100 + alignment,
        };
      })
      .toSorted((left, right) => right.score - left.score)[0]!;
  const assignments = hull.map((plane) => ({
    plane,
    source: sourceFor(plane),
  }));
  const usedIds = new Set<FaceId>(
    assignments
      .filter((assignment) => assignment.source.exact)
      .map((assignment) => assignment.source.face.id),
  );
  const faces = assignments.map<MapFace>(({ plane, source }) => {
    const keepSourceId = source.exact || !usedIds.has(source.face.id);
    if (keepSourceId) usedIds.add(source.face.id);
    return Object.assign({}, source.face, {
      id: keepSourceId ? source.face.id : ids.face(),
      planePoints: mapTriple(plane.points, (point) => point.point),
      projection: textureLock
        ? projectionFromLockedVertices(source.face, plane.normal, plane.points)
        : source.face.projection,
    });
  });
  return { ...brush, revision: brush.revision + 1, faces };
}

/**
 * Moves derived brush corners and rebuilds their convex hull. Supporting planes are regenerated so
 * an edited corner can split formerly planar faces instead of creating a concave or open brush.
 */
export function moveBrushVertices(
  brush: MapBrush,
  vertices: readonly Vec3[],
  delta: Vec3,
  ids: IdFactory,
  textureLock = true,
): MapBrush {
  if (![...vertices.flat(), ...delta].every(Number.isFinite)) {
    throw new Error("Vertex move values must be finite");
  }
  if (vertices.length === 0)
    throw new Error("Select at least one brush vertex to move");
  return rebuildBrushFromHullPoints(
    brush,
    brushVertices(brush).map<VertexHullPoint>((point) => ({
      point: vertices.some((selected) => samePoint(selected, point))
        ? [point[0] + delta[0], point[1] + delta[1], point[2] + delta[2]]
        : point,
      sourcePoints: [point],
    })),
    ids,
    textureLock,
  );
}

/** Snaps selected derived brush corners component-wise and rebuilds a valid convex brush. */
export function snapBrushVerticesToGrid(
  brush: MapBrush,
  vertices: readonly Vec3[],
  gridSize: number,
  ids: IdFactory,
  textureLock = true,
): MapBrush {
  if (!Number.isFinite(gridSize) || gridSize <= 0) {
    throw new Error("Grid size must be positive");
  }
  if (vertices.length === 0)
    throw new Error("Select at least one brush vertex to snap");
  const snap = (value: number) => Math.round(value / gridSize) * gridSize;
  return rebuildBrushFromHullPoints(
    brush,
    brushVertices(brush).map<VertexHullPoint>((point) => ({
      point: vertices.some((selected) => samePoint(selected, point))
        ? [snap(point[0]), snap(point[1]), snap(point[2])]
        : point,
      sourcePoints: [point],
    })),
    ids,
    textureLock,
  );
}

function transformBrushVertexSelection(
  brush: MapBrush,
  vertices: readonly Vec3[],
  matrix: Matrix3,
  pivot: Vec3,
  ids: IdFactory,
  textureLock: boolean,
): MapBrush {
  if (
    ![...vertices.flat(), ...matrix.flat(), ...pivot].every(Number.isFinite)
  ) {
    throw new Error("Vertex transform values must be finite");
  }
  if (vertices.length === 0)
    throw new Error("Select at least one brush vertex to transform");
  if (Math.abs(determinant(matrix)) <= 1e-9)
    throw new Error("Vertex transform must be invertible");
  return rebuildBrushFromHullPoints(
    brush,
    brushVertices(brush).map<VertexHullPoint>((point) => ({
      point: vertices.some((selected) => samePoint(selected, point))
        ? transformPoint(point, matrix, pivot)
        : point,
      sourcePoints: [point],
    })),
    ids,
    textureLock,
  );
}

export function rotateBrushVertices(
  brush: MapBrush,
  vertices: readonly Vec3[],
  pivot: Vec3,
  axis: TransformAxis,
  degrees: number,
  ids: IdFactory,
  textureLock = true,
): MapBrush {
  return transformBrushVertexSelection(
    brush,
    vertices,
    rotationMatrix(axis, degrees),
    pivot,
    ids,
    textureLock,
  );
}

export function scaleBrushVertices(
  brush: MapBrush,
  vertices: readonly Vec3[],
  pivot: Vec3,
  factors: Vec3,
  ids: IdFactory,
  textureLock = true,
): MapBrush {
  return transformBrushVertexSelection(
    brush,
    vertices,
    scaleMatrix(factors),
    pivot,
    ids,
    textureLock,
  );
}

export function shearBrushVertices(
  brush: MapBrush,
  vertices: readonly Vec3[],
  pivot: Vec3,
  sourceAxis: TransformAxis,
  targetAxis: TransformAxis,
  factor: number,
  ids: IdFactory,
  textureLock = true,
): MapBrush {
  return transformBrushVertexSelection(
    brush,
    vertices,
    shearMatrix(sourceAxis, targetAxis, factor),
    pivot,
    ids,
    textureLock,
  );
}

/** Adds one derived corner and rebuilds the brush as the convex hull containing it. */
export function addBrushVertex(
  brush: MapBrush,
  vertex: Vec3,
  sourcePoint: Vec3,
  ids: IdFactory,
  textureLock = true,
): MapBrush {
  if (![...vertex, ...sourcePoint].every(Number.isFinite)) {
    throw new Error("Vertex insertion values must be finite");
  }
  const sourceVertices = brushVertices(brush);
  if (sourceVertices.some((point) => samePoint(point, vertex))) {
    throw new Error("The new vertex coincides with an existing brush vertex");
  }
  const rebuilt = rebuildBrushFromHullPoints(
    brush,
    [
      ...sourceVertices.map<VertexHullPoint>((point) => ({
        point,
        sourcePoints: [point],
      })),
      { point: vertex, sourcePoints: [sourcePoint] },
    ],
    ids,
    textureLock,
  );
  if (!brushVertices(rebuilt).some((point) => samePoint(point, vertex))) {
    throw new Error("The new vertex must extend the brush hull");
  }
  return rebuilt;
}

/** Removes derived corners and rebuilds the remaining points as one validated convex hull. */
export function deleteBrushVertices(
  brush: MapBrush,
  vertices: readonly Vec3[],
  ids: IdFactory,
  textureLock = true,
): MapBrush {
  if (!vertices.flat().every(Number.isFinite))
    throw new Error("Vertex positions must be finite");
  if (vertices.length === 0)
    throw new Error("Select at least one brush vertex to delete");
  const sourceVertices = brushVertices(brush);
  const remaining = sourceVertices.filter(
    (point) => !vertices.some((selected) => samePoint(selected, point)),
  );
  if (remaining.length === sourceVertices.length) {
    throw new Error("The selected vertices do not belong to this brush");
  }
  return rebuildBrushFromHullPoints(
    brush,
    remaining.map((point) => ({ point, sourcePoints: [point] })),
    ids,
    textureLock,
  );
}

export function moveBrushFace(
  brush: MapBrush,
  faceId: FaceId,
  distance: number,
): MapBrush {
  if (!Number.isFinite(distance))
    throw new Error("Face extrusion distance must be finite");
  const target = brush.faces.find((face) => face.id === faceId);
  if (!target) throw new Error(`Unknown face ${faceId} on brush ${brush.id}`);
  const plane = planeFromPoints(target.planePoints);
  if (!plane) throw new Error(`Cannot move the degenerate face ${faceId}`);
  const delta: Vec3 = [
    plane.normal[0] * distance,
    plane.normal[1] * distance,
    plane.normal[2] * distance,
  ];
  return {
    ...brush,
    revision: brush.revision + 1,
    faces: brush.faces.map((face) =>
      face.id === faceId
        ? {
            ...face,
            planePoints: mapTriple(face.planePoints, (point) => [
              point[0] + delta[0],
              point[1] + delta[1],
              point[2] + delta[2],
            ]),
          }
        : face,
    ),
  };
}
