import type { Quat, RuntimeId, Vec3 } from "@harrhy/gurgur-engine";
import type { GameEngine } from "./engine-api";
import type { WorldBundle } from "./world";

export const PLAYER_GRAB_REACH = 3.25;

const MIN_DISTANCE = 1.15;
const MAX_DISTANCE = 2.25;
const WALL_CLEARANCE = 0.2;
const MAX_TRACKING_ERROR = 1.75;
const ERROR_GRACE_SECONDS = 1;
const TARGET_SPEED = 12;
const TARGET_ANGULAR_SPEED = Math.PI * 2;

export type GrabPose = {
  position: Vec3;
  yaw: number;
  lookYaw: number;
  lookPitch: number;
};

export type PropGrab = {
  target: RuntimeId;
  distance: number;
  relativeRotation: Quat;
  targetPosition: Vec3;
  targetRotation: Quat;
  errorSeconds: number;
};

export type HostManipulationTarget = {
  target: RuntimeId;
  localAnchor: Vec3;
  distance: number;
  relativeRotation: Quat;
  targetPosition: Vec3;
  targetRotation: Quat;
};

export function createPropGrab(
  engine: GameEngine,
  target: RuntimeId,
  pose: GrabPose,
  holdDistance: number,
): PropGrab {
  const body = engine.bodies.state(target);
  return {
    target,
    distance: Math.max(MIN_DISTANCE, holdDistance),
    relativeRotation: multiplyQuat(
      inverseQuat(yawRotation(pose.yaw)),
      body.rotation,
    ),
    targetPosition: { ...body.position },
    targetRotation: { ...body.rotation },
    errorSeconds: 0,
  };
}

export function stepPropGrab(
  engine: GameEngine,
  grab: PropGrab,
  pose: GrabPose,
): boolean {
  const bodyRef = engine.bodies.resolve(grab.target);
  if (!bodyRef) return false;
  const body = engine.bodies.state(grab.target);
  const desiredPosition = carryTarget(engine, pose, grab.target, grab.distance);
  const desiredRotation = multiplyQuat(
    yawRotation(pose.yaw),
    grab.relativeRotation,
  );
  grab.targetPosition = moveToward(
    grab.targetPosition,
    desiredPosition,
    TARGET_SPEED * engine.dt,
  );
  grab.targetRotation = rotateToward(
    grab.targetRotation,
    desiredRotation,
    TARGET_ANGULAR_SPEED * engine.dt,
  );
  if (
    !engine.driveBodyToTarget(grab.target, {
      targetPosition: grab.targetPosition,
      targetRotation: grab.targetRotation,
      linearGain: 10,
      maxLinearSpeed: TARGET_SPEED,
      maxLinearAcceleration: 50,
      angularGain: 8,
      maxAngularSpeed: TARGET_ANGULAR_SPEED,
      maxAngularAcceleration: Math.PI * 8,
    })
  )
    return false;

  const trackingError = distance(body.position, grab.targetPosition);
  const tooFar =
    distance(playerChest(pose.position), body.position) >
    PLAYER_GRAB_REACH + 1.75;
  grab.errorSeconds =
    trackingError > MAX_TRACKING_ERROR
      ? grab.errorSeconds + engine.dt
      : Math.max(0, grab.errorSeconds - engine.dt * 2);
  return !tooFar && grab.errorSeconds < ERROR_GRACE_SECONDS;
}

export function createHostManipulationTarget(
  engine: GameEngine,
  target: RuntimeId,
  localAnchor: Vec3,
  pose: GrabPose,
  holdDistance: number,
): HostManipulationTarget {
  const body = engine.bodies.state(target);
  return {
    target: { ...target },
    localAnchor: { ...localAnchor },
    distance: clamp(holdDistance, MIN_DISTANCE, MAX_DISTANCE),
    relativeRotation: multiplyQuat(
      inverseQuat(yawRotation(pose.yaw)),
      body.rotation,
    ),
    targetPosition: add(
      body.position,
      rotateVector(body.rotation, localAnchor),
    ),
    targetRotation: { ...body.rotation },
  };
}

export function stepHostManipulationTarget(
  engine: GameEngine,
  target: HostManipulationTarget,
  pose: GrabPose,
): void {
  const desiredPosition = carryTarget(
    engine,
    pose,
    target.target,
    target.distance,
  );
  const desiredRotation = multiplyQuat(
    yawRotation(pose.yaw),
    target.relativeRotation,
  );
  target.targetPosition = moveToward(
    target.targetPosition,
    desiredPosition,
    TARGET_SPEED * engine.dt,
  );
  target.targetRotation = rotateToward(
    target.targetRotation,
    desiredRotation,
    TARGET_ANGULAR_SPEED * engine.dt,
  );
}

export function grabDistanceFor(
  bundle: WorldBundle,
  entityIndex: number,
): number {
  const entity = bundle.entities[entityIndex];
  if (!entity?.body) return MIN_DISTANCE;
  const radius = Math.max(
    0,
    ...entity.body.brushIndices.flatMap((brushIndex) =>
      bundle.brushes[brushIndex]!.localVertices.map((vertex) =>
        Math.hypot(vertex.x, vertex.y, vertex.z),
      ),
    ),
  );
  return clamp(0.9 + radius, MIN_DISTANCE, MAX_DISTANCE);
}

export function playerChest(position: Vec3): Vec3 {
  return { x: position.x, y: position.y + 0.4, z: position.z };
}

export function playerViewDirection(lookYaw: number, lookPitch: number): Vec3 {
  const horizontal = Math.cos(lookPitch);
  return {
    x: -Math.sin(lookYaw) * horizontal,
    y: Math.sin(lookPitch),
    z: -Math.cos(lookYaw) * horizontal,
  };
}

function carryTarget(
  engine: GameEngine,
  pose: GrabPose,
  target: RuntimeId,
  holdDistance: number,
): Vec3 {
  const origin = playerChest(pose.position);
  const direction = playerViewDirection(pose.lookYaw, pose.lookPitch);
  const displacement = scale(direction, holdDistance);
  const obstruction = engine.raycast(origin, displacement, {
    ignoreBodies: [target],
  });
  const targetDistance = obstruction
    ? Math.max(
        MIN_DISTANCE * 0.5,
        holdDistance * obstruction.fraction - WALL_CLEARANCE,
      )
    : holdDistance;
  return add(origin, scale(direction, targetDistance));
}

function yawRotation(yaw: number): Quat {
  const half = yaw * 0.5;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}

function inverseQuat(rotation: Quat): Quat {
  return { x: -rotation.x, y: -rotation.y, z: -rotation.z, w: rotation.w };
}

function multiplyQuat(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function rotateVector(rotation: Quat, value: Vec3): Vec3 {
  const tx = 2 * (rotation.y * value.z - rotation.z * value.y);
  const ty = 2 * (rotation.z * value.x - rotation.x * value.z);
  const tz = 2 * (rotation.x * value.y - rotation.y * value.x);
  return {
    x: value.x + rotation.w * tx + rotation.y * tz - rotation.z * ty,
    y: value.y + rotation.w * ty + rotation.z * tx - rotation.x * tz,
    z: value.z + rotation.w * tz + rotation.x * ty - rotation.y * tx,
  };
}

function moveToward(
  current: Vec3,
  target: Vec3,
  maximumDistance: number,
): Vec3 {
  const delta = subtract(target, current);
  const length = Math.hypot(delta.x, delta.y, delta.z);
  if (length <= maximumDistance || length <= Number.EPSILON)
    return { ...target };
  return add(current, scale(delta, maximumDistance / length));
}

function rotateToward(current: Quat, target: Quat, maximumAngle: number): Quat {
  let adjusted = target;
  let dot =
    current.x * target.x +
    current.y * target.y +
    current.z * target.z +
    current.w * target.w;
  if (dot < 0) {
    dot = -dot;
    adjusted = { x: -target.x, y: -target.y, z: -target.z, w: -target.w };
  }
  const angle = 2 * Math.acos(clamp(dot, -1, 1));
  if (angle <= maximumAngle || angle <= Number.EPSILON) return { ...adjusted };
  const amount = maximumAngle / angle;
  const sinAngle = Math.sin(angle * 0.5);
  if (Math.abs(sinAngle) <= Number.EPSILON) return { ...adjusted };
  const left = Math.sin((1 - amount) * angle * 0.5) / sinAngle;
  const right = Math.sin(amount * angle * 0.5) / sinAngle;
  return {
    x: current.x * left + adjusted.x * right,
    y: current.y * left + adjusted.y * right,
    z: current.z * left + adjusted.z * right,
    w: current.w * left + adjusted.w * right,
  };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(value: Vec3, amount: number): Vec3 {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount };
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
