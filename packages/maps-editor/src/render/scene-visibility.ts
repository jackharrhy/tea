import type { Bounds } from "../core/index.js";

/** Conservative homogeneous clip test for a world-space axis-aligned batch. */
export function boundsVisible(matrix: Float32Array, bounds: Bounds): boolean {
  const points: [number, number, number, number][] = [];
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        points.push([
          matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
          matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
          matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
          matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!,
        ]);
      }
    }
  }
  return ![
    (point: readonly number[]) => point[0]! < -point[3]!,
    (point: readonly number[]) => point[0]! > point[3]!,
    (point: readonly number[]) => point[1]! < -point[3]!,
    (point: readonly number[]) => point[1]! > point[3]!,
    (point: readonly number[]) => point[2]! < 0,
    (point: readonly number[]) => point[2]! > point[3]!,
  ].some((outside) => points.every(outside));
}
