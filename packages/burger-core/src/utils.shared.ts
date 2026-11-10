import { ACCELERATION, FRICTION, PLAYER_SPEED } from "./const.shared";

export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * Math.min(t, 1);

export const applyInputToVelocity = (
  vx: number,
  vy: number,
  input: { up: boolean; down: boolean; left: boolean; right: boolean },
  dt: number,
): { vx: number; vy: number } => {
  let targetX = 0;
  let targetY = 0;

  if (input.left) targetX -= 1;
  if (input.right) targetX += 1;
  if (input.up) targetY -= 1;
  if (input.down) targetY += 1;

  if (targetX !== 0 && targetY !== 0) {
    const len = Math.sqrt(targetX * targetX + targetY * targetY);
    targetX /= len;
    targetY /= len;
  }

  targetX *= PLAYER_SPEED;
  targetY *= PLAYER_SPEED;

  const isMoving = targetX !== 0 || targetY !== 0;
  const blend = isMoving ? ACCELERATION : FRICTION;

  return {
    vx: lerp(vx, targetX, blend * dt),
    vy: lerp(vy, targetY, blend * dt),
  };
};

export const applyVelocityToPosition = (
  x: number,
  y: number,
  vx: number,
  vy: number,
  dt: number,
): { x: number; y: number } => {
  return {
    x: x + vx * dt,
    y: y + vy * dt,
  };
};
