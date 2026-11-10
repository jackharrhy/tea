import * as THREE from "three/webgpu";
import { STOOLS, AVATAR_SCALE } from "@tea/pool-simulation/geometry";
import type { PlayerState } from "@tea/pool-protocol";
import { label, material } from "./textures";

export function createAvatar(player: PlayerState) {
  const avatar = new THREE.Group();
  avatar.scale.setScalar(AVATAR_SCALE);
  const robe = new THREE.Mesh(
    new THREE.ConeGeometry(0.34, 0.95, 9),
    material(player.color),
  );
  robe.name = "robe";
  robe.position.y = 0.52;
  robe.castShadow = robe.receiveShadow = true;
  avatar.add(robe);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 10, 8),
    material(0xd2b38d),
  );
  head.name = "head";
  head.position.set(0, 1.12, 0.025);
  head.castShadow = true;
  avatar.add(head);
  const hat = new THREE.Mesh(
    new THREE.ConeGeometry(0.23, 0.38, 9),
    material(player.color),
  );
  hat.name = "hat";
  hat.position.y = 1.39;
  hat.castShadow = true;
  avatar.add(hat);
  const brim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.26, 0.035, 12),
    material(0x362f22),
  );
  brim.name = "brim";
  brim.position.y = 1.22;
  avatar.add(brim);
  const name = label(player.name, 1.15, "#e3d3ad");
  name.name = "name";
  name.position.y = 1.9;
  avatar.add(name);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.36, 0.4, 32),
    new THREE.MeshBasicMaterial({
      color: player.color,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    }),
  );
  ring.name = "turn-ring";
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.015 / AVATAR_SCALE;
  avatar.add(ring);
  return avatar;
}

export function poseAvatar(avatar: THREE.Group, seatId: string | undefined) {
  const seat = STOOLS.find((candidateSeat) => candidateSeat.id === seatId);
  const robe = avatar.getObjectByName("robe")!;
  const scale = seat ? 0.65 : 1;
  const base = seat ? (seat.y + 0.02) / AVATAR_SCALE : 0.045;
  robe.scale.y = scale;
  robe.position.y = base + 0.475 * scale;
  const lift = base + 0.95 * scale - 0.995;
  avatar.getObjectByName("head")!.position.y = 1.12 + lift;
  avatar.getObjectByName("hat")!.position.y = 1.39 + lift;
  avatar.getObjectByName("brim")!.position.y = 1.22 + lift;
  avatar.getObjectByName("name")!.position.y = 1.9 + lift;
  if (seat) avatar.rotation.y = seat.yaw;
}

export function disposeAvatar(avatar: THREE.Group) {
  const materials = new Set<THREE.Material>();
  avatar.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      for (const mat of Array.isArray(child.material)
        ? child.material
        : [child.material])
        materials.add(mat);
    }
    if (child instanceof THREE.Sprite) {
      child.material.map?.dispose();
      materials.add(child.material);
    }
  });
  for (const mat of materials) mat.dispose();
  avatar.removeFromParent();
}
