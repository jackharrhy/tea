import { expect, test } from "vitest";
import { TABLE_HALF_WIDTH, TABLE_HALF_LENGTH } from "../src/dimensions";
import {
  CABINET_BOUNDS,
  CUSHIONS,
  RETURNS,
  POCKETS,
  RAIL_WIDTH,
  FELT_Y,
  FELT_LIP_DROP,
  RAIL_TOP_Y,
  POCKET_WELL_BOTTOM_Y,
} from "../src/physical-table";

test("every rotated collider fits within the normal rail footprint", () => {
  expect(CABINET_BOUNDS).toEqual({
    x: TABLE_HALF_WIDTH + RAIL_WIDTH,
    z: TABLE_HALF_LENGTH + RAIL_WIDTH,
  });
  for (const part of [...CUSHIONS, ...RETURNS]) {
    const [x, y, z, w] = part.rotation;
    const [hx, hy, hz] = part.size.map((v) => v / 2) as [
      number,
      number,
      number,
    ];
    const extentX =
      Math.abs(1 - 2 * (y * y + z * z)) * hx +
      Math.abs(2 * (x * y - z * w)) * hy +
      Math.abs(2 * (x * z + y * w)) * hz;
    const extentY =
      Math.abs(2 * (x * y + z * w)) * hx +
      Math.abs(1 - 2 * (x * x + z * z)) * hy +
      Math.abs(2 * (y * z - x * w)) * hz;
    const extentZ =
      Math.abs(2 * (x * z - y * w)) * hx +
      Math.abs(2 * (y * z + x * w)) * hy +
      Math.abs(1 - 2 * (x * x + y * y)) * hz;
    expect(part.center[1] + extentY).toBeLessThanOrEqual(RAIL_TOP_Y + 1e-12);
    expect(Math.abs(part.center[0]) + extentX).toBeLessThanOrEqual(
      CABINET_BOUNDS.x + 1e-12,
    );
    expect(Math.abs(part.center[2]) + extentZ).toBeLessThanOrEqual(
      CABINET_BOUNDS.z + 1e-12,
    );
  }
});

test("each well has a continuous tangent liner with a lowered entry half", () => {
  const liners = RETURNS.filter((p) => p.kind === "pocket");
  expect(liners).toHaveLength(POCKETS.length * 32);
  for (const [index, p] of POCKETS.entries()) {
    for (const part of liners.slice(index * 32, (index + 1) * 32)) {
      const dx = part.center[0] - p.x,
        dz = part.center[2] - p.z;
      expect(Math.hypot(dx, dz) - part.size[0] / 2).toBeCloseTo(p.radius, 12);
      expect(part.size[2]).toBeGreaterThan(
        2 * (p.radius + part.size[0] / 2) * Math.tan(Math.PI / 32),
      );
      const back = dx * Math.sign(p.x) + dz * Math.sign(p.z) > 0;
      expect(part.center[1] + part.size[1] / 2).toBeCloseTo(
        back ? RAIL_TOP_Y : FELT_Y - FELT_LIP_DROP,
        12,
      );
      expect(part.center[1] - part.size[1] / 2).toBeCloseTo(
        POCKET_WELL_BOTTOM_Y,
        12,
      );
    }
  }
});
