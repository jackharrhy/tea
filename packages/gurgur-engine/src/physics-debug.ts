import type { Box3DModule, b3AABB, b3Vec3 } from "box3d.js";
import type { PhysicsDebugDraw, PhysicsDebugPrimitive, Vec3 } from "./types";

function fromB3Vec(value: b3Vec3): Vec3 {
  return { x: value[0], y: value[1], z: value[2] };
}

export function drawPhysicsDebug(
  box3d: Box3DModule,
  world: ReturnType<Box3DModule["b3CreateWorld"]>,
  maxPrimitives: number,
): PhysicsDebugDraw {
  const limit = Math.max(0, Math.floor(maxPrimitives));
  const primitives: PhysicsDebugPrimitive[] = [];
  let truncated = false;
  const append = (primitive: PhysicsDebugPrimitive): void => {
    if (primitives.length < limit) primitives.push(primitive);
    else truncated = true;
  };
  box3d.b3World_Draw(world, {
    drawBounds: (bounds: b3AABB, color: number) =>
      append({
        kind: "bounds",
        lower: { x: bounds[0], y: bounds[1], z: bounds[2] },
        upper: { x: bounds[3], y: bounds[4], z: bounds[5] },
        color,
      }),
    drawJoints: true,
    drawContacts: true,
    drawSegment: (from: b3Vec3, to: b3Vec3, color: number) =>
      append({
        kind: "segment",
        from: fromB3Vec(from),
        to: fromB3Vec(to),
        color,
      }),
    drawPoint: (position: b3Vec3, size: number, color: number) =>
      append({ kind: "point", position: fromB3Vec(position), size, color }),
  });
  return { primitives, truncated };
}
