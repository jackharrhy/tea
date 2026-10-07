import type { Bounds, Vec3 } from "./types.js";

export interface BoundsSpatialEntry<T> {
  readonly bounds: Bounds;
  readonly value: T;
}

export interface SpatialRayHit<T> {
  readonly distance: number;
  readonly value: T;
}

interface SpatialNode<T> {
  readonly bounds: Bounds;
  readonly entries?: readonly BoundsSpatialEntry<T>[];
  readonly left?: SpatialNode<T>;
  readonly right?: SpatialNode<T>;
}

function unionBounds<T>(entries: readonly BoundsSpatialEntry<T>[]): Bounds {
  const first = entries[0]!.bounds;
  const min: [number, number, number] = [...first.min];
  const max: [number, number, number] = [...first.max];
  for (const { bounds } of entries.slice(1)) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, bounds.min[axis]!);
      max[axis] = Math.max(max[axis]!, bounds.max[axis]!);
    }
  }
  return { min, max };
}

function validateBounds(bounds: Bounds): void {
  for (let axis = 0; axis < 3; axis += 1) {
    if (
      !Number.isFinite(bounds.min[axis]) ||
      !Number.isFinite(bounds.max[axis]) ||
      bounds.min[axis]! > bounds.max[axis]!
    ) {
      throw new Error("Spatial index bounds must be finite and ordered");
    }
  }
}

function buildNode<T>(
  entries: readonly BoundsSpatialEntry<T>[],
  leafSize: number,
): SpatialNode<T> {
  const bounds = unionBounds(entries);
  if (entries.length <= leafSize) return { bounds, entries };
  const extents: Vec3 = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];
  const axis =
    extents[1] > extents[0]
      ? extents[2] > extents[1]
        ? 2
        : 1
      : extents[2] > extents[0]
        ? 2
        : 0;
  const ordered = entries.toSorted(
    (left, right) =>
      left.bounds.min[axis]! +
      left.bounds.max[axis]! -
      (right.bounds.min[axis]! + right.bounds.max[axis]!),
  );
  const middle = Math.floor(ordered.length / 2);
  return {
    bounds,
    left: buildNode(ordered.slice(0, middle), leafSize),
    right: buildNode(ordered.slice(middle), leafSize),
  };
}

function rayBoundsDistance(
  bounds: Bounds,
  origin: Vec3,
  direction: Vec3,
  padding = 0,
): number | null {
  let near = 0;
  let far = Number.POSITIVE_INFINITY;
  for (let axis = 0; axis < 3; axis += 1) {
    const component = direction[axis]!;
    if (Math.abs(component) <= 1e-12) {
      if (
        origin[axis]! < bounds.min[axis]! - padding ||
        origin[axis]! > bounds.max[axis]! + padding
      )
        return null;
      continue;
    }
    let first = (bounds.min[axis]! - padding - origin[axis]!) / component;
    let second = (bounds.max[axis]! + padding - origin[axis]!) / component;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return null;
  }
  return far < 0 ? null : near;
}

function boundsIntersect(left: Bounds, right: Bounds): boolean {
  return left.min.every(
    (minimum, axis) =>
      minimum <= right.max[axis]! && left.max[axis]! >= right.min[axis]!,
  );
}

/** Immutable median-split AABB tree for broad-phase editor picking and region queries. */
export class BoundsSpatialIndex<T> {
  private readonly root: SpatialNode<T> | null;
  public readonly size: number;

  public constructor(entries: readonly BoundsSpatialEntry<T>[], leafSize = 8) {
    if (!Number.isInteger(leafSize) || leafSize < 1) {
      throw new Error("Spatial index leaf size must be a positive integer");
    }
    for (const { bounds } of entries) validateBounds(bounds);
    this.size = entries.length;
    this.root = entries.length === 0 ? null : buildNode(entries, leafSize);
  }

  public queryRay(origin: Vec3, direction: Vec3): readonly SpatialRayHit<T>[] {
    if (
      !this.root ||
      !origin.every(Number.isFinite) ||
      !direction.every(Number.isFinite)
    )
      return [];
    const hits: SpatialRayHit<T>[] = [];
    const stack = [this.root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      // Broad-phase traversal must be conservative. Orthographic rays often land
      // a few ulps beyond an authored face even when the exact plane test accepts it.
      if (rayBoundsDistance(node.bounds, origin, direction, 0.001) === null)
        continue;
      if (node.entries) {
        for (const entry of node.entries) {
          const paddedDistance = rayBoundsDistance(
            entry.bounds,
            origin,
            direction,
            0.001,
          );
          if (paddedDistance !== null) {
            const distance =
              rayBoundsDistance(entry.bounds, origin, direction) ??
              paddedDistance;
            hits.push({ distance, value: entry.value });
          }
        }
      } else {
        if (node.left) stack.push(node.left);
        if (node.right) stack.push(node.right);
      }
    }
    return hits.toSorted((left, right) => left.distance - right.distance);
  }

  public queryBounds(bounds: Bounds): readonly T[] {
    if (!this.root) return [];
    validateBounds(bounds);
    const values: T[] = [];
    const stack = [this.root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (!boundsIntersect(node.bounds, bounds)) continue;
      if (node.entries) {
        for (const entry of node.entries) {
          if (boundsIntersect(entry.bounds, bounds)) values.push(entry.value);
        }
      } else {
        if (node.left) stack.push(node.left);
        if (node.right) stack.push(node.right);
      }
    }
    return values;
  }
}
