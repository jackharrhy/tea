import {
  createGoldSrcMovementState,
  moveGoldSrcPlayer,
  tracePlayerHull,
  type GoldSrcMovementConfig,
  type ParsedWorld,
  type Vec3Tuple,
} from "../core/index.js";
import type { WalkabilityAttempt, WalkabilityDriveResult } from "./types.js";

export interface DriveWalkabilityOptions {
  readonly movement: GoldSrcMovementConfig;
  readonly fixedDeltaSeconds: number;
  readonly maximumSeconds: number;
  readonly targetTolerance: number;
}

function horizontalDistance(left: Vec3Tuple, right: Vec3Tuple): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function groundAt(
  world: ParsedWorld,
  position: Vec3Tuple,
): { position: Vec3Tuple; floorNormal: Vec3Tuple } | null {
  const occupancy = tracePlayerHull(world, position, position);
  if (occupancy.startSolid || occupancy.allSolid) return null;
  const trace = tracePlayerHull(world, position, [
    position[0],
    position[1],
    world.bounds.min[2] - 512,
  ]);
  return !trace.startSolid &&
    !trace.allSolid &&
    trace.fraction < 1 &&
    trace.planeNormal[2] >= 0.7
    ? { position: trace.endPosition, floorNormal: trace.planeNormal }
    : null;
}

function driveWalkStep(
  world: ParsedWorld,
  start: Vec3Tuple,
  target: Vec3Tuple,
  stepSize: number,
): { reached: boolean; end: Vec3Tuple; floorNormal: Vec3Tuple } {
  const horizontalTarget: Vec3Tuple = [target[0], target[1], start[2]];
  const direct = tracePlayerHull(world, start, horizontalTarget);
  if (direct.fraction === 1) {
    const landing = groundAt(world, direct.endPosition);
    if (landing)
      return {
        reached: true,
        end: landing.position,
        floorNormal: landing.floorNormal,
      };
  }

  const up = tracePlayerHull(world, start, [
    start[0],
    start[1],
    start[2] + stepSize,
  ]);
  if (!up.startSolid && !up.allSolid && up.fraction === 1) {
    const elevatedTarget: Vec3Tuple = [target[0], target[1], up.endPosition[2]];
    const across = tracePlayerHull(world, up.endPosition, elevatedTarget);
    if (across.fraction === 1) {
      const landing = groundAt(world, across.endPosition);
      if (landing && landing.position[2] <= start[2] + stepSize + 1 / 16) {
        return {
          reached: true,
          end: landing.position,
          floorNormal: landing.floorNormal,
        };
      }
    }
  }

  const partial = groundAt(world, direct.endPosition);
  return {
    reached: false,
    end: partial?.position ?? start,
    floorNormal: partial?.floorNormal ?? [0, 0, 1],
  };
}

/**
 * Uses a velocity-free standing-hull drive for ordinary walking, matching Walk Monster's fast
 * `DriveTowardPoint` layer. Jump attempts use the real fixed-step movement controller.
 */
export function driveWalkability(
  world: ParsedWorld,
  start: Vec3Tuple,
  target: Vec3Tuple,
  attempt: WalkabilityAttempt,
  options: DriveWalkabilityOptions,
): WalkabilityDriveResult {
  if (attempt === "walk") {
    const distance = horizontalDistance(start, target);
    const steps = Math.max(1, Math.ceil(distance / 16));
    let current = start;
    let floorNormal: Vec3Tuple = [0, 0, 1];
    for (let step = 1; step <= steps; step += 1) {
      const fraction = step / steps;
      const next: Vec3Tuple = [
        start[0] + (target[0] - start[0]) * fraction,
        start[1] + (target[1] - start[1]) * fraction,
        current[2],
      ];
      const result = driveWalkStep(
        world,
        current,
        next,
        options.movement.stepSize,
      );
      current = result.end;
      floorNormal = result.floorNormal;
      if (!result.reached) {
        return {
          reached: false,
          end: current,
          floorNormal,
          horizontalDistance: horizontalDistance(start, current),
          jumped: false,
        };
      }
    }
    return {
      reached: true,
      end: current,
      floorNormal,
      horizontalDistance: horizontalDistance(start, current),
      jumped: false,
    };
  }

  const jumpRise = 48;
  const up = tracePlayerHull(world, start, [
    start[0],
    start[1],
    start[2] + jumpRise,
  ]);
  if (up.startSolid || up.allSolid || up.fraction < 1) {
    return {
      reached: false,
      end: start,
      floorNormal: [0, 0, 1],
      horizontalDistance: 0,
      jumped: false,
    };
  }
  const across = tracePlayerHull(world, up.endPosition, [
    target[0],
    target[1],
    up.endPosition[2],
  ]);
  const landing =
    across.fraction === 1 ? groundAt(world, across.endPosition) : null;
  if (!landing || landing.position[2] > start[2] + jumpRise + 1 / 16) {
    return {
      reached: false,
      end: start,
      floorNormal: [0, 0, 1],
      horizontalDistance: 0,
      jumped: false,
    };
  }

  let state = createGoldSrcMovementState(start);
  let end = start;
  let floorNormal: Vec3Tuple = [0, 0, 1];
  let jumped = false;
  const steps = Math.max(
    1,
    Math.ceil(options.maximumSeconds / options.fixedDeltaSeconds),
  );

  for (let step = 0; step < steps; step += 1) {
    const dx = target[0] - state.origin[0];
    const dy = target[1] - state.origin[1];
    const distance = Math.hypot(dx, dy);
    if (step > 0 && state.onGround && distance <= options.targetTolerance) {
      return {
        reached: true,
        end: state.origin,
        floorNormal,
        horizontalDistance: horizontalDistance(start, state.origin),
        jumped,
      };
    }
    const result = moveGoldSrcPlayer(
      world,
      state,
      {
        forward: distance > options.targetTolerance ? 1 : 0,
        side: 0,
        yaw: distance > 0.000_1 ? Math.atan2(dy, dx) : 0,
        jump: attempt === "jump" && step === 0,
      },
      options.fixedDeltaSeconds,
      options.movement,
    );
    state = result.state;
    jumped ||= result.jumped;
    if (state.onGround) {
      end = state.origin;
      if (result.groundTrace) floorNormal = result.groundTrace.planeNormal;
    }
  }

  const reached = horizontalDistance(end, target) <= options.targetTolerance;
  return {
    reached,
    end,
    floorNormal,
    horizontalDistance: horizontalDistance(start, end),
    jumped,
  };
}
