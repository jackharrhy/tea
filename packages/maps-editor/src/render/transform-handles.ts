import { boundsCenter } from "../core/math.js";
export { boundsCenter } from "../core/math.js";
import type { Bounds, TransformAxis, Vec3 } from "../core/index.js";
import type { ScaleHandle, ScaleSide } from "./viewport-geometry.js";

export function scaleHandles(
  bounds: Bounds,
  activeAxes: readonly TransformAxis[],
): readonly ScaleHandle[] {
  const center = boundsCenter(bounds);
  const active = new Set(activeAxes);
  const choicesFor = (axis: TransformAxis): readonly ScaleSide[] =>
    active.has(axis) && bounds.max[axis] - bounds.min[axis] > 1e-6
      ? [-1, 0, 1]
      : [0];
  const handles: ScaleHandle[] = [];
  for (const x of choicesFor(0)) {
    for (const y of choicesFor(1)) {
      for (const z of choicesFor(2)) {
        const sides = [x, y, z] as const;
        const axes = sides.flatMap((side, axis) =>
          side === 0 ? [] : [axis as TransformAxis],
        );
        if (axes.length === 0) continue;
        handles.push({
          point: sides.map((side, axis) =>
            side < 0
              ? bounds.min[axis]!
              : side > 0
                ? bounds.max[axis]!
                : center[axis]!,
          ) as [number, number, number],
          axes,
          sides,
        });
      }
    }
  }
  return handles;
}

export function scalePivot(
  bounds: Bounds,
  handle: ScaleHandle,
  centered: boolean,
): Vec3 {
  const pivot = [...boundsCenter(bounds)] as [number, number, number];
  if (centered) return pivot;
  for (const axis of handle.axes) {
    pivot[axis] = handle.sides[axis] < 0 ? bounds.max[axis] : bounds.min[axis];
  }
  return pivot;
}

export function snappedScaleFactor(value: number): number {
  return Math.max(0.05, Math.min(20, Math.round(value * 20) / 20));
}
