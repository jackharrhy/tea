import { WALK_SPEED, type Point } from "@harrhy/pool-simulation";
import { INPUT_DT } from "@harrhy/pool-protocol";

export function walkDirection(
  from: Point,
  to: Point,
  arrival: "intermediate" | "final" = "final",
): Point {
  const dx = to.x - from.x,
    dz = to.z - from.z;
  const arrivalTime = arrival === "final" ? 0.05 : INPUT_DT;
  const divisor = Math.max(Math.hypot(dx, dz), WALK_SPEED * arrivalTime);
  return { x: dx / divisor, z: dz / divisor };
}
