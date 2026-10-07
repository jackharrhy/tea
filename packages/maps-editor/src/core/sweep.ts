import {
  createConvexHullBrush,
  defaultTextureProjection,
  transferFaceAttributes,
} from "./document.js";
import { deriveBrush } from "./geometry.js";
import {
  add,
  cross,
  dot,
  normalize,
  rotateAroundAxis,
  scale,
  subtract,
} from "./math.js";
import type { FaceId, IdFactory, MapBrush, MapFace, Vec3 } from "./types.js";

export type SweepPath = "straight" | "arc" | "s-bend";

export interface SweepTransform {
  /** Destination-cap displacement in the source cap's local frame. */
  readonly translation: Vec3;
  /** Per-iteration Euler rotation in world X, Y, then Z order. */
  readonly rotationDegrees: Vec3;
  /** Per-iteration uniform scale multiplier. */
  readonly scale: number;
}

export interface SweepOptions {
  readonly path: SweepPath;
  readonly segments: number;
  readonly iterations: number;
  readonly snapToInteger: boolean;
  readonly textureLock: boolean;
}

export interface SweepResult {
  /** One convex brush for every path segment and iteration. */
  readonly brushes: readonly MapBrush[];
  /** Ordered cap polygons, including the unchanged source and final destination caps. */
  readonly caps: readonly (readonly Vec3[])[];
}

const MAX_SWEEP_SEGMENTS = 128;
const MAX_SWEEP_ITERATIONS = 64;
const MAX_SWEEP_BRUSHES = 512;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function rotateEuler(vector: Vec3, rotationDegrees: Vec3): Vec3 {
  let result = rotateAroundAxis(vector, [1, 0, 0], radians(rotationDegrees[0]));
  result = rotateAroundAxis(result, [0, 1, 0], radians(rotationDegrees[1]));
  return rotateAroundAxis(result, [0, 0, 1], radians(rotationDegrees[2]));
}

function scaledRotation(rotation: Vec3, factor: number): Vec3 {
  return [rotation[0] * factor, rotation[1] * factor, rotation[2] * factor];
}

function lerp(left: Vec3, right: Vec3, amount: number): Vec3 {
  return [
    left[0] + (right[0] - left[0]) * amount,
    left[1] + (right[1] - left[1]) * amount,
    left[2] + (right[2] - left[2]) * amount,
  ];
}

function addScaledVector(point: Vec3, direction: Vec3, factor: number): Vec3 {
  return [
    point[0] + direction[0] * factor,
    point[1] + direction[1] * factor,
    point[2] + direction[2] * factor,
  ];
}

function dominantRotation(rotation: Vec3): {
  readonly axis: Vec3;
  readonly angle: number;
} {
  let index = 0;
  if (Math.abs(rotation[1]) > Math.abs(rotation[index]!)) index = 1;
  if (Math.abs(rotation[2]) > Math.abs(rotation[index]!)) index = 2;
  const axis: [number, number, number] = [0, 0, 0];
  axis[index] = 1;
  return { axis, angle: radians(rotation[index]!) };
}

function arcCenterPoint(
  start: Vec3,
  end: Vec3,
  rotation: Vec3,
  amount: number,
): Vec3 {
  const { axis, angle } = dominantRotation(rotation);
  const chord = subtract(end, start);
  const axialDistance = dot(chord, axis);
  const planarChord = addScaledVector(chord, axis, -axialDistance);
  const chordLength = Math.hypot(...planarChord);
  if (
    chordLength <= 1e-6 ||
    Math.abs(angle) <= 1e-6 ||
    Math.abs(Math.sin(angle / 2)) <= 1e-6
  ) {
    return lerp(start, end, amount);
  }
  const perpendicular = normalize(cross(axis, planarChord));
  if (!perpendicular) return lerp(start, end, amount);
  const midpoint = addScaledVector(start, planarChord, 0.5);
  const center = addScaledVector(
    midpoint,
    perpendicular,
    chordLength / (2 * Math.tan(angle / 2)),
  );
  const radial = subtract(start, center);
  return addScaledVector(
    add(center, rotateAroundAxis(radial, axis, angle * amount)),
    axis,
    axialDistance * amount,
  );
}

function hermite(
  start: Vec3,
  end: Vec3,
  startTangent: Vec3,
  endTangent: Vec3,
  amount: number,
): Vec3 {
  const amountSquared = amount * amount;
  const amountCubed = amountSquared * amount;
  const h00 = 2 * amountCubed - 3 * amountSquared + 1;
  const h10 = amountCubed - 2 * amountSquared + amount;
  const h01 = -2 * amountCubed + 3 * amountSquared;
  const h11 = amountCubed - amountSquared;
  return [
    start[0] * h00 + startTangent[0] * h10 + end[0] * h01 + endTangent[0] * h11,
    start[1] * h00 + startTangent[1] * h10 + end[1] * h01 + endTangent[1] * h11,
    start[2] * h00 + startTangent[2] * h10 + end[2] * h01 + endTangent[2] * h11,
  ];
}

function sBendCenterPoint(
  start: Vec3,
  end: Vec3,
  sourceNormal: Vec3,
  startRotation: Vec3,
  endRotation: Vec3,
  amount: number,
): Vec3 {
  const distance = Math.hypot(...subtract(end, start));
  if (distance <= 1e-6) return lerp(start, end, amount);
  const startNormal =
    normalize(rotateEuler(sourceNormal, startRotation)) ?? sourceNormal;
  const endNormal =
    normalize(rotateEuler(sourceNormal, endRotation)) ?? sourceNormal;
  return hermite(
    start,
    end,
    scale(startNormal, distance * 0.65),
    scale(endNormal, distance * 0.65),
    amount,
  );
}

function capCenterPoint(
  path: SweepPath,
  start: Vec3,
  end: Vec3,
  sourceNormal: Vec3,
  startRotation: Vec3,
  endRotation: Vec3,
  perIterationRotation: Vec3,
  amount: number,
): Vec3 {
  if (path === "arc")
    return arcCenterPoint(start, end, perIterationRotation, amount);
  if (path === "s-bend") {
    return sBendCenterPoint(
      start,
      end,
      sourceNormal,
      startRotation,
      endRotation,
      amount,
    );
  }
  return lerp(start, end, amount);
}

function snapCap(
  cap: readonly Vec3[],
  snapToInteger: boolean,
): readonly Vec3[] {
  if (!snapToInteger) return cap;
  return cap.map((point) => [
    Math.round(point[0]),
    Math.round(point[1]),
    Math.round(point[2]),
  ]);
}

function inheritedSweepBrush(
  brush: MapBrush,
  sourceFace: MapFace,
  textureLock: boolean,
): MapBrush {
  if (!textureLock) return brush;
  const inherited = brush.faces.reduce(
    (current, face) =>
      transferFaceAttributes(current, face.id, sourceFace, "rotate"),
    brush,
  );
  return { ...inherited, revision: 0 };
}

/**
 * Sweeps one convex source face through repeated cap transforms. Each adjacent cap pair becomes a
 * separately validated convex brush so curved paths remain legal Quake brushwork.
 */
export function sweepBrushFace(
  sourceBrush: MapBrush,
  faceId: FaceId,
  transform: SweepTransform,
  options: SweepOptions,
  ids: IdFactory,
): SweepResult {
  if (
    !transform.translation.every(Number.isFinite) ||
    !transform.rotationDegrees.every(Number.isFinite) ||
    !Number.isFinite(transform.scale) ||
    transform.scale <= 0
  ) {
    throw new Error(
      "Sweep transform values must be finite and its scale must be positive",
    );
  }
  if (
    !Number.isInteger(options.segments) ||
    options.segments < 1 ||
    options.segments > MAX_SWEEP_SEGMENTS
  ) {
    throw new Error(
      `Sweep segments must be an integer from 1 to ${MAX_SWEEP_SEGMENTS}`,
    );
  }
  if (
    !Number.isInteger(options.iterations) ||
    options.iterations < 1 ||
    options.iterations > MAX_SWEEP_ITERATIONS
  ) {
    throw new Error(
      `Sweep iterations must be an integer from 1 to ${MAX_SWEEP_ITERATIONS}`,
    );
  }
  if (options.segments * options.iterations > MAX_SWEEP_BRUSHES) {
    throw new Error(
      `A sweep may create at most ${MAX_SWEEP_BRUSHES} brushes per source face`,
    );
  }
  const sourceFace = sourceBrush.faces.find((face) => face.id === faceId);
  const derivedFace = deriveBrush(sourceBrush).faces.find(
    (face) => face.faceId === faceId,
  );
  if (!sourceFace || !derivedFace || derivedFace.vertices.length < 3) {
    throw new Error(`Cannot sweep unknown or invalid face ${faceId}`);
  }

  const sourceCenter = scale(
    derivedFace.vertices.reduce<Vec3>(
      (sum, vertex) => add(sum, vertex),
      [0, 0, 0],
    ),
    1 / derivedFace.vertices.length,
  );
  const localVertices = derivedFace.vertices.map((vertex) =>
    subtract(vertex, sourceCenter),
  );
  const centers: Vec3[] = [sourceCenter];
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    const rotation = scaledRotation(transform.rotationDegrees, iteration);
    centers.push(
      add(centers[iteration]!, rotateEuler(transform.translation, rotation)),
    );
  }

  const caps: (readonly Vec3[])[] = [
    snapCap(derivedFace.vertices, options.snapToInteger),
  ];
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    const startRotation = scaledRotation(transform.rotationDegrees, iteration);
    const endRotation = scaledRotation(
      transform.rotationDegrees,
      iteration + 1,
    );
    for (let segment = 1; segment <= options.segments; segment += 1) {
      const amount = segment / options.segments;
      const progress = iteration + amount;
      const rotation = scaledRotation(transform.rotationDegrees, progress);
      const capScale = transform.scale ** progress;
      const center = capCenterPoint(
        options.path,
        centers[iteration]!,
        centers[iteration + 1]!,
        derivedFace.normal,
        startRotation,
        endRotation,
        transform.rotationDegrees,
        amount,
      );
      caps.push(
        snapCap(
          localVertices.map((vertex) =>
            add(center, rotateEuler(scale(vertex, capScale), rotation)),
          ),
          options.snapToInteger,
        ),
      );
    }
  }

  const brushes: MapBrush[] = [];
  for (let index = 1; index < caps.length; index += 1) {
    const brush = createConvexHullBrush(
      [...caps[index - 1]!, ...caps[index]!],
      sourceFace.material,
      ids,
    );
    brushes.push(inheritedSweepBrush(brush, sourceFace, options.textureLock));
  }
  return { brushes, caps };
}

/**
 * Builds one independent convex prism from a source face and a translated copy of that face.
 * Unlike face extrusion, stamping never changes or continues the source brush's side planes.
 */
export function stampBrushFace(
  sourceBrush: MapBrush,
  faceId: FaceId,
  distance: number,
  ids: IdFactory,
  textureLock = true,
): MapBrush {
  if (!Number.isFinite(distance) || Math.abs(distance) <= Number.EPSILON) {
    throw new Error("Face stamp distance must be finite and non-zero");
  }
  const sourceFace = deriveBrush(sourceBrush).faces.find(
    (face) => face.faceId === faceId,
  );
  if (!sourceFace)
    throw new Error(`Cannot stamp unknown or invalid face ${faceId}`);
  const result = sweepBrushFace(
    sourceBrush,
    faceId,
    {
      translation: scale(sourceFace.normal, distance),
      rotationDegrees: [0, 0, 0],
      scale: 1,
    },
    {
      path: "straight",
      segments: 1,
      iterations: 1,
      snapToInteger: false,
      // Surface attributes always follow a stamp; projection lock is handled independently below.
      textureLock: true,
    },
    ids,
  );
  const brush = result.brushes[0];
  if (!brush)
    throw new Error("Face stamp did not produce a three-dimensional brush");
  if (textureLock) return brush;
  const faces = new Map(
    deriveBrush(brush).faces.map((face) => [face.faceId, face] as const),
  );
  return {
    ...brush,
    faces: brush.faces.map((face) => {
      const derived = faces.get(face.id);
      if (!derived)
        throw new Error(`Stamped face ${face.id} has no derived plane`);
      return Object.assign({}, face, {
        projection: defaultTextureProjection(derived.normal),
      });
    }),
  };
}
