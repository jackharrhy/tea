import type { Bounds } from "../core/index.js";
import type { WalkabilityMap } from "./types.js";

const MAX_GRID_DIMENSION = 1024;
export const WALKABILITY_CUTAWAY_EMPTY = -3.402_823_466_385_288_6e38;

export interface PlanWalkabilityCutawayOptions {
  /** Horizontal size of one height-field cell in map units. */
  readonly cellSize?: number;
  /** Height retained above each standing player origin. */
  readonly clearance?: number;
  /** Maximum distance from a sampled node that receives a cutaway height. */
  readonly influence?: number;
  /** Restricts the cutaway to one weakly connected component. */
  readonly component?: number;
}

export interface WalkabilityCutawayGrid {
  readonly width: number;
  readonly height: number;
  readonly bounds: Bounds;
  readonly cellSize: number;
  readonly clearance: number;
  readonly influence: number;
  readonly coveredCells: number;
  /** World-space cutoff height per cell. Empty cells contain `WALKABILITY_CUTAWAY_EMPTY`. */
  readonly values: Float32Array;
}

function positive(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result <= 0) {
    throw new RangeError(`${label} must be a positive finite number`);
  }
  return result;
}

function dimension(extent: number, cellSize: number): number {
  return Math.max(
    1,
    Math.min(MAX_GRID_DIMENSION, Math.ceil(extent / cellSize)),
  );
}

function clampCell(value: number, size: number): number {
  return Math.max(0, Math.min(size - 1, Math.floor(value)));
}

/** Cuts ceilings near reachable samples while leaving unprobed space intact. */
export function planWalkabilityCutaway(
  walkability: WalkabilityMap,
  bounds: Bounds,
  options: PlanWalkabilityCutawayOptions = {},
): WalkabilityCutawayGrid {
  const extentX = bounds.max[0] - bounds.min[0];
  const extentY = bounds.max[1] - bounds.min[1];
  if (
    !Number.isFinite(extentX) ||
    !Number.isFinite(extentY) ||
    extentX < 0 ||
    extentY < 0
  ) {
    throw new RangeError(
      "Walkability cutaway bounds must be finite and ordered",
    );
  }
  const requestedCellSize = positive(
    options.cellSize,
    walkability.parameters.spacing * 0.5,
    "Walkability cutaway cell size",
  );
  const cellSize = Math.max(
    requestedCellSize,
    extentX / MAX_GRID_DIMENSION,
    extentY / MAX_GRID_DIMENSION,
  );
  const clearance = positive(
    options.clearance,
    48,
    "Walkability cutaway clearance",
  );
  const influence = positive(
    options.influence,
    walkability.parameters.spacing * 2.5,
    "Walkability cutaway influence",
  );
  const component = options.component;
  if (
    component !== undefined &&
    (!Number.isInteger(component) || component < 0)
  ) {
    throw new RangeError(
      "Walkability cutaway component must be a non-negative integer",
    );
  }

  const width = dimension(extentX, cellSize);
  const height = dimension(extentY, cellSize);
  const count = width * height;
  const values = new Float32Array(count);
  values.fill(WALKABILITY_CUTAWAY_EMPTY);
  const distances = new Int32Array(count);
  distances.fill(0x7fff_ffff);
  const queue: number[] = [];

  for (const node of walkability.nodes) {
    if (component !== undefined && node.component !== component) continue;
    const x = clampCell(
      ((node.position[0] - bounds.min[0]) / Math.max(1, extentX)) * width,
      width,
    );
    const y = clampCell(
      ((node.position[1] - bounds.min[1]) / Math.max(1, extentY)) * height,
      height,
    );
    const index = y * width + x;
    const desired = node.position[2] + clearance;
    const cutoff =
      node.ceilingOriginZ === null
        ? desired
        : Math.max(node.position[2], Math.min(desired, node.ceilingOriginZ));
    if (distances[index] !== 0) {
      distances[index] = 0;
      queue.push(index);
    }
    values[index] = Math.max(
      values[index] ?? WALKABILITY_CUTAWAY_EMPTY,
      cutoff,
    );
  }

  const maximumSteps = Math.ceil(influence / cellSize);
  let head = 0;
  while (head < queue.length) {
    const index = queue[head++]!;
    const distance = distances[index]!;
    if (distance >= maximumSteps) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) continue;
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height)
          continue;
        const next = nextY * width + nextX;
        const nextDistance = distance + 1;
        if (nextDistance >= distances[next]!) continue;
        distances[next] = nextDistance;
        values[next] = values[index]!;
        queue.push(next);
      }
    }
  }

  let coveredCells = 0;
  for (const value of values)
    if (value !== WALKABILITY_CUTAWAY_EMPTY) coveredCells += 1;
  return {
    width,
    height,
    bounds,
    cellSize,
    clearance,
    influence,
    coveredCells,
    values,
  };
}
