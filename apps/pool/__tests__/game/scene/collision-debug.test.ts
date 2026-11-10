import { expect, test } from "bun:test";
import * as THREE from "three/webgpu";
import {
  CUSHIONS,
  RETURNS,
  FELT_Y,
  POCKETS,
  MESH_REST_OFFSET,
} from "@tea/pool/table";
import { tableCollisionView } from "../../../app/game/scene/collision-debug";

test("collision view uses the native felt height and leaves all pocket holes open", () => {
  const group = tableCollisionView();
  const felt = group.getObjectByName("collider:felt")!;
  group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(0, 2, 0),
    new THREE.Vector3(0, -1, 0),
  );
  expect(ray.intersectObject(felt, false)[0]!.point.y).toBeCloseTo(
    FELT_Y - MESH_REST_OFFSET,
    6,
  );
  for (const pocket of POCKETS) {
    ray.ray.origin.set(pocket.x, 2, pocket.z);
    expect(ray.intersectObject(felt, false)).toEqual([]);
  }
});

test("collision boxes retain the exact size and orientation supplied to physics", () => {
  const group = tableCollisionView();
  group.updateMatrixWorld(true);
  const batches = group.children.filter(
    (child) => child instanceof THREE.InstancedMesh,
  ) as THREE.InstancedMesh[];
  expect(batches.reduce((total, batch) => total + batch.count, 0)).toBe(
    CUSHIONS.length + RETURNS.length,
  );
  for (const mesh of batches)
    for (let i = 0; i < mesh.count; i++) {
      const part = mesh.userData.colliders[i] as (typeof RETURNS)[number];
      const matrix = new THREE.Matrix4();
      mesh.getMatrixAt(i, matrix);
      const top = new THREE.Vector3(0, 0.5, 0).applyMatrix4(matrix);
      const expected = new THREE.Vector3(0, part.size[1] / 2, 0)
        .applyQuaternion(new THREE.Quaternion(...part.rotation))
        .add(new THREE.Vector3(...part.center));
      expect(top.distanceTo(expected)).toBeLessThan(1e-6);
      const size = new THREE.Vector3().setFromMatrixScale(matrix);
      expect(size.distanceTo(new THREE.Vector3(...part.size))).toBeLessThan(
        1e-6,
      );
    }
});
