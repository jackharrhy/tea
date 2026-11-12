import * as THREE from "three/webgpu";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  BALL_RADIUS,
  TABLE_HALF_WIDTH as W,
  TABLE_HALF_LENGTH as L,
  createRack,
} from "@harrhy/pool";
import {
  FELT_Y,
  FELT_GEOMETRY,
  CUSHIONS,
  RETURNS,
  POCKETS,
  RAIL_WIDTH,
  RAIL_TOP_Y,
  CUSHION_DEPTH,
  FELT_LIP_DROP,
  RETURN_TRAY,
  CABINET_BOUNDS,
  POCKET_WELL_BOTTOM_Y,
} from "@harrhy/pool/table";
import { canvasTexture } from "./textures";
import { pendantRig } from "./lighting";
export { FELT_Y };
export const BALL_Y = FELT_Y + BALL_RADIUS;
const RAIL_Y = FELT_Y - 0.025;
const CABINET_CORNER = 0.09;
// The wood cap sits above the cloth-covered pocket jaws rather than sharing their top plane.
const WOOD_CAP_Y = RAIL_TOP_Y + 0.0025;
const surface = (color: number, roughness = 0.75, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });
function box(
  parent: THREE.Object3D,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    material,
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function outerOutline(inset = 0) {
  const shape = new THREE.Shape();
  const outerW = W + RAIL_WIDTH - inset,
    outerL = L + RAIL_WIDTH - inset,
    corner = CABINET_CORNER - inset;
  shape.moveTo(-outerW + corner, -outerL);
  shape.lineTo(outerW - corner, -outerL);
  shape.quadraticCurveTo(outerW, -outerL, outerW, -outerL + corner);
  shape.lineTo(outerW, outerL - corner);
  shape.quadraticCurveTo(outerW, outerL, outerW - corner, outerL);
  shape.lineTo(-outerW + corner, outerL);
  shape.quadraticCurveTo(-outerW, outerL, -outerW, outerL - corner);
  shape.lineTo(-outerW, -outerL + corner);
  shape.quadraticCurveTo(-outerW, -outerL, -outerW + corner, -outerL);
  shape.closePath();
  return shape;
}
function railOutline() {
  const shape = outerOutline();
  const hole = new THREE.Path();
  const corner = POCKETS.find((p) => p.x > 0 && p.z > 0)!;
  const side = POCKETS.find((p) => p.x > 0 && p.z === 0)!;
  const c = corner.radius + 0.006,
    r = side.radius + 0.006;
  // Recess wood behind the cushions so no visible faces share a plane.
  const inset = CUSHION_DEPTH + 0.003;
  const cornerInset = W + inset - corner.x;
  const cornerAngle = Math.asin(cornerInset / c);
  const cornerOffset = Math.sqrt(c * c - cornerInset * cornerInset);
  const sideInset = W + inset - side.x;
  const sideAngle = Math.acos(sideInset / r);
  const sideOffset = Math.sqrt(r * r - sideInset * sideInset);
  hole.moveTo(-corner.x + cornerOffset, -L - inset);
  hole.lineTo(corner.x - cornerOffset, -L - inset);
  hole.absarc(
    corner.x,
    -corner.z,
    c,
    Math.PI + cornerAngle,
    Math.PI * 2.5 - cornerAngle,
    false,
  );
  hole.lineTo(W + inset, -sideOffset);
  hole.absarc(side.x, 0, r, -sideAngle, sideAngle, false);
  hole.lineTo(W + inset, corner.z - cornerOffset);
  hole.absarc(
    corner.x,
    corner.z,
    c,
    cornerAngle - Math.PI / 2,
    Math.PI - cornerAngle,
    false,
  );
  hole.lineTo(-corner.x + cornerOffset, L + inset);
  hole.absarc(
    -corner.x,
    corner.z,
    c,
    cornerAngle,
    Math.PI * 1.5 - cornerAngle,
    false,
  );
  hole.lineTo(-W - inset, sideOffset);
  hole.absarc(-side.x, 0, r, Math.PI - sideAngle, Math.PI + sideAngle, false);
  hole.lineTo(-W - inset, -corner.z + cornerOffset);
  hole.absarc(
    -corner.x,
    -corner.z,
    c,
    Math.PI / 2 + cornerAngle,
    Math.PI * 2 - cornerAngle,
    false,
  );
  hole.closePath();
  shape.holes.push(hole);
  return shape;
}

function addCabinet(group: THREE.Group, wood: THREE.Material) {
  const inset = 0.004;
  const thickness = 0.014;
  const halfWidth = CABINET_BOUNDS.x - inset;
  const halfLength = CABINET_BOUNDS.z - inset;
  const corner = CABINET_CORNER - inset;
  const bottom = 0.3;
  const top = RAIL_Y;
  const cabinet = new THREE.Group();
  cabinet.name = "cabinet";
  group.add(cabinet);

  // Leave the +X straight side for the pierced collection panel.
  const perimeter = (offset: number) => {
    const w = halfWidth - offset;
    const l = halfLength - offset;
    const r = corner - offset;
    const path = new THREE.Path();
    path.moveTo(w, l - r);
    path.quadraticCurveTo(w, l, w - r, l);
    path.lineTo(-w + r, l);
    path.quadraticCurveTo(-w, l, -w, l - r);
    path.lineTo(-w, -l + r);
    path.quadraticCurveTo(-w, -l, -w + r, -l);
    path.lineTo(w - r, -l);
    path.quadraticCurveTo(w, -l, w, -l + r);
    return path.getPoints(16);
  };
  const shell = new THREE.Shape([
    ...perimeter(0),
    ...perimeter(thickness).toReversed(),
  ]);
  shell.closePath();
  const walls = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shell, {
      depth: top - bottom,
      bevelEnabled: false,
    }),
    wood,
  );
  walls.name = "cabinet-shell";
  walls.rotation.x = -Math.PI / 2;
  walls.position.y = bottom;
  cabinet.add(walls);

  const face = new THREE.Shape();
  const panelHalfLength = halfLength - corner;
  face.moveTo(-panelHalfLength, bottom);
  face.lineTo(panelHalfLength, bottom);
  face.lineTo(panelHalfLength, top);
  face.lineTo(-panelHalfLength, top);
  face.closePath();
  const slot = new THREE.Path();
  const w = RETURN_TRAY.length / 2,
    r = 0.035;
  const low = RETURN_TRAY.floorY;
  const high = low + 0.15;
  slot.moveTo(-w + r, low);
  slot.lineTo(w - r, low);
  slot.absarc(w - r, low + r, r, -Math.PI / 2, 0);
  slot.lineTo(w, high - r);
  slot.absarc(w - r, high - r, r, 0, Math.PI / 2);
  slot.lineTo(-w + r, high);
  slot.absarc(-w + r, high - r, r, Math.PI / 2, Math.PI);
  slot.lineTo(-w, low + r);
  slot.absarc(-w + r, low + r, r, Math.PI, Math.PI * 1.5);
  slot.closePath();
  face.holes.push(slot);
  const panel = new THREE.Mesh(
    new THREE.ExtrudeGeometry(face, {
      depth: thickness,
      bevelEnabled: false,
      curveSegments: 16,
    }),
    wood,
  );
  panel.name = "ball-return-slot";
  panel.rotation.y = Math.PI / 2;
  panel.position.set(halfWidth - thickness, 0, RETURN_TRAY.z);
  cabinet.add(panel);

  const floor = new THREE.Mesh(
    new THREE.ExtrudeGeometry(outerOutline(inset), {
      depth: thickness,
      bevelEnabled: false,
      curveSegments: 16,
    }),
    wood,
  );
  floor.name = "cabinet-bottom";
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = bottom;
  cabinet.add(floor);

  // Keep grain at the same physical scale across boards and the slot reveal.
  for (const child of cabinet.children) {
    const mesh = child as THREE.Mesh;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.updateMatrix();
    const positions = mesh.geometry.getAttribute("position");
    const normals = mesh.geometry.getAttribute("normal");
    const uv = mesh.geometry.getAttribute("uv");
    const point = new THREE.Vector3();
    const normal = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrix);
      normal.fromBufferAttribute(normals, i).transformDirection(mesh.matrix);
      const u = Math.abs(normal.x) > 0.5 ? point.z : point.x;
      const v = Math.abs(normal.y) > 0.5 ? point.z : point.y;
      // Walnut runs along texture V, so follow each board horizontally.
      uv.setXY(i, v / 0.6, u / 0.6);
    }
  }
  const collectionLight = new THREE.PointLight(0xffcc8a, 0.08, 0.4, 2);
  collectionLight.name = "collection-light";
  collectionLight.position.set(halfWidth - 0.09, high - 0.025, RETURN_TRAY.z);
  cabinet.add(collectionLight);
}

function feltMaterial() {
  const weave = canvasTexture(256, 256, (ctx) => {
    const pixels = ctx.createImageData(256, 256);
    let seed = 17;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const value =
        220 + (seed >>> 29) + ((i / 4 + Math.floor(i / 1024)) % 2) * 4;
      pixels.data.set([value, value, value, 255], i);
    }
    ctx.putImageData(pixels, 0, 0);
  });
  weave.colorSpace = THREE.NoColorSpace;
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
  weave.repeat.set(6, 12);
  weave.anisotropy = 8;
  return new THREE.MeshStandardMaterial({
    color: 0x175534,
    map: weave,
    roughness: 1,
    bumpMap: weave,
    bumpScale: 0.00015,
  });
}

export function createTable(ballMaterials: THREE.MeshStandardMaterial[]) {
  const group = new THREE.Group();
  const graphics = new THREE.Group();
  graphics.name = "table-graphics";
  group.add(graphics);
  const tabletop = new THREE.Group();
  tabletop.name = "tabletop-lid";
  graphics.add(tabletop);
  const grain = new THREE.TextureLoader().load("/textures/walnut.webp");
  grain.colorSpace = THREE.SRGBColorSpace;
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.anisotropy = 8;
  const wood = new THREE.MeshStandardMaterial({
    color: 0xd1ad88,
    map: grain,
    roughness: 0.62,
    // A small texture-backed fill keeps walnut readable beneath the rails.
    emissive: 0xd1ad88,
    emissiveMap: grain,
    emissiveIntensity: 0.1,
  });
  const railWood = new THREE.MeshStandardMaterial({
    color: 0xe0ba8e,
    map: grain,
    roughness: 0.52,
  });
  const clothMaterial = feltMaterial(),
    brass = surface(0xb29353, 0.32, 0.75);
  addCabinet(graphics, wood);
  const felt = new THREE.BufferGeometry();
  felt.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(FELT_GEOMETRY.positions, 3),
  );
  felt.setIndex(FELT_GEOMETRY.indices);
  felt.computeVertexNormals();
  const uv = [];
  for (let i = 0; i < FELT_GEOMETRY.positions.length; i += 3)
    uv.push(
      (FELT_GEOMETRY.positions[i]! + W) / (2 * W),
      (FELT_GEOMETRY.positions[i + 2]! + L) / (2 * L),
    );
  felt.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  const cloth = new THREE.Mesh(felt, clothMaterial);
  cloth.name = "felt";
  cloth.receiveShadow = true;
  tabletop.add(cloth);
  for (const part of CUSHIONS) {
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(...part.size, 1, 0.004),
      clothMaterial,
    );
    mesh.name = "cushion";
    mesh.position.fromArray(part.center);
    mesh.quaternion.fromArray(part.rotation);
    mesh.castShadow = mesh.receiveShadow = true;
    tabletop.add(mesh);
  }
  const returnParts = RETURNS.filter(
    (part) =>
      part.kind !== "pocket" &&
      !("name" in part && part.name === "collector-window"),
  ).map((part) => {
    const geometry = new THREE.BoxGeometry(...part.size);
    geometry.applyQuaternion(new THREE.Quaternion().fromArray(part.rotation));
    geometry.translate(...part.center);
    return geometry;
  });
  const returnGeometry = mergeGeometries(returnParts);
  for (const geometry of returnParts) geometry.dispose();
  const returnSystem = new THREE.Group();
  returnSystem.name = "return-system";
  graphics.add(returnSystem);
  for (const part of RETURNS) {
    if (!("name" in part) || part.name !== "collector-window") continue;
    const pane = box(
      returnSystem,
      ...part.size,
      ...part.center,
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.06,
        roughness: 0.25,
        depthWrite: false,
      }),
    );
    pane.name = "collector-window";
    pane.quaternion.fromArray(part.rotation);
    pane.castShadow = false;
  }
  if (returnGeometry) {
    const gutters = new THREE.Mesh(returnGeometry, surface(0x111310, 0.95));
    gutters.name = "ball-return";
    gutters.castShadow = gutters.receiveShadow = true;
    returnSystem.add(gutters);
  }
  const railBevel = 0.006;
  const railGeometry = new THREE.ExtrudeGeometry(railOutline(), {
    depth: WOOD_CAP_Y - RAIL_Y - 2 * railBevel,
    bevelEnabled: true,
    bevelThickness: railBevel,
    bevelSize: railBevel,
    // Cut back the cap: the bevel never narrows a pocket or expands the footprint.
    bevelOffset: -railBevel,
    bevelSegments: 4,
    curveSegments: 24,
  });
  const railPositions = railGeometry.getAttribute("position");
  const railUv = railGeometry.getAttribute("uv");
  // Extrusion triangles are unindexed; keep each triangle on one board's grain.
  for (let i = 0; i < railPositions.count; i += 3) {
    const x =
      (railPositions.getX(i) +
        railPositions.getX(i + 1) +
        railPositions.getX(i + 2)) /
      3;
    const z =
      (railPositions.getY(i) +
        railPositions.getY(i + 1) +
        railPositions.getY(i + 2)) /
      3;
    const endRail = Math.abs(z) - L > Math.abs(x) - W;
    for (let j = i; j < i + 3; j++) {
      const across = endRail ? railPositions.getY(j) : railPositions.getX(j);
      const along = endRail ? railPositions.getX(j) : railPositions.getY(j);
      railUv.setXY(j, (across + railPositions.getZ(j)) / 0.6, along / 0.6);
    }
  }
  const rail = new THREE.Mesh(railGeometry, railWood);
  rail.name = "rail";
  rail.rotation.x = -Math.PI / 2;
  rail.position.y = RAIL_Y + railBevel;
  rail.castShadow = rail.receiveShadow = true;
  tabletop.add(rail);
  const leather = new THREE.MeshStandardMaterial({
    color: 0x0b0c0b,
    roughness: 0.92,
    side: THREE.DoubleSide,
  });
  for (const { x, z, radius } of POCKETS) {
    const well = new THREE.Group();
    well.name = "pocket";
    well.position.set(x, 0, z);
    graphics.add(well);
    const outward = Math.atan2(Math.sign(z), Math.sign(x));
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const inner = radius + 0.0005;
    // The native tangent faces have this apothem; half a millimetre clears their corners.
    for (let half = 0; half < 2; half++) {
      const top = half === 0 ? WOOD_CAP_Y + 0.0008 : FELT_Y - FELT_LIP_DROP;
      const outer = radius + (half === 0 ? 0.012 : 0.0055);
      const start = outward - Math.PI / 2 + half * Math.PI;
      for (let i = 0; i < 32; i++) {
        const a = start + (i * Math.PI) / 32;
        const b = start + ((i + 1) * Math.PI) / 32;
        const base = positions.length / 3;
        for (const angle of [a, b]) {
          const nx = Math.cos(angle),
            nz = Math.sin(angle);
          positions.push(
            inner * nx,
            POCKET_WELL_BOTTOM_Y,
            inner * nz,
            inner * nx,
            top,
            inner * nz,
            inner * nx,
            top,
            inner * nz,
            outer * nx,
            top,
            outer * nz,
          );
          normals.push(-nx, 0, -nz, -nx, 0, -nz, 0, 1, 0, 0, 1, 0);
        }
        indices.push(
          base,
          base + 1,
          base + 4,
          base + 1,
          base + 5,
          base + 4,
          base + 2,
          base + 3,
          base + 6,
          base + 3,
          base + 7,
          base + 6,
        );
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(normals, 3),
    );
    geometry.setIndex(indices);
    const liner = new THREE.Mesh(geometry, leather);
    liner.name = "pocket-liner";
    liner.receiveShadow = true;
    well.add(liner);
  }
  const legX = W - 0.14,
    legZ = L - 0.2;
  for (const x of [-legX, legX])
    for (const z of [-legZ, legZ]) {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.065, 0.09, 0.48, 8),
        wood,
      );
      leg.position.set(x, 0.26, z);
      leg.castShadow = leg.receiveShadow = true;
      graphics.add(leg);
      const foot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.095, 0.095, 0.025, 12),
        surface(0x302b23, 0.96),
      );
      foot.position.set(x, 0.0125, z);
      graphics.add(foot);
    }
  for (const side of [-1, 1]) {
    box(graphics, 0.06, 0.09, 2 * legZ, side * legX, 0.24, 0, wood);
    const sight = (x: number, z: number) => {
      const marker = new THREE.Mesh(new THREE.CircleGeometry(0.006, 12), brass);
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(x, WOOD_CAP_Y + 0.0008, z);
      tabletop.add(marker);
    };
    for (const i of [-3, -2, -1, 1, 2, 3])
      sight(side * (W + 0.0936625), (i * L) / 4);
    for (const i of [-1, 0, 1]) sight((i * W) / 2, side * (L + 0.0936625));
  }
  const rack = createRack();
  const balls = rack.map((ball) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 24, 16),
      ballMaterials[ball.id],
    );
    mesh.position.set(ball.x, BALL_Y, ball.z);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  });
  const { rig, lights, light, fixtures } = pendantRig();
  group.add(rig, lights);
  const setCutaway = (enabled: boolean) => {
    tabletop.position.y = enabled ? 1 : 0;
    const cabinet = graphics.getObjectByName("cabinet")!;
    cabinet.getObjectByName("cabinet-shell")!.visible = !enabled;
    cabinet.getObjectByName("ball-return-slot")!.visible = !enabled;
  };
  return {
    group,
    graphics,
    tabletop,
    balls,
    rig,
    light,
    fixtures,
    setCutaway,
  };
}
