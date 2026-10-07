import type { Bounds, ParsedWorld, Vec3Tuple } from "./types.js";

const VERTEX_FLOATS = 7;
const DEFAULT_SIZE = 1024;
const DEFAULT_PADDING = 0.04;
const MAX_SIZE = 8192;

export type OverviewRotation = 0 | 90 | "auto";

export interface PlanOverviewOptions {
  readonly width?: number;
  readonly height?: number;
  /** Fraction of each image edge reserved as empty space. */
  readonly padding?: number;
  readonly rotation?: OverviewRotation;
  readonly zMin?: number;
  readonly zMax?: number;
  readonly includeSky?: boolean;
}

export interface OverviewLayout {
  readonly width: number;
  readonly height: number;
  readonly padding: number;
  readonly rotation: 0 | 90;
  readonly bounds: Bounds;
  readonly origin: Vec3Tuple;
  readonly eye: Vec3Tuple;
  readonly zMin: number;
  readonly zMax: number;
  readonly viewWidth: number;
  readonly viewHeight: number;
  readonly worldUnitsPerPixel: number;
}

function finiteDimension(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 1 || value > MAX_SIZE) {
    throw new RangeError(
      `Overview dimensions must be between 1 and ${MAX_SIZE}`,
    );
  }
  return Math.max(1, Math.round(value));
}

function includePoint(
  bounds: { min: number[]; max: number[] },
  point: Vec3Tuple,
): void {
  for (let axis = 0; axis < 3; axis += 1) {
    const component = point[axis] ?? 0;
    bounds.min[axis] = Math.min(bounds.min[axis] ?? Infinity, component);
    bounds.max[axis] = Math.max(bounds.max[axis] ?? -Infinity, component);
  }
}

function renderableBounds(world: ParsedWorld, includeSky: boolean): Bounds {
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  const faceIndices = new Set<number>();
  const facesBySourceIndex = new Map(
    world.faces.map((face) => [face.sourceIndex, face] as const),
  );
  for (const batch of world.batches) {
    if (
      !world.models[batch.modelIndex]?.visible ||
      (!includeSky && batch.kind === "sky")
    )
      continue;
    for (const faceIndex of batch.faceIndices) faceIndices.add(faceIndex);
  }
  for (const faceIndex of faceIndices) {
    const face = facesBySourceIndex.get(faceIndex);
    if (!face) continue;
    for (let offset = 0; offset < face.indexCount; offset += 1) {
      const vertexIndex = world.indices[face.firstIndex + offset];
      if (vertexIndex === undefined) continue;
      const base = vertexIndex * VERTEX_FLOATS;
      const point: Vec3Tuple = [
        world.vertices[base] ?? 0,
        world.vertices[base + 1] ?? 0,
        world.vertices[base + 2] ?? 0,
      ];
      if (point.every(Number.isFinite)) includePoint(bounds, point);
    }
  }
  if (bounds.min.some((value) => !Number.isFinite(value))) return world.bounds;
  return {
    min: [bounds.min[0] ?? 0, bounds.min[1] ?? 0, bounds.min[2] ?? 0],
    max: [bounds.max[0] ?? 0, bounds.max[1] ?? 0, bounds.max[2] ?? 0],
  };
}

function scaleFor(
  rotation: 0 | 90,
  extentX: number,
  extentY: number,
  width: number,
  height: number,
  padding: number,
): number {
  const availableWidth = Math.max(1, width * (1 - padding * 2));
  const availableHeight = Math.max(1, height * (1 - padding * 2));
  const horizontal = rotation === 0 ? extentX : extentY;
  const vertical = rotation === 0 ? extentY : extentX;
  return Math.max(
    horizontal / availableWidth,
    vertical / availableHeight,
    1 / Math.max(width, height),
  );
}

export function planOverview(
  world: ParsedWorld,
  options: PlanOverviewOptions = {},
): OverviewLayout {
  const width = finiteDimension(options.width, DEFAULT_SIZE);
  const height = finiteDimension(options.height, DEFAULT_SIZE);
  const requestedPadding = options.padding ?? DEFAULT_PADDING;
  if (!Number.isFinite(requestedPadding))
    throw new RangeError("Overview padding must be finite");
  const padding = Math.min(0.45, Math.max(0, requestedPadding));
  const bounds = renderableBounds(world, options.includeSky ?? false);
  const extentX = Math.max(0, bounds.max[0] - bounds.min[0]);
  const extentY = Math.max(0, bounds.max[1] - bounds.min[1]);
  const requestedRotation = options.rotation ?? "auto";
  if (
    requestedRotation !== "auto" &&
    requestedRotation !== 0 &&
    requestedRotation !== 90
  ) {
    throw new RangeError("Overview rotation must be auto, 0, or 90");
  }
  const zeroScale = scaleFor(0, extentX, extentY, width, height, padding);
  const ninetyScale = scaleFor(90, extentX, extentY, width, height, padding);
  const rotation =
    requestedRotation === "auto"
      ? ninetyScale < zeroScale
        ? 90
        : 0
      : requestedRotation;
  const worldUnitsPerPixel = rotation === 0 ? zeroScale : ninetyScale;
  const zMin = options.zMin ?? bounds.min[2];
  const zMax = options.zMax ?? bounds.max[2];
  if (!Number.isFinite(zMin) || !Number.isFinite(zMax) || zMin > zMax) {
    throw new RangeError("Overview zMin must be less than or equal to zMax");
  }
  const centerX = (bounds.min[0] + bounds.max[0]) * 0.5;
  const centerY = (bounds.min[1] + bounds.max[1]) * 0.5;
  const depth = Math.max(1, bounds.max[2] - bounds.min[2]);
  const eyeZ = Math.max(bounds.max[2], zMax) + Math.max(1024, depth + 64);
  return {
    width,
    height,
    padding,
    rotation,
    bounds,
    origin: [centerX, centerY, zMax],
    eye: [centerX, centerY, eyeZ],
    zMin,
    zMax,
    viewWidth: width * worldUnitsPerPixel,
    viewHeight: height * worldUnitsPerPixel,
    worldUnitsPerPixel,
  };
}
