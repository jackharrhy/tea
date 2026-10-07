import { tracePlayerHull, type PlayerHullTraceResult } from "./collision.js";
import { cameraRight } from "./camera.js";
import type { ParsedWorld, Vec3Tuple } from "./types.js";

type MutableVec3 = [number, number, number];

export interface GoldSrcMovementConfig {
  readonly gravity: number;
  readonly stopSpeed: number;
  readonly maxSpeed: number;
  readonly accelerate: number;
  readonly airAccelerate: number;
  readonly friction: number;
  readonly edgeFriction: number;
  readonly stepSize: number;
}

export const DEFAULT_GOLDSRC_MOVEMENT: GoldSrcMovementConfig = {
  gravity: 800,
  stopSpeed: 100,
  maxSpeed: 320,
  accelerate: 10,
  airAccelerate: 10,
  friction: 4,
  edgeFriction: 2,
  stepSize: 18,
};

export interface GoldSrcMovementState {
  readonly origin: Vec3Tuple;
  readonly velocity: Vec3Tuple;
  readonly onGround: boolean;
  readonly jumpHeld: boolean;
}

export interface GoldSrcMovementInput {
  /** Normalized forward command in the range -1 through 1. */
  readonly forward: number;
  /** Normalized right command in the range -1 through 1. */
  readonly side: number;
  readonly yaw: number;
  readonly jump: boolean;
  /** Scales the configured maximum speed; useful for a held walk key. */
  readonly speedScale?: number;
}

export interface GoldSrcMovementResult {
  readonly state: GoldSrcMovementState;
  readonly horizontalDistance: number;
  readonly jumped: boolean;
  readonly landed: boolean;
  readonly landingSpeed: number;
  readonly groundTrace: PlayerHullTraceResult | null;
}

interface MutableState {
  origin: MutableVec3;
  velocity: MutableVec3;
  onGround: boolean;
  jumpHeld: boolean;
}

function mutable(value: Vec3Tuple): MutableVec3 {
  return [value[0], value[1], value[2]];
}

function length2d(value: Vec3Tuple): number {
  return Math.hypot(value[0], value[1]);
}

function dot(left: Vec3Tuple, right: Vec3Tuple): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vec3Tuple, right: Vec3Tuple): MutableVec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function clipVelocity(velocity: Vec3Tuple, normal: Vec3Tuple): MutableVec3 {
  const backoff = dot(velocity, normal);
  const result: MutableVec3 = [
    velocity[0] - normal[0] * backoff,
    velocity[1] - normal[1] * backoff,
    velocity[2] - normal[2] * backoff,
  ];
  for (let index = 0; index < 3; index += 1) {
    // Stop components below 0.1 units. Keeping those residuals makes the player
    // visibly skate along corners.
    if (Math.abs(result[index]!) < 0.1) result[index] = 0;
  }
  return result;
}

function accelerate(
  state: MutableState,
  wishDirection: Vec3Tuple,
  wishSpeed: number,
  acceleration: number,
  deltaSeconds: number,
): void {
  const additionalSpeed = wishSpeed - dot(state.velocity, wishDirection);
  if (additionalSpeed <= 0) return;
  const accelerationSpeed = Math.min(
    additionalSpeed,
    acceleration * deltaSeconds * wishSpeed,
  );
  state.velocity[0] += accelerationSpeed * wishDirection[0];
  state.velocity[1] += accelerationSpeed * wishDirection[1];
  state.velocity[2] += accelerationSpeed * wishDirection[2];
}

function wishVelocity(
  input: GoldSrcMovementInput,
  maximumSpeed: number,
): { direction: Vec3Tuple; speed: number } {
  const forwardAmount = Math.min(1, Math.max(-1, input.forward));
  const sideAmount = Math.min(1, Math.max(-1, input.side));
  const forward = [Math.cos(input.yaw), Math.sin(input.yaw), 0] as const;
  const right = cameraRight(input.yaw);
  let x = forward[0] * forwardAmount + right[0] * sideAmount;
  let y = forward[1] * forwardAmount + right[1] * sideAmount;
  const magnitude = Math.hypot(x, y);
  if (magnitude === 0) return { direction: [0, 0, 0], speed: 0 };
  const commandScale = Math.min(1, magnitude);
  x /= magnitude;
  y /= magnitude;
  return { direction: [x, y, 0], speed: maximumSpeed * commandScale };
}

function flyMove(
  world: ParsedWorld,
  state: MutableState,
  deltaSeconds: number,
): void {
  let timeLeft = deltaSeconds;
  let originalVelocity = mutable(state.velocity);
  const primalVelocity = mutable(state.velocity);
  const planes: Vec3Tuple[] = [];
  let movedFraction = 0;

  for (let bump = 0; bump < 4; bump += 1) {
    if (
      state.velocity[0] === 0 &&
      state.velocity[1] === 0 &&
      state.velocity[2] === 0
    )
      break;
    const end: Vec3Tuple = [
      state.origin[0] + state.velocity[0] * timeLeft,
      state.origin[1] + state.velocity[1] * timeLeft,
      state.origin[2] + state.velocity[2] * timeLeft,
    ];
    const trace = tracePlayerHull(world, state.origin, end);
    if (trace.allSolid) {
      state.velocity = [0, 0, 0];
      return;
    }
    if (trace.fraction > 0) {
      state.origin = mutable(trace.endPosition);
      originalVelocity = mutable(state.velocity);
      planes.length = 0;
      movedFraction += trace.fraction;
    }
    if (trace.fraction >= 1) break;

    timeLeft -= timeLeft * trace.fraction;
    if (planes.length >= 5) {
      state.velocity = [0, 0, 0];
      break;
    }
    planes.push(trace.planeNormal);

    let clipped: MutableVec3 | undefined;
    for (let planeIndex = 0; planeIndex < planes.length; planeIndex += 1) {
      const candidate = clipVelocity(originalVelocity, planes[planeIndex]!);
      if (
        planes.every(
          (plane, index) => index === planeIndex || dot(candidate, plane) >= 0,
        )
      ) {
        clipped = candidate;
        break;
      }
    }
    if (!clipped) {
      if (planes.length !== 2) {
        state.velocity = [0, 0, 0];
        break;
      }
      const crease = cross(planes[0]!, planes[1]!);
      const alongCrease = dot(crease, state.velocity);
      clipped = [
        crease[0] * alongCrease,
        crease[1] * alongCrease,
        crease[2] * alongCrease,
      ];
    }
    state.velocity = clipped;
    if (dot(state.velocity, primalVelocity) <= 0) {
      state.velocity = [0, 0, 0];
      break;
    }
  }
  if (movedFraction === 0) state.velocity = [0, 0, 0];
}

function applyFriction(
  world: ParsedWorld,
  state: MutableState,
  config: GoldSrcMovementConfig,
  deltaSeconds: number,
): void {
  const speed = length2d(state.velocity);
  if (speed < 0.1) return;
  const ahead: Vec3Tuple = [
    state.origin[0] + (state.velocity[0] / speed) * 16,
    state.origin[1] + (state.velocity[1] / speed) * 16,
    state.origin[2],
  ];
  const below: Vec3Tuple = [ahead[0], ahead[1], ahead[2] - 36];
  const edge = tracePlayerHull(world, ahead, below).fraction === 1;
  const friction = config.friction * (edge ? config.edgeFriction : 1);
  const control = Math.max(speed, config.stopSpeed);
  const newSpeed = Math.max(0, speed - control * friction * deltaSeconds);
  const scale = newSpeed / speed;
  state.velocity[0] *= scale;
  state.velocity[1] *= scale;
}

function walkMove(
  world: ParsedWorld,
  state: MutableState,
  wishDirection: Vec3Tuple,
  wishSpeed: number,
  config: GoldSrcMovementConfig,
  deltaSeconds: number,
): void {
  state.velocity[2] = 0;
  accelerate(state, wishDirection, wishSpeed, config.accelerate, deltaSeconds);
  state.velocity[2] = 0;
  if (length2d(state.velocity) < 1) {
    state.velocity = [0, 0, 0];
    return;
  }

  const directEnd: Vec3Tuple = [
    state.origin[0] + state.velocity[0] * deltaSeconds,
    state.origin[1] + state.velocity[1] * deltaSeconds,
    state.origin[2],
  ];
  const directTrace = tracePlayerHull(world, state.origin, directEnd);
  if (directTrace.fraction === 1) {
    state.origin = mutable(directTrace.endPosition);
    return;
  }

  const originalOrigin = mutable(state.origin);
  const originalVelocity = mutable(state.velocity);
  flyMove(world, state, deltaSeconds);
  const downOrigin = mutable(state.origin);
  const downVelocity = mutable(state.velocity);

  state.origin = mutable(originalOrigin);
  state.velocity = mutable(originalVelocity);
  const upEnd: Vec3Tuple = [
    state.origin[0],
    state.origin[1],
    state.origin[2] + config.stepSize,
  ];
  const upTrace = tracePlayerHull(world, state.origin, upEnd);
  if (!upTrace.startSolid && !upTrace.allSolid)
    state.origin = mutable(upTrace.endPosition);
  flyMove(world, state, deltaSeconds);
  const stepDown: Vec3Tuple = [
    state.origin[0],
    state.origin[1],
    state.origin[2] - config.stepSize,
  ];
  const stepTrace = tracePlayerHull(world, state.origin, stepDown);
  if (stepTrace.planeNormal[2] < 0.7) {
    state.origin = downOrigin;
    state.velocity = downVelocity;
    return;
  }
  if (!stepTrace.startSolid && !stepTrace.allSolid)
    state.origin = mutable(stepTrace.endPosition);

  const downDistance =
    (downOrigin[0] - originalOrigin[0]) ** 2 +
    (downOrigin[1] - originalOrigin[1]) ** 2;
  const upDistance =
    (state.origin[0] - originalOrigin[0]) ** 2 +
    (state.origin[1] - originalOrigin[1]) ** 2;
  if (downDistance > upDistance) {
    state.origin = downOrigin;
    state.velocity = downVelocity;
  } else {
    state.velocity[2] = downVelocity[2];
  }
}

function airMove(
  world: ParsedWorld,
  state: MutableState,
  wishDirection: Vec3Tuple,
  wishSpeed: number,
  config: GoldSrcMovementConfig,
  deltaSeconds: number,
): void {
  const cappedWishSpeed = Math.min(30, wishSpeed);
  const additionalSpeed = cappedWishSpeed - dot(state.velocity, wishDirection);
  if (additionalSpeed > 0) {
    const accelerationSpeed = Math.min(
      additionalSpeed,
      config.airAccelerate * wishSpeed * deltaSeconds,
    );
    state.velocity[0] += accelerationSpeed * wishDirection[0];
    state.velocity[1] += accelerationSpeed * wishDirection[1];
  }
  flyMove(world, state, deltaSeconds);
}

function categorizePosition(
  world: ParsedWorld,
  state: MutableState,
): PlayerHullTraceResult | null {
  if (state.velocity[2] > 180) {
    state.onGround = false;
    return null;
  }
  const below: Vec3Tuple = [
    state.origin[0],
    state.origin[1],
    state.origin[2] - 2,
  ];
  const trace = tracePlayerHull(world, state.origin, below);
  state.onGround =
    !trace.allSolid &&
    !trace.startSolid &&
    trace.fraction < 1 &&
    trace.planeNormal[2] >= 0.7;
  if (state.onGround) state.origin = mutable(trace.endPosition);
  return state.onGround ? trace : null;
}

export function createGoldSrcMovementState(
  origin: Vec3Tuple,
): GoldSrcMovementState {
  return {
    origin: mutable(origin),
    velocity: [0, 0, 0],
    onGround: false,
    jumpHeld: false,
  };
}

/** Advances the standing player by one short, fixed simulation command. */
export function moveGoldSrcPlayer(
  world: ParsedWorld,
  previous: GoldSrcMovementState,
  input: GoldSrcMovementInput,
  deltaSeconds: number,
  config: GoldSrcMovementConfig = DEFAULT_GOLDSRC_MOVEMENT,
): GoldSrcMovementResult {
  const delta = Math.min(0.05, Math.max(0, deltaSeconds));
  const state: MutableState = {
    origin: mutable(previous.origin),
    velocity: mutable(previous.velocity),
    onGround: previous.onGround,
    jumpHeld: previous.jumpHeld,
  };
  const start = mutable(state.origin);
  categorizePosition(world, state);
  const initiallyGrounded = state.onGround;
  const fallingSpeed = Math.max(0, -state.velocity[2]);
  state.velocity[2] -= config.gravity * delta * 0.5;

  let jumped = false;
  if (input.jump && !state.jumpHeld && state.onGround) {
    const maximumBunnySpeed = config.maxSpeed * 1.7;
    const speed = Math.hypot(...state.velocity);
    if (speed > maximumBunnySpeed) {
      const scale = (maximumBunnySpeed / speed) * 0.65;
      state.velocity[0] *= scale;
      state.velocity[1] *= scale;
    }
    state.onGround = false;
    state.velocity[2] = Math.sqrt(2 * 800 * 45) - config.gravity * delta * 0.5;
    jumped = true;
  }
  state.jumpHeld = input.jump;

  const maximumSpeed = config.maxSpeed * Math.max(0.1, input.speedScale ?? 1);
  const wish = wishVelocity(input, maximumSpeed);
  if (state.onGround) {
    state.velocity[2] = 0;
    applyFriction(world, state, config, delta);
    walkMove(world, state, wish.direction, wish.speed, config, delta);
  } else {
    airMove(world, state, wish.direction, wish.speed, config, delta);
  }

  const groundTrace = categorizePosition(world, state);
  const landed = !initiallyGrounded && !jumped && state.onGround;
  state.velocity[2] -= config.gravity * delta * 0.5;
  if (state.onGround) state.velocity[2] = 0;
  const horizontalDistance = Math.hypot(
    state.origin[0] - start[0],
    state.origin[1] - start[1],
  );
  return {
    state: {
      origin: mutable(state.origin),
      velocity: mutable(state.velocity),
      onGround: state.onGround,
      jumpHeld: state.jumpHeld,
    },
    horizontalDistance,
    jumped,
    landed,
    landingSpeed: landed ? fallingSpeed : 0,
    groundTrace,
  };
}
