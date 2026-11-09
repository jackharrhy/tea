import {
  BALL_RADIUS,
  TABLE_HALF_LENGTH,
  TABLE_HALF_WIDTH,
  canPlaceCue,
  shotPower,
  type Ball,
  type PoolMatch,
} from "@tea/pool";

import { CUSHIONS, POCKETS } from "@tea/pool/table";

type Point = { x: number; z: number };
type Shot = { angle: number; power: number };
const DIAMETER = BALL_RADIUS * 2;

function legalTargets(balls: Ball[], match: PoolMatch, seat: 0 | 1): Ball[] {
  const group = match.groups[seat];
  const targets = balls.filter((ball) => {
    if (ball.pocketed) return false;
    if (group === "solid") return ball.id >= 1 && ball.id <= 7;
    if (group === "stripe") return ball.id >= 9 && ball.id <= 15;
    return ball.id >= 1 && ball.id <= 15 && ball.id !== 8;
  });
  return group && targets.length === 0
    ? balls.filter((ball) => ball.id === 8 && !ball.pocketed)
    : targets;
}

function obstructions(
  from: Point,
  to: Point,
  balls: Ball[],
  target: Ball,
): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lengthSquared = dx * dx + dz * dz;
  let count = 0;
  for (const ball of balls) {
    if (ball.pocketed || ball.id === 0 || ball.id === target.id) continue;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((ball.x - from.x) * dx + (ball.z - from.z) * dz) / lengthSquared,
            ),
          );
    if (
      Math.hypot(ball.x - from.x - t * dx, ball.z - from.z - t * dz) <
      DIAMETER + 0.003
    )
      count++;
  }
  return count;
}

function pocketApproachClear(ball: Point, pocket: Point): boolean {
  // Trace the ball center against cushions expanded by the ball radius.
  return CUSHIONS.every((cushion) => {
    const cosine = 1 - 2 * cushion.rotation[1] ** 2;
    const sine = 2 * cushion.rotation[1] * cushion.rotation[3];
    const local = (point: Point) => {
      const x = point.x - cushion.center[0];
      const z = point.z - cushion.center[2];
      return { x: cosine * x - sine * z, z: sine * x + cosine * z };
    };
    const from = local(ball),
      to = local(pocket);
    let enter = 0;
    let leave = 1;
    for (const [axis, index] of [
      ["x", 0],
      ["z", 2],
    ] as const) {
      const extent = cushion.size[index] / 2 + BALL_RADIUS;
      const low = -extent;
      const high = extent;
      const delta = to[axis] - from[axis];
      if (delta === 0) {
        if (from[axis] < low || from[axis] > high) return true;
      } else {
        const a = (low - from[axis]) / delta;
        const b = (high - from[axis]) / delta;
        enter = Math.max(enter, Math.min(a, b));
        leave = Math.min(leave, Math.max(a, b));
      }
    }
    return enter > leave;
  });
}

function planShot(
  cue: Point,
  balls: Ball[],
  targets: Ball[],
): Shot & { score: number } {
  let best = { angle: 0, power: 0, score: -Infinity };
  for (const target of targets) {
    const distance = Math.hypot(target.x - cue.x, target.z - cue.z);
    const fallbackScore =
      -100 - 20 * obstructions(cue, target, balls, target) - distance;
    if (fallbackScore > best.score) {
      best = {
        angle: Math.atan2(target.z - cue.z, target.x - cue.x),
        power: shotPower(3.04 + distance * 0.32),
        score: fallbackScore,
      };
    }
    for (const pocket of POCKETS) {
      const objectDistance = Math.hypot(
        pocket.x - target.x,
        pocket.z - target.z,
      );
      if (objectDistance === 0 || !pocketApproachClear(target, pocket))
        continue;
      const nx = (pocket.x - target.x) / objectDistance;
      const nz = (pocket.z - target.z) / objectDistance;
      const ghost = {
        x: target.x - DIAMETER * nx,
        z: target.z - DIAMETER * nz,
      };
      if (
        Math.abs(ghost.x) > TABLE_HALF_WIDTH - BALL_RADIUS ||
        Math.abs(ghost.z) > TABLE_HALF_LENGTH - BALL_RADIUS
      )
        continue;
      const dx = ghost.x - cue.x;
      const dz = ghost.z - cue.z;
      const cueDistance = Math.hypot(dx, dz);
      if (cueDistance < 0.001) continue;
      const cut = (dx * nx + dz * nz) / cueDistance;
      if (
        cut < 0.45 ||
        obstructions(cue, ghost, balls, target) ||
        obstructions(target, pocket, balls, target)
      )
        continue;
      const score = 10 * cut - cueDistance - 1.3 * objectDistance;
      if (score <= best.score) continue;
      // Account for sliding-to-rolling loss before and after object contact.
      const rollingTransfer = 5 / 7;
      const rollingDeceleration = 0.3;
      const arrivalSpeed = 0.18;
      const speed =
        Math.sqrt(
          2 * rollingDeceleration * cueDistance +
            (2 * rollingDeceleration * objectDistance + arrivalSpeed ** 2) /
              (0.97 * cut * rollingTransfer) ** 2,
        ) / rollingTransfer;
      best = {
        angle: Math.atan2(dz, dx),
        power: Math.max(0.05, shotPower(speed)),
        score,
      };
    }
  }
  return best;
}

export function chooseBotShot(
  balls: Ball[],
  match: PoolMatch,
  seat: 0 | 1,
): Shot {
  const cue = balls.find((ball) => ball.id === 0 && !ball.pocketed);
  if (!cue) return { angle: 0, power: 0 };
  const { angle, power } = planShot(
    cue,
    balls,
    legalTargets(balls, match, seat),
  );
  return { angle, power };
}

export function chooseBotPlacement(
  balls: Ball[],
  match: PoolMatch,
  seat: 0 | 1,
): Point {
  const targets = legalTargets(balls, match, seat);
  let best: Point | undefined;
  let bestScore = -Infinity;
  const xLimit = TABLE_HALF_WIDTH - BALL_RADIUS;
  const zLimit = TABLE_HALF_LENGTH - BALL_RADIUS;
  // Spacing exceeds two diameters: each object ball can exclude at most one point.
  for (let column = 0; column <= 8; column++) {
    for (let row = 0; row <= 16; row++) {
      const point = {
        x: ((column - 4) / 4) * xLimit,
        z: ((row - 8) / 8) * zLimit,
      };
      if (!canPlaceCue(balls, point.x, point.z)) continue;
      const score = planShot(point, balls, targets).score;
      if (!best || score > bestScore) {
        best = point;
        bestScore = score;
      }
    }
  }
  if (!best) throw new Error("No legal bot cue placement");
  return best;
}
