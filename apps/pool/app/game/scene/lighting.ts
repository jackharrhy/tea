import { TABLE_HALF_LENGTH as L } from "@tea/pool";
import { FELT_Y } from "@tea/pool/table";
import * as THREE from "three/webgpu";
import {
  float,
  positionWorld,
  screenCoordinate,
  smoothstep,
  step,
  uv,
  uniform,
} from "three/tsl";
import { bayer16 } from "three/addons/tsl/math/Bayer.js";

const createVisibility = () => uniform(1);

function fixtureMaterial(
  color: number,
  visibility: ReturnType<typeof createVisibility>,
  metalness = 0.4,
) {
  const material = new THREE.MeshStandardNodeMaterial({
    color,
    metalness,
    roughness: 0.55,
    side: THREE.DoubleSide,
  });
  material.opacityNode = step(
    bayer16(screenCoordinate.div(2)).r,
    visibility.mul(float(1).sub(smoothstep(7, 18, positionWorld.y))),
  );
  material.alphaTest = 0.5;
  return material;
}

export function wallMaterial(color: number, map: THREE.Texture | null = null) {
  const material = new THREE.MeshStandardNodeMaterial({
    color,
    map,
    roughness: 0.92,
  });
  material.opacityNode = step(
    bayer16(screenCoordinate.div(2)).r,
    float(1).sub(smoothstep(6, 16, positionWorld.y)),
  );
  material.alphaTest = 0.5;
  return material;
}

export function pendantRig() {
  const rig = new THREE.Group();
  const fixtures: {
    rig: THREE.Group;
    visibility: ReturnType<typeof createVisibility>;
  }[] = [];
  const bottom = FELT_Y + 1.65;
  for (const z of [-L / 2, L / 2]) {
    const pendant = new THREE.Group();
    const visibility = createVisibility();
    pendant.name = "pendant";
    pendant.position.set(0, bottom, z);
    rig.add(pendant);
    fixtures.push({ rig: pendant, visibility });
    const enamel = fixtureMaterial(0x28533b, visibility, 0.12);
    enamel.side = THREE.FrontSide;
    enamel.roughness = 0.38;
    const reflector = fixtureMaterial(0xe7e0cb, visibility, 0);
    reflector.side = THREE.BackSide;
    reflector.emissive.setHex(0x9b7744);
    reflector.emissiveIntensity = 0.08;
    const brass = fixtureMaterial(0xb08b51, visibility, 0.35);
    brass.roughness = 0.42;
    const socket = fixtureMaterial(0x625641, visibility, 0.25);
    const cable = fixtureMaterial(0x211d18, visibility, 0);
    const glass = fixtureMaterial(0xffedcf, visibility, 0);
    glass.emissive.setHex(0xffd19a);
    glass.emissiveIntensity = 1.2;
    glass.roughness = 0.65;
    const add = (
      name: string,
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      y = 0,
    ) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.position.y = y;
      pendant.add(mesh);
      return mesh;
    };
    const profile = [
      [0.24, 0],
      [0.24, 0.008],
      [0.232, 0.035],
      [0.21, 0.085],
      [0.172, 0.135],
      [0.122, 0.175],
      [0.072, 0.205],
      [0.035, 0.22],
      [0.029, 0.23],
    ];
    add(
      "enamel-shade",
      new THREE.LatheGeometry(
        profile.map(([r, y]) => new THREE.Vector2(r, y)),
        40,
      ),
      enamel,
    );
    add(
      "reflector",
      new THREE.LatheGeometry(
        profile.map(([r, y]) => new THREE.Vector2(r - 0.002, y + 0.002)),
        40,
      ),
      reflector,
    );
    const rim = add(
      "rolled-shade-rim",
      new THREE.TorusGeometry(0.239, 0.003, 6, 40),
      brass,
      0.003,
    );
    rim.rotation.x = Math.PI / 2;
    add(
      "shade-fitter",
      new THREE.CylinderGeometry(0.032, 0.036, 0.035, 20),
      brass,
      0.232,
    );
    add(
      "socket-mount",
      new THREE.CylinderGeometry(0.018, 0.018, 0.034, 16),
      brass,
      0.201,
    );
    add(
      "socket-shell",
      new THREE.CylinderGeometry(0.021, 0.019, 0.055, 20),
      socket,
      0.16,
    );
    add(
      "bulb-screw-base",
      new THREE.CylinderGeometry(0.0135, 0.0135, 0.024, 20),
      brass,
      0.12,
    );
    for (let i = 0; i < 5; i++) {
      const thread = add(
        "bulb-thread",
        new THREE.TorusGeometry(0.0135, 0.0012, 4, 20),
        brass,
        0.11 + i * 0.004,
      );
      thread.rotation.x = Math.PI / 2;
    }
    const bulbProfile = [
      [0, -0.012],
      [0.012, -0.008],
      [0.025, 0.005],
      [0.03, 0.024],
      [0.029, 0.044],
      [0.023, 0.064],
      [0.016, 0.079],
      [0.013, 0.094],
      [0.013, 0.108],
    ];
    add(
      "frosted-bulb",
      new THREE.LatheGeometry(
        bulbProfile.map(([r, y]) => new THREE.Vector2(r, y)),
        24,
      ),
      glass,
    );
    for (let i = 0; i < 3; i++) {
      const angle = (i * Math.PI * 2) / 3;
      const screw = add(
        "fitter-retaining-screw",
        new THREE.CylinderGeometry(0.004, 0.004, 0.014, 8),
        brass,
        0.227,
      );
      screw.position.x = Math.cos(angle) * 0.037;
      screw.position.z = Math.sin(angle) * 0.037;
      screw.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)),
      );
    }
    add(
      "suspension-neck",
      new THREE.CylinderGeometry(0.012, 0.017, 0.035, 16),
      brass,
      0.265,
    );
    add(
      "cable-gland",
      new THREE.CylinderGeometry(0.009, 0.012, 0.018, 12),
      socket,
      0.29,
    );
    const length = 24 - bottom - 0.299;
    add(
      "suspension-cable",
      new THREE.CylinderGeometry(0.004, 0.004, length, 8),
      cable,
      0.299 + length / 2,
    );
  }
  const light = new THREE.SpotLight(0xffd4a0, 19, 3.8, 1.08, 0.25, 2);
  light.position.set(0, bottom - 0.03, 0);
  light.target.position.set(0, FELT_Y, 0);
  light.castShadow = true;
  light.shadow.autoUpdate = false;
  light.shadow.needsUpdate = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.near = 0.2;
  light.shadow.camera.far = light.distance;
  light.shadow.bias = -0.00001;
  light.shadow.normalBias = 0.00075;
  light.shadow.radius = 1;
  const lights = new THREE.Group();
  lights.add(light, light.target);
  return { rig, lights, light, fixtures };
}

export function viewportVignette() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new THREE.MeshBasicNodeMaterial({
    color: 0x100c08,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const edge = smoothstep(0.42, 0.72, uv().sub(0.5).length()).mul(0.72);
  material.opacityNode = edge.mul(0.48);
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  return { scene, camera };
}
