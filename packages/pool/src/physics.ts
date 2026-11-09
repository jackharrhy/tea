import { BALL_RADIUS, TABLE_HALF_WIDTH, TABLE_HALF_LENGTH } from "./dimensions";
import { isOverPocket, FELT_LIP_WIDTH } from "./physical-table";
export { BALL_RADIUS, TABLE_HALF_WIDTH, TABLE_HALF_LENGTH } from "./dimensions";
const DIAMETER = BALL_RADIUS * 2;
const MAX_SHOT_SPEED = 7.5;
const SHOT_POWER_EXPONENT = 1.4;

export function shotSpeed(power: number): number {
  const p = Math.max(0, Math.min(1, power));
  // Keep the old tap/half-power range; add break speed smoothly above half draw.
  return 5 * p ** SHOT_POWER_EXPONENT + 2.5 * Math.max(0, 2 * p - 1) ** 2;
}

export function shotPower(speed: number): number {
  if (Number.isNaN(speed)) return NaN;
  if (speed <= 0) return 0;
  if (speed >= MAX_SHOT_SPEED) return 1;
  if (speed <= shotSpeed(0.5)) return (speed / 5) ** (1 / SHOT_POWER_EXPONENT);
  let low = 0.5,
    high = 1;
  for (let i = 0; i < 48; i++) {
    const middle = (low + high) / 2;
    if (shotSpeed(middle) < speed) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

export interface Ball {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  pocketed: boolean;
}

export type PoolSound = {
  kind: "cue" | "ball" | "cushion" | "pocket" | "return";
  ballId: number;
  otherBallId?: number;
  x: number;
  y: number;
  z: number;
  speed: number;
};

export type BallStage = "table" | "falling" | "return" | "stored";
export interface PhysicalBall extends Ball {
  y: number;
  vy: number;
  q: [number, number, number, number];
  w: [number, number, number];
  stage: BallStage;
  revision: number;
}

export interface ShotResult {
  firstContact: number | null;
  potted: number[];
  railAfterContact: boolean;
}

export function createShotResult(): ShotResult {
  return { firstContact: null, potted: [], railAfterContact: false };
}

function rackBall(id: number, x: number, z: number): Ball {
  return {
    id,
    x,
    z,
    vx: 0,
    vz: 0,
    pocketed: false,
  };
}

export function createRack(): Ball[] {
  const ball = rackBall;
  const balls = [ball(0, 0, -TABLE_HALF_LENGTH / 2)];
  // Eight in the middle, opposite groups at the rear corners, tiny separation.
  const ids = [1, 9, 2, 10, 8, 3, 4, 11, 5, 12, 6, 13, 7, 14, 15];
  const spacing = DIAMETER + 0.0001;
  let index = 0;
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column <= row; column++) {
      balls.push(
        ball(
          ids[index++]!,
          (column - row / 2) * spacing,
          TABLE_HALF_LENGTH / 2 + (row * spacing * Math.sqrt(3)) / 2,
        ),
      );
    }
  }
  return balls.toSorted((a, b) => a.id - b.id);
}

export function canPlaceCue(balls: Ball[], x: number, z: number): boolean {
  return (
    Number.isFinite(x) &&
    Number.isFinite(z) &&
    Math.abs(x) <= TABLE_HALF_WIDTH - BALL_RADIUS &&
    Math.abs(z) <= TABLE_HALF_LENGTH - BALL_RADIUS &&
    !isOverPocket(x, z, FELT_LIP_WIDTH) &&
    balls.some((ball) => ball.id === 0) &&
    balls.every(
      (ball) =>
        ball.id === 0 ||
        ball.pocketed ||
        Math.hypot(x - ball.x, z - ball.z) >= DIAMETER,
    )
  );
}

export function placeCue(balls: Ball[], x: number, z: number): boolean {
  if (!canPlaceCue(balls, x, z)) return false;
  Object.assign(
    balls.find((ball) => ball.id === 0)!,
    { x, z, vx: 0, vz: 0, pocketed: false },
  );
  return true;
}
