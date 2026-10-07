import type { Vec3 } from "../core/index.js";

/** Original planar monotone-chain outline; interior points are not construction edges. */
export function planarHullOutline(points: readonly Vec3[]): readonly Vec3[] {
  if (points.length < 2) return points;
  let normal: Vec3 | null = null;
  const origin = points[0]!;
  const delta = (point: Vec3): Vec3 => [
    point[0] - origin[0],
    point[1] - origin[1],
    point[2] - origin[2],
  ];
  for (let i = 1; i < points.length && !normal; i++) {
    const a = delta(points[i]!);
    for (let j = i + 1; j < points.length; j++) {
      const b = delta(points[j]!);
      const cross: Vec3 = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
      const length = Math.hypot(...cross);
      if (length > 0.001) {
        normal = [cross[0] / length, cross[1] / length, cross[2] / length];
        break;
      }
    }
  }
  if (
    normal &&
    points.some((point) => {
      const offset = delta(point);
      return (
        Math.abs(
          offset[0] * normal![0] +
            offset[1] * normal![1] +
            offset[2] * normal![2],
        ) > 0.01
      );
    })
  )
    return []; // Volumetric candidates supply their real brush edges.
  const dropped = normal
    ? [0, 1, 2].reduce(
        (best, axis) =>
          Math.abs(normal![axis]!) > Math.abs(normal![best]!) ? axis : best,
        0,
      )
    : -1;
  const axes = [0, 1, 2].filter((axis) => axis !== dropped);
  const x = axes[0]!;
  const y = axes[1]!;
  const sorted = points.toSorted(
    (a, b) => a[x]! - b[x]! || a[y]! - b[y]! || a[2] - b[2],
  );
  const turn = (a: Vec3, b: Vec3, c: Vec3) =>
    (b[x]! - a[x]!) * (c[y]! - a[y]!) - (b[y]! - a[y]!) * (c[x]! - a[x]!);
  const chain = (input: readonly Vec3[]) => {
    const result: Vec3[] = [];
    for (const point of input) {
      while (
        result.length > 1 &&
        turn(result.at(-2)!, result.at(-1)!, point) <= 0
      )
        result.pop();
      result.push(point);
    }
    return result;
  };
  const lower = chain(sorted);
  const upper = chain(sorted.toReversed());
  const outline = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return outline;
}
