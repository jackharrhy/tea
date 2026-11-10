import type { Box3DModule } from "box3d.js";
import type { PhysicsDebugDraw, PhysicsDebugPrimitive, Vec3 } from "./types";

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
    // In box3d.js@0.0.2 the drawBounds callback also enables bound drawing.
    drawBounds: (
      bounds: { lowerBound: Vec3; upperBound: Vec3 },
      color: number,
    ) =>
      append({
        kind: "bounds",
        lower: { ...bounds.lowerBound },
        upper: { ...bounds.upperBound },
        color,
      }),
    drawJoints: true,
    drawContacts: true,
    drawSegment: (from: Vec3, to: Vec3, color: number) =>
      append({ kind: "segment", from: { ...from }, to: { ...to }, color }),
    drawPoint: (position: Vec3, size: number, color: number) =>
      append({ kind: "point", position: { ...position }, size, color }),
  });
  return { primitives, truncated };
}
