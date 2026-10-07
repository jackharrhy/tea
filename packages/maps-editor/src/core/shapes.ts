import {
  createBoxBrush,
  defaultTextureProjection,
  type TransformAxis,
} from "./document.js";
import { deriveBrushFromVertices } from "./geometry.js";
import { dot, GEOMETRY_EPSILON, planeFromPoints } from "./math.js";
import type { Bounds, IdFactory, MapBrush, MapFace, Vec3 } from "./types.js";

export type SimpleShapeKind =
  | "cuboid"
  | "stairs"
  | "arch"
  | "cylinder"
  | "cone"
  | "uv-sphere"
  | "ico-sphere";

export type CircleMode = "edge-aligned" | "vertex-aligned" | "scalable";
export type StairDirection =
  | "positive-x"
  | "negative-x"
  | "positive-y"
  | "negative-y";

export interface SimpleShapeOptions {
  readonly kind: SimpleShapeKind;
  readonly axis: TransformAxis;
  readonly sides: number;
  readonly circleMode: CircleMode;
  readonly hollow: boolean;
  readonly thickness: number;
  readonly rings: number;
  readonly accuracy: number;
  readonly stepHeight: number;
  readonly stairDirection: StairDirection;
}

export const DEFAULT_SIMPLE_SHAPE_OPTIONS: SimpleShapeOptions = {
  kind: "cuboid",
  axis: 2,
  sides: 8,
  circleMode: "edge-aligned",
  hollow: false,
  thickness: 16,
  rings: 8,
  accuracy: 1,
  stepHeight: 16,
  stairDirection: "positive-x",
};

const SCALABLE_SIDE_COUNTS = [12, 24, 48, 96] as const;
const MAX_UV_SPHERE_FACES = 192;

function assertShapeInputs(bounds: Bounds, material: string): string {
  if (![...bounds.min, ...bounds.max].every(Number.isFinite)) {
    throw new Error("Simple-shape bounds must be finite");
  }
  if (
    bounds.min.some(
      (component, axis) => bounds.max[axis]! - component <= GEOMETRY_EPSILON,
    )
  ) {
    throw new Error(
      "Simple-shape bounds must enclose positive volume on every axis",
    );
  }
  const normalizedMaterial = material.trim();
  if (!normalizedMaterial) throw new Error("Simple shapes require a material");
  return normalizedMaterial;
}

function assertInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
}

function circularAxes(
  axis: TransformAxis,
): readonly [TransformAxis, TransformAxis] {
  return axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
}

function normalizedPoint(point: Vec3): Vec3 {
  const magnitude = Math.hypot(...point);
  return [point[0] / magnitude, point[1] / magnitude, point[2] / magnitude];
}

function circlePoint(
  bounds: Bounds,
  axis: TransformAxis,
  axisCoordinate: number,
  sides: number,
  mode: CircleMode,
  index: number,
  radialScale = 1,
  inset = 0,
  firstNormalization = 1,
  secondNormalization = 1,
): Vec3 {
  const [firstAxis, secondAxis] = circularAxes(axis);
  const center: Vec3 = bounds.min.map(
    (component, componentAxis) => (component + bounds.max[componentAxis]!) / 2,
  ) as [number, number, number];
  const firstRadius =
    (bounds.max[firstAxis]! - bounds.min[firstAxis]!) / 2 - inset;
  const secondRadius =
    (bounds.max[secondAxis]! - bounds.min[secondAxis]!) / 2 - inset;
  if (firstRadius <= GEOMETRY_EPSILON || secondRadius <= GEOMETRY_EPSILON) {
    throw new Error("Shape thickness leaves no circular interior");
  }
  const phase = mode === "edge-aligned" ? Math.PI / sides : 0;
  const radians = phase + (index / sides) * Math.PI * 2;
  const point = [...center] as [number, number, number];
  point[axis] = axisCoordinate;
  point[firstAxis] =
    point[firstAxis]! +
    Math.cos(radians) * firstRadius * radialScale * firstNormalization;
  point[secondAxis] =
    point[secondAxis]! +
    Math.sin(radians) * secondRadius * radialScale * secondNormalization;
  if (mode === "scalable") {
    point[firstAxis] = Math.round(point[firstAxis]!);
    point[secondAxis] = Math.round(point[secondAxis]!);
  }
  return point;
}

function circle(
  bounds: Bounds,
  axis: TransformAxis,
  axisCoordinate: number,
  options: Pick<SimpleShapeOptions, "sides" | "circleMode">,
  radialScale = 1,
  inset = 0,
): readonly Vec3[] {
  const phase =
    options.circleMode === "edge-aligned" ? Math.PI / options.sides : 0;
  const angles = Array.from(
    { length: options.sides },
    (_, index) => phase + (index / options.sides) * Math.PI * 2,
  );
  const firstNormalization =
    1 / Math.max(...angles.map((radians) => Math.abs(Math.cos(radians))));
  const secondNormalization =
    1 / Math.max(...angles.map((radians) => Math.abs(Math.sin(radians))));
  const points = Array.from({ length: options.sides }, (_, index) =>
    circlePoint(
      bounds,
      axis,
      axisCoordinate,
      options.sides,
      options.circleMode,
      index,
      radialScale,
      inset,
      firstNormalization,
      secondNormalization,
    ),
  );
  const unique = new Set(points.map((point) => point.join(",")));
  if (unique.size !== points.length) {
    throw new Error(
      "Shape bounds are too small for this scalable circle precision",
    );
  }
  return points;
}

function orientedFacePoints(
  polygon: readonly Vec3[],
  interior: Vec3,
): readonly [Vec3, Vec3, Vec3] {
  for (let second = 1; second < polygon.length - 1; second += 1) {
    for (let third = second + 1; third < polygon.length; third += 1) {
      const points = [polygon[0]!, polygon[second]!, polygon[third]!] as const;
      const plane = planeFromPoints(points);
      if (!plane) continue;
      return dot(plane.normal, interior) <= plane.distance + GEOMETRY_EPSILON
        ? points
        : [points[0], points[2], points[1]];
    }
  }
  throw new Error("Simple shape produced a degenerate polygon");
}

function createPolyhedronBrush(
  polygons: readonly (readonly Vec3[])[],
  material: string,
  ids: IdFactory,
  operation: string,
): MapBrush {
  const vertices = polygons.flat();
  const interior = vertices
    .reduce<[number, number, number]>(
      (sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]],
      [0, 0, 0],
    )
    .map((component) => component / vertices.length) as [
    number,
    number,
    number,
  ];
  const faces: MapFace[] = [];
  for (const polygon of polygons) {
    const planePoints = orientedFacePoints(polygon, interior);
    const plane = planeFromPoints(planePoints)!;
    if (
      faces.some((face) => {
        const candidate = planeFromPoints(face.planePoints)!;
        return (
          dot(candidate.normal, plane.normal) >= 1 - 1e-7 &&
          Math.abs(candidate.distance - plane.distance) <= GEOMETRY_EPSILON * 4
        );
      })
    ) {
      continue;
    }
    faces.push({
      id: ids.face(),
      planePoints,
      material,
      projection: defaultTextureProjection(plane.normal),
      surface: {},
    });
  }
  const brush: MapBrush = {
    kind: "brush",
    id: ids.brush(),
    revision: 0,
    faces,
  };
  const derived = deriveBrushFromVertices(brush, vertices);
  if (!derived.valid) {
    throw new Error(
      `${operation} would create an invalid brush: ${derived.diagnostics
        .map((diagnostic) => diagnostic.message)
        .join("; ")}`,
    );
  }
  return brush;
}

function prismPolygons(
  bottom: readonly Vec3[],
  top: readonly Vec3[],
): readonly (readonly Vec3[])[] {
  const polygons: (readonly Vec3[])[] = [bottom, top];
  for (let index = 0; index < bottom.length; index += 1) {
    const next = (index + 1) % bottom.length;
    polygons.push([bottom[index]!, bottom[next]!, top[next]!, top[index]!]);
  }
  return polygons;
}

function createCylinder(
  bounds: Bounds,
  material: string,
  options: SimpleShapeOptions,
  ids: IdFactory,
): readonly MapBrush[] {
  const bottom = circle(
    bounds,
    options.axis,
    bounds.min[options.axis]!,
    options,
  );
  const top = circle(bounds, options.axis, bounds.max[options.axis]!, options);
  if (!options.hollow) {
    return [
      createPolyhedronBrush(
        prismPolygons(bottom, top),
        material,
        ids,
        "Cylinder creation",
      ),
    ];
  }
  if (!Number.isFinite(options.thickness) || options.thickness <= 0) {
    throw new Error("Hollow cylinder thickness must be positive");
  }
  const innerBottom = circle(
    bounds,
    options.axis,
    bounds.min[options.axis]!,
    options,
    1,
    options.thickness,
  );
  const innerTop = circle(
    bounds,
    options.axis,
    bounds.max[options.axis]!,
    options,
    1,
    options.thickness,
  );
  return bottom.map((_, index) => {
    const next = (index + 1) % bottom.length;
    return createPolyhedronBrush(
      prismPolygons(
        [
          bottom[index]!,
          bottom[next]!,
          innerBottom[next]!,
          innerBottom[index]!,
        ],
        [top[index]!, top[next]!, innerTop[next]!, innerTop[index]!],
      ),
      material,
      ids,
      "Hollow cylinder creation",
    );
  });
}

function createCone(
  bounds: Bounds,
  material: string,
  options: SimpleShapeOptions,
  ids: IdFactory,
): readonly MapBrush[] {
  const base = circle(bounds, options.axis, bounds.min[options.axis]!, options);
  const tip = bounds.min.map((component, axis) =>
    axis === options.axis
      ? bounds.max[axis]!
      : (component + bounds.max[axis]!) / 2,
  ) as [number, number, number];
  const polygons: (readonly Vec3[])[] = [base];
  for (let index = 0; index < base.length; index += 1) {
    polygons.push([base[index]!, base[(index + 1) % base.length]!, tip]);
  }
  return [createPolyhedronBrush(polygons, material, ids, "Cone creation")];
}

function createStairs(
  bounds: Bounds,
  material: string,
  options: SimpleShapeOptions,
  ids: IdFactory,
): readonly MapBrush[] {
  if (!Number.isFinite(options.stepHeight) || options.stepHeight <= 0) {
    throw new Error("Stair step height must be positive");
  }
  const stepCount = Math.max(
    1,
    Math.ceil((bounds.max[2] - bounds.min[2]) / options.stepHeight),
  );
  if (stepCount > 128) throw new Error("Stairs may contain at most 128 steps");
  const directionAxis: TransformAxis = options.stairDirection.endsWith("x")
    ? 0
    : 1;
  const positive = options.stairDirection.startsWith("positive");
  const treadDepth =
    (bounds.max[directionAxis]! - bounds.min[directionAxis]!) / stepCount;
  return Array.from({ length: stepCount }, (_, index) => {
    const min = [...bounds.min] as [number, number, number];
    const max = [...bounds.max] as [number, number, number];
    min[directionAxis] = positive
      ? bounds.min[directionAxis]! + treadDepth * index
      : bounds.max[directionAxis]! - treadDepth * (index + 1);
    max[directionAxis] = positive
      ? bounds.min[directionAxis]! + treadDepth * (index + 1)
      : bounds.max[directionAxis]! - treadDepth * index;
    max[2] = Math.min(
      bounds.min[2] + options.stepHeight * (index + 1),
      bounds.max[2],
    );
    return createBoxBrush(min, max, material, ids);
  });
}

function createArch(
  bounds: Bounds,
  material: string,
  options: SimpleShapeOptions,
  ids: IdFactory,
): readonly MapBrush[] {
  if (!Number.isFinite(options.thickness) || options.thickness <= 0) {
    throw new Error("Arch thickness must be positive");
  }
  const runAxis = options.axis;
  const horizontalAxis: TransformAxis = runAxis === 0 ? 1 : 0;
  const verticalAxis: TransformAxis = runAxis === 2 ? 1 : 2;
  const horizontalCenter =
    (bounds.min[horizontalAxis]! + bounds.max[horizontalAxis]!) / 2;
  const horizontalRadius =
    (bounds.max[horizontalAxis]! - bounds.min[horizontalAxis]!) / 2;
  const verticalRadius = bounds.max[verticalAxis]! - bounds.min[verticalAxis]!;
  if (
    horizontalRadius - options.thickness <= GEOMETRY_EPSILON ||
    verticalRadius - options.thickness <= GEOMETRY_EPSILON
  ) {
    throw new Error("Arch thickness leaves no opening");
  }
  const segmentCount = Math.max(2, Math.ceil(options.sides / 2));
  const angles = Array.from(
    { length: segmentCount + 1 },
    (_, index) => (index / segmentCount) * Math.PI,
  );
  const verticalNormalization = 1 / Math.max(...angles.map(Math.sin));
  const crossSection = (index: number, inner: boolean): Vec3 => {
    const radians = angles[index]!;
    const point = bounds.min.map(
      (component, axis) => (component + bounds.max[axis]!) / 2,
    ) as [number, number, number];
    point[horizontalAxis] =
      horizontalCenter +
      Math.cos(radians) * (horizontalRadius - (inner ? options.thickness : 0));
    point[verticalAxis] =
      bounds.min[verticalAxis]! +
      Math.sin(radians) *
        (verticalRadius - (inner ? options.thickness : 0)) *
        verticalNormalization;
    if (options.circleMode === "scalable") {
      point[horizontalAxis] = Math.round(point[horizontalAxis]!);
      point[verticalAxis] = Math.round(point[verticalAxis]!);
    }
    return point;
  };
  return Array.from({ length: segmentCount }, (_, index) => {
    const section = [
      crossSection(index, false),
      crossSection(index + 1, false),
      crossSection(index + 1, true),
      crossSection(index, true),
    ];
    const start = section.map((point) => {
      const result: [number, number, number] = [point[0], point[1], point[2]];
      result[runAxis] = bounds.min[runAxis]!;
      return result;
    });
    const end = section.map((point) => {
      const result: [number, number, number] = [point[0], point[1], point[2]];
      result[runAxis] = bounds.max[runAxis]!;
      return result;
    });
    return createPolyhedronBrush(
      prismPolygons(start, end),
      material,
      ids,
      "Arch creation",
    );
  });
}

function createUvSphere(
  bounds: Bounds,
  material: string,
  options: SimpleShapeOptions,
  ids: IdFactory,
): readonly MapBrush[] {
  assertInteger(options.rings, 1, 32, "UV sphere rings");
  const faceCount = options.sides * (options.rings + 1);
  if (faceCount > MAX_UV_SPHERE_FACES) {
    throw new Error(
      `A UV sphere may contain at most ${MAX_UV_SPHERE_FACES} faces`,
    );
  }
  const centerAxis =
    (bounds.min[options.axis]! + bounds.max[options.axis]!) / 2;
  const axisRadius =
    (bounds.max[options.axis]! - bounds.min[options.axis]!) / 2;
  const rings = Array.from({ length: options.rings }, (_, ringIndex) => {
    const radians = (Math.PI * (ringIndex + 1)) / (options.rings + 1);
    return circle(
      bounds,
      options.axis,
      centerAxis + Math.cos(radians) * axisRadius,
      options,
      Math.sin(radians),
    );
  });
  const pole = (coordinate: number): Vec3 =>
    bounds.min.map((component, axis) =>
      axis === options.axis ? coordinate : (component + bounds.max[axis]!) / 2,
    ) as [number, number, number];
  const top = pole(bounds.max[options.axis]!);
  const bottom = pole(bounds.min[options.axis]!);
  const polygons: (readonly Vec3[])[] = [];
  for (let side = 0; side < options.sides; side += 1) {
    const next = (side + 1) % options.sides;
    polygons.push([top, rings[0]![side]!, rings[0]![next]!]);
    for (let ring = 0; ring < rings.length - 1; ring += 1) {
      polygons.push([
        rings[ring]![side]!,
        rings[ring + 1]![side]!,
        rings[ring + 1]![next]!,
        rings[ring]![next]!,
      ]);
    }
    polygons.push([rings.at(-1)![side]!, bottom, rings.at(-1)![next]!]);
  }
  return [createPolyhedronBrush(polygons, material, ids, "UV sphere creation")];
}

interface IndexedTriangle {
  readonly vertices: readonly [number, number, number];
}

function createIcoSphere(
  bounds: Bounds,
  material: string,
  options: SimpleShapeOptions,
  ids: IdFactory,
): readonly MapBrush[] {
  assertInteger(options.accuracy, 1, 3, "Icosphere accuracy");
  const golden = (1 + Math.sqrt(5)) / 2;
  let vertices: Vec3[] = [
    [-1, golden, 0],
    [1, golden, 0],
    [-1, -golden, 0],
    [1, -golden, 0],
    [0, -1, golden],
    [0, 1, golden],
    [0, -1, -golden],
    [0, 1, -golden],
    [golden, 0, -1],
    [golden, 0, 1],
    [-golden, 0, -1],
    [-golden, 0, 1],
  ];
  let triangles: IndexedTriangle[] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ].map((triangle) => ({ vertices: triangle as [number, number, number] }));
  vertices = vertices.map(normalizedPoint);
  for (let level = 1; level < options.accuracy; level += 1) {
    const midpointCache = new Map<string, number>();
    const midpoint = (first: number, second: number): number => {
      const key = first < second ? `${first}:${second}` : `${second}:${first}`;
      const cached = midpointCache.get(key);
      if (cached !== undefined) return cached;
      const left = vertices[first]!;
      const right = vertices[second]!;
      const index = vertices.length;
      vertices.push(
        normalizedPoint([
          (left[0] + right[0]) / 2,
          (left[1] + right[1]) / 2,
          (left[2] + right[2]) / 2,
        ]),
      );
      midpointCache.set(key, index);
      return index;
    };
    triangles = triangles.flatMap(({ vertices: [a, b, c] }) => {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      return [
        { vertices: [a, ab, ca] },
        { vertices: [b, bc, ab] },
        { vertices: [c, ca, bc] },
        { vertices: [ab, bc, ca] },
      ];
    });
  }
  const center = bounds.min.map(
    (component, axis) => (component + bounds.max[axis]!) / 2,
  ) as [number, number, number];
  const radius = bounds.min.map(
    (component, axis) => (bounds.max[axis]! - component) / 2,
  ) as [number, number, number];
  const extent = Math.max(...vertices.flatMap((point) => point.map(Math.abs)));
  const fitted = vertices.map<Vec3>((point) => [
    center[0] + (point[0] / extent) * radius[0],
    center[1] + (point[1] / extent) * radius[1],
    center[2] + (point[2] / extent) * radius[2],
  ]);
  return [
    createPolyhedronBrush(
      triangles.map((triangle) =>
        triangle.vertices.map((index) => fitted[index]!),
      ),
      material,
      ids,
      "Icosphere creation",
    ),
  ];
}

/** Creates TrenchBroom-style simple shape brushwork inside one authored bounding box. */
export function createSimpleShapeBrushes(
  bounds: Bounds,
  material: string,
  options: SimpleShapeOptions,
  ids: IdFactory,
): readonly MapBrush[] {
  const normalizedMaterial = assertShapeInputs(bounds, material);
  assertInteger(options.sides, 3, 96, "Simple-shape sides");
  if (
    options.circleMode === "scalable" &&
    !SCALABLE_SIDE_COUNTS.includes(
      options.sides as (typeof SCALABLE_SIDE_COUNTS)[number],
    )
  ) {
    throw new Error("Scalable circles support 12, 24, 48, or 96 sides");
  }
  if (options.kind === "cuboid") {
    return [createBoxBrush(bounds.min, bounds.max, normalizedMaterial, ids)];
  }
  if (options.kind === "stairs") {
    return createStairs(bounds, normalizedMaterial, options, ids);
  }
  if (options.kind === "arch") {
    return createArch(bounds, normalizedMaterial, options, ids);
  }
  if (options.kind === "cylinder") {
    return createCylinder(bounds, normalizedMaterial, options, ids);
  }
  if (options.kind === "cone") {
    return createCone(bounds, normalizedMaterial, options, ids);
  }
  if (options.kind === "uv-sphere") {
    return createUvSphere(bounds, normalizedMaterial, options, ids);
  }
  return createIcoSphere(bounds, normalizedMaterial, options, ids);
}
