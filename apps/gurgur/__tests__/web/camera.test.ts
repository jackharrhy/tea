import { afterAll, describe, expect, test } from "bun:test";
import * as THREE from "three/webgpu";
import {
  CAMERA_BOOM_LENGTH,
  CAMERA_COLLISION_SKIN,
  cameraBoomClearance,
  createCameraBoomState,
  createCameraCollisionMesh,
  stepCameraBoom,
} from "../../web/src/camera";

const simulate = (hz: number): number => {
  let state = stepCameraBoom(createCameraBoomState(), 1, 1 / hz);
  for (let frame = 0; frame < hz; frame += 1) {
    state = stepCameraBoom(state, CAMERA_BOOM_LENGTH, 1 / hz);
  }
  return state.distance;
};

test("camera boom retracts immediately, holds briefly, and recovers without overshoot", () => {
  const retracted = stepCameraBoom(createCameraBoomState(), 1.25, 1 / 60);
  expect(retracted.distance).toBe(1.25);

  const held = stepCameraBoom(retracted, CAMERA_BOOM_LENGTH, 0.04);
  expect(held.distance).toBe(1.25);

  const recovering = stepCameraBoom(held, CAMERA_BOOM_LENGTH, 0.05);
  expect(recovering.distance).toBeGreaterThan(held.distance);
  expect(recovering.distance).toBeLessThan(CAMERA_BOOM_LENGTH);

  const blockedAgain = stepCameraBoom(recovering, 0.9, 1 / 144);
  expect(blockedAgain.distance).toBe(0.9);
});

test("camera boom recovery is stable across display rates", () => {
  expect(simulate(30)).toBeCloseTo(simulate(60), 10);
  expect(simulate(60)).toBeCloseTo(simulate(144), 10);
});

describe("camera collision probe", () => {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  afterAll(() => material.dispose());

  test("keeps its skin from either side of a thin wall", () => {
    const collisionRoot = new THREE.Group();
    const wall = createCameraCollisionMesh(
      {
        vertices: [
          { x: -1, y: -1, z: 2 },
          { x: 1, y: -1, z: 2 },
          { x: 1, y: 1, z: 2 },
          { x: -1, y: 1, z: 2 },
        ],
        triangles: [
          [0, 1, 2],
          [0, 2, 3],
        ],
      },
      material,
      "wall",
    );
    collisionRoot.add(wall);

    expect(
      cameraBoomClearance(
        collisionRoot,
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Raycaster(),
      ),
    ).toBeCloseTo(2 - CAMERA_COLLISION_SKIN);
    expect(
      cameraBoomClearance(
        collisionRoot,
        new THREE.Vector3(0, 0, 4),
        new THREE.Vector3(0, 0, -1),
        new THREE.Raycaster(),
      ),
    ).toBeCloseTo(2 - CAMERA_COLLISION_SKIN);
    wall.geometry.dispose();
  });

  test("offset rays catch a corner that the center ray misses", () => {
    const collisionRoot = new THREE.Group();
    const corner = createCameraCollisionMesh(
      {
        vertices: [
          { x: 0.12, y: -0.5, z: 2 },
          { x: 0.24, y: -0.5, z: 2 },
          { x: 0.24, y: 0.5, z: 2 },
          { x: 0.12, y: 0.5, z: 2 },
        ],
        triangles: [
          [0, 1, 2],
          [0, 2, 3],
        ],
      },
      material,
      "corner",
    );
    collisionRoot.add(corner);

    expect(
      cameraBoomClearance(
        collisionRoot,
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Raycaster(),
      ),
    ).toBeCloseTo(2 - CAMERA_COLLISION_SKIN);
    corner.geometry.dispose();
  });
});
