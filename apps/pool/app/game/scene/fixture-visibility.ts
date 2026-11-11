import {
  BALL_RADIUS,
  TABLE_HALF_WIDTH as W,
  TABLE_HALF_LENGTH as L,
} from "@harrhy/pool";
import { FELT_Y } from "@harrhy/pool/table";
import { Box3, MathUtils, Ray, Vector3 } from "three";

export function fixtureOpacity(
  bounds: readonly Box3[],
  camera: Vector3,
  table: { x: number; z: number },
) {
  const ray = new Ray();
  const point = new Vector3();
  const nearest = new Vector3();
  const size = new Vector3();
  const start = new Vector3();
  const end = new Vector3();
  let coverage = 0;
  for (const x of [-W, 0, W]) {
    for (const z of [-L, -L / 2, 0, L / 2, L]) {
      point.set(table.x + x, FELT_Y + BALL_RADIUS, table.z + z);
      const distance = point.distanceTo(camera);
      ray.set(camera, point.sub(camera).normalize());
      let obstruction = 0;
      for (const box of bounds) {
        box.getSize(size);
        const axis =
          size.y > size.x && size.y > size.z
            ? "y"
            : size.x > size.z
              ? "x"
              : "z";
        const radius =
          (axis === "y"
            ? Math.max(size.x, size.z)
            : axis === "x"
              ? Math.max(size.y, size.z)
              : Math.max(size.x, size.y)) / 2;
        box.getCenter(start);
        end.copy(start);
        const halfLength = Math.max(0, size[axis] / 2 - radius);
        start[axis] -= halfLength;
        end[axis] += halfLength;
        // Capsules fit circular shades and thin cords without hard box edges.
        const gap = Math.sqrt(ray.distanceSqToSegment(start, end, nearest));
        if (nearest.distanceTo(camera) >= distance) continue;
        obstruction = Math.max(
          obstruction,
          1 - MathUtils.smoothstep(gap, radius, radius + 0.6),
        );
      }
      coverage += obstruction;
    }
  }
  return MathUtils.lerp(1, 0.035, MathUtils.smoothstep(coverage / 15, 0, 0.2));
}
