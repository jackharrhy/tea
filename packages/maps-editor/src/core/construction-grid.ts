import type { DerivedFace, Vec3 } from "./types.js";

export interface ConstructionGridSegment {
  readonly start: Vec3;
  readonly end: Vec3;
  readonly major: boolean;
}

const EPSILON = 1e-6;

function dominantAxis(vector: Vec3): 0 | 1 | 2 {
  const magnitudes = vector.map(Math.abs);
  return magnitudes[1]! > magnitudes[0]!
    ? magnitudes[2]! > magnitudes[1]!
      ? 2
      : 1
    : magnitudes[2]! > magnitudes[0]!
      ? 2
      : 0;
}

function adaptiveSpacing(
  minimum: number,
  maximum: number,
  gridSize: number,
  limit: number,
): number {
  let spacing = gridSize;
  while ((maximum - minimum) / spacing > limit) spacing *= 2;
  return spacing;
}

function lineIntersections(
  vertices: readonly Vec3[],
  constantAxis: 0 | 1 | 2,
  varyingAxis: 0 | 1 | 2,
  coordinate: number,
): readonly number[] {
  const intersections: number[] = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index]!;
    const end = vertices[(index + 1) % vertices.length]!;
    const startCoordinate = start[constantAxis];
    const endCoordinate = end[constantAxis];
    const crosses =
      (startCoordinate <= coordinate + EPSILON &&
        endCoordinate > coordinate + EPSILON) ||
      (endCoordinate <= coordinate + EPSILON &&
        startCoordinate > coordinate + EPSILON);
    if (!crosses) continue;
    const denominator = endCoordinate - startCoordinate;
    if (Math.abs(denominator) <= EPSILON) continue;
    const amount = (coordinate - startCoordinate) / denominator;
    intersections.push(
      start[varyingAxis] + (end[varyingAxis] - start[varyingAxis]) * amount,
    );
  }
  return intersections.toSorted((left, right) => left - right);
}

function pointOnFace(
  face: Pick<DerivedFace, "normal" | "distance">,
  droppedAxis: 0 | 1 | 2,
  firstAxis: 0 | 1 | 2,
  secondAxis: 0 | 1 | 2,
  first: number,
  second: number,
): Vec3 {
  const point: [number, number, number] = [0, 0, 0];
  point[firstAxis] = first;
  point[secondAxis] = second;
  point[droppedAxis] =
    (face.distance -
      face.normal[firstAxis] * first -
      face.normal[secondAxis] * second) /
    face.normal[droppedAxis];
  return point;
}

/** Drops the dominant normal axis so the face grid keeps exact world coordinates on the other axes. */
export function projectedFaceGridSegments(
  face: Pick<DerivedFace, "normal" | "distance" | "vertices">,
  gridSize: number,
  maxLinesPerAxis = 192,
): readonly ConstructionGridSegment[] {
  if (!Number.isFinite(gridSize) || gridSize <= 0)
    throw new Error("Grid size must be positive");
  if (!Number.isInteger(maxLinesPerAxis) || maxLinesPerAxis < 1) {
    throw new Error("Grid line limit must be a positive integer");
  }
  if (face.vertices.length < 3) return [];
  const droppedAxis = dominantAxis(face.normal);
  if (Math.abs(face.normal[droppedAxis]) <= EPSILON) return [];
  const retained = ([0, 1, 2] as const).filter(
    (axis) => axis !== droppedAxis,
  ) as [0 | 1 | 2, 0 | 1 | 2];
  const segments: ConstructionGridSegment[] = [];

  for (const [constantAxis, varyingAxis] of [
    retained,
    [retained[1], retained[0]],
  ] as const) {
    const minimum = Math.min(
      ...face.vertices.map((point) => point[constantAxis]),
    );
    const maximum = Math.max(
      ...face.vertices.map((point) => point[constantAxis]),
    );
    const spacing = adaptiveSpacing(
      minimum,
      maximum,
      gridSize,
      maxLinesPerAxis,
    );
    // Brush edges already draw face boundaries, so only emit grid lines through the interior.
    const firstIndex = Math.ceil((minimum + EPSILON) / spacing);
    const lastIndex = Math.floor((maximum - EPSILON) / spacing);
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const coordinate = index * spacing;
      const intersections = lineIntersections(
        face.vertices,
        constantAxis,
        varyingAxis,
        coordinate,
      );
      if (intersections.length < 2) continue;
      const startVarying = intersections[0]!;
      const endVarying = intersections.at(-1)!;
      if (Math.abs(endVarying - startVarying) <= EPSILON) continue;
      const start = pointOnFace(
        face,
        droppedAxis,
        constantAxis,
        varyingAxis,
        coordinate,
        startVarying,
      );
      const end = pointOnFace(
        face,
        droppedAxis,
        constantAxis,
        varyingAxis,
        coordinate,
        endVarying,
      );
      segments.push({
        start,
        end,
        major: Math.abs(Math.round(coordinate / gridSize)) % 8 === 0,
      });
    }
  }
  return segments;
}
