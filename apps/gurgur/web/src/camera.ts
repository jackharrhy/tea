import type { Vec3 } from "@harrhy/gurgur-engine";
import * as THREE from "three/webgpu";

export const CAMERA_BOOM_LENGTH = 4.2;
const CAMERA_PROBE_RADIUS = 0.18;
export const CAMERA_COLLISION_SKIN = 0.04;
const CAMERA_RECOVERY_HOLD_SECONDS = 0.08;
const CAMERA_RECOVERY_HALF_LIFE_SECONDS = 0.18;
export const CAMERA_DISCONTINUITY_DISTANCE = 1;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export type CameraBoomState = {
  distance: number;
  recoveryHoldSeconds: number;
};

type TriangleMesh = {
  vertices: readonly Vec3[];
  triangles: ReadonlyArray<readonly [number, number, number]>;
};

export function createCameraBoomState(
  distance = CAMERA_BOOM_LENGTH,
): CameraBoomState {
  return { distance, recoveryHoldSeconds: 0 };
}

export function stepCameraBoom(
  state: Readonly<CameraBoomState>,
  hardSafeDistance: number,
  deltaSeconds: number,
): CameraBoomState {
  const safeDistance = Math.max(
    0,
    Math.min(CAMERA_BOOM_LENGTH, hardSafeDistance),
  );
  // Smoothing inward would leave the camera behind collision for a rendered frame.
  if (safeDistance < state.distance) {
    return {
      distance: safeDistance,
      recoveryHoldSeconds: CAMERA_RECOVERY_HOLD_SECONDS,
    };
  }

  const elapsed = Math.max(0, Math.min(0.1, deltaSeconds));
  const recoveryElapsed = Math.max(0, elapsed - state.recoveryHoldSeconds);
  const recoveryHoldSeconds = Math.max(0, state.recoveryHoldSeconds - elapsed);
  if (recoveryElapsed === 0 || safeDistance === state.distance) {
    return { distance: state.distance, recoveryHoldSeconds };
  }

  const blend = 1 - 2 ** (-recoveryElapsed / CAMERA_RECOVERY_HALF_LIFE_SECONDS);
  return {
    distance: Math.min(
      safeDistance,
      state.distance + (safeDistance - state.distance) * blend,
    ),
    recoveryHoldSeconds,
  };
}

export function createCameraCollisionMesh(
  source: TriangleMesh,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      source.vertices.flatMap((vertex) => [vertex.x, vertex.y, vertex.z]),
      3,
    ),
  );
  geometry.setIndex(source.triangles.flatMap((triangle) => [...triangle]));
  if (source.vertices.length > 0) geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

export function cameraBoomClearance(
  collisionRoot: THREE.Object3D,
  pivot: THREE.Vector3,
  boomDirection: THREE.Vector3,
  raycaster: THREE.Raycaster,
): number {
  const direction = boomDirection.clone();
  if (direction.lengthSq() < 1e-9) return 0;
  direction.normalize();

  const right = new THREE.Vector3().crossVectors(direction, WORLD_UP);
  if (right.lengthSq() < 1e-9) right.set(1, 0, 0);
  else right.normalize();
  const up = new THREE.Vector3().crossVectors(right, direction).normalize();
  const diagonal = CAMERA_PROBE_RADIUS / Math.SQRT2;
  const offsets = [
    new THREE.Vector3(),
    right.clone().multiplyScalar(CAMERA_PROBE_RADIUS),
    right.clone().multiplyScalar(-CAMERA_PROBE_RADIUS),
    up.clone().multiplyScalar(CAMERA_PROBE_RADIUS),
    up.clone().multiplyScalar(-CAMERA_PROBE_RADIUS),
    right.clone().multiplyScalar(diagonal).addScaledVector(up, diagonal),
    right.clone().multiplyScalar(diagonal).addScaledVector(up, -diagonal),
    right.clone().multiplyScalar(-diagonal).addScaledVector(up, diagonal),
    right.clone().multiplyScalar(-diagonal).addScaledVector(up, -diagonal),
  ];
  const intersections: THREE.Intersection[] = [];
  let nearest = CAMERA_BOOM_LENGTH + CAMERA_COLLISION_SKIN;
  collisionRoot.updateMatrixWorld(true);
  raycaster.near = 0.01;
  raycaster.far = nearest;
  const rayOrigin = new THREE.Vector3();
  for (const offset of offsets) {
    intersections.length = 0;
    raycaster.set(rayOrigin.copy(pivot).add(offset), direction);
    raycaster.intersectObject(collisionRoot, true, intersections);
    const hit = intersections[0];
    if (hit) nearest = Math.min(nearest, hit.distance);
  }
  return Math.min(
    CAMERA_BOOM_LENGTH,
    Math.max(0, nearest - CAMERA_COLLISION_SKIN),
  );
}
