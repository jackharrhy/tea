import * as THREE from "three/webgpu";
import { HALL, STOOLS, BAR } from "@harrhy/pool-simulation/geometry";
import { wallMaterial } from "./lighting";
import { material } from "./textures";

function box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  textureMetres?: number,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  if (textureMetres) {
    const uv = mesh.geometry.attributes.uv;
    const faces = [
      [d, h],
      [d, h],
      [w, d],
      [w, d],
      [w, h],
      [w, h],
    ];
    for (let i = 0; i < uv.count; i++) {
      const [width, height] = faces[Math.floor(i / 4)];
      uv.setXY(
        i,
        (uv.getX(i) * width) / textureMetres,
        (uv.getY(i) * height) / textureMetres,
      );
    }
  }
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function createHall() {
  const group = new THREE.Group();
  const walls: { group: THREE.Group; x: number; z: number }[] = [];
  const loader = new THREE.TextureLoader();
  const floorMap = loader.load("/textures/hall-floor-wood.webp");
  floorMap.colorSpace = THREE.SRGBColorSpace;
  floorMap.wrapS = floorMap.wrapT = THREE.RepeatWrapping;
  floorMap.repeat.set((HALL.x * 2) / 4, (HALL.z * 2) / 4);
  floorMap.anisotropy = 8;
  box(
    group,
    HALL.x * 2,
    0.25,
    HALL.z * 2,
    0,
    -0.15,
    0,
    new THREE.MeshStandardMaterial({
      map: floorMap,
      bumpMap: floorMap,
      bumpScale: 0.004,
      roughness: 0.92,
    }),
  );
  const brickMap = loader.load("/textures/hall-brick.webp");
  const brickNormal = loader.load("/textures/hall-brick-normal.webp");
  brickMap.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [brickMap, brickNormal]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
  }
  const brickMat = wallMaterial(0xffffff, brickMap);
  brickMat.normalMap = brickNormal;
  brickMat.normalScale.set(0.35, 0.35);
  brickMat.roughness = 0.96;
  const paintedWood = loader.load("/textures/hall-green-wood.webp");
  const stainedWood = loader.load("/textures/hall-trim-wood.webp");
  for (const texture of [paintedWood, stainedWood]) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
  }
  const paint = wallMaterial(0xffffff, paintedWood),
    trim = wallMaterial(0xffffff, stainedWood),
    darkWood = wallMaterial(0xb6a18b, stainedWood);
  for (const surface of [paint, trim, darkWood]) {
    surface.bumpMap = surface.map;
    surface.bumpScale = 0.003;
  }
  for (const [x, z, rotation] of [
    [0, -HALL.z, 0],
    [0, HALL.z, Math.PI],
    [-HALL.x, 0, Math.PI / 2],
    [HALL.x, 0, -Math.PI / 2],
  ]) {
    const wall = new THREE.Group();
    wall.position.set(x, 0, z);
    wall.rotation.y = rotation;
    group.add(wall);
    walls.push({ group: wall, x, z });
    const width = x ? HALL.z * 2 : HALL.x * 2 + 0.4;
    box(wall, width, 22, 0.25, 0, 10.85, 0, brickMat, 3);
    box(wall, width, 1, 0.3, 0, 0.5, 0.2, paint, 1);
    box(wall, width, 0.12, 0.36, 0, 0.06, 0.2, darkWood, 1);
    box(wall, width, 0.07, 0.4, 0, 1.025, 0.2, darkWood, 1);
    for (let along = -width / 2 + 1; along < width / 2; along++)
      box(wall, 0.04, 0.87, 0.05, along, 0.555, 0.365, darkWood, 1);
  }
  const bar = material(0x3c3225);
  box(
    group,
    BAR.width,
    BAR.height,
    BAR.depth,
    BAR.x,
    BAR.height / 2,
    BAR.z,
    bar,
  );
  box(
    group,
    BAR.width + 0.2,
    0.1,
    BAR.depth + 0.2,
    BAR.x,
    BAR.height,
    BAR.z,
    trim,
    1,
  );
  const seats: THREE.Mesh[] = [];
  for (const seat of STOOLS) {
    const stool = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 0.12, 16),
      paint,
    );
    stool.position.set(seat.x, seat.y - 0.06, seat.z);
    stool.rotation.y = seat.yaw;
    stool.userData.seat = seat.id;
    seats.push(stool);
    group.add(stool);
    box(
      group,
      0.12,
      seat.y - 0.12,
      0.12,
      seat.x,
      (seat.y - 0.12) / 2,
      seat.z,
      darkWood,
      1,
    );
  }

  return { group, walls, seats };
}
