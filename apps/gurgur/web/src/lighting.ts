import * as THREE from "three/webgpu";
import type { LightPresentation, Vec3 } from "@tea/gurgur-engine";

export const VOLUMETRIC_LIGHT_LAYER = 10;

export type PresentationLight = {
  light: THREE.Light;
  target: THREE.Object3D | null;
  volumetric: boolean;
  volumeDensity: number;
};

function lightColor(color: LightPresentation["color"]): THREE.Color {
  return new THREE.Color().setRGB(color.r, color.g, color.b);
}

function position(object: THREE.Object3D, value: Vec3): void {
  object.position.set(value.x, value.y, value.z);
}

function configureShadow(
  light: THREE.Light & { shadow: THREE.LightShadow },
  mapSize: number,
): void {
  light.shadow.mapSize.set(mapSize, mapSize);
  // Normal bias detaches WebGPU spotlight shadows at brush corners.
  light.shadow.bias = 0;
  light.shadow.normalBias = 0;
}

export function createPresentationLight(
  presentation: LightPresentation,
  origin: Vec3,
): PresentationLight {
  if (presentation.mode === "ambient") {
    return {
      light: new THREE.AmbientLight(
        lightColor(presentation.color),
        presentation.intensity,
      ),
      target: null,
      volumetric: false,
      volumeDensity: presentation.volumeDensity,
    };
  }

  if (presentation.mode === "directional") {
    const light = new THREE.DirectionalLight(
      lightColor(presentation.color),
      presentation.intensity,
    );
    const direction = new THREE.Vector3(
      presentation.direction.x,
      presentation.direction.y,
      presentation.direction.z,
    ).normalize();
    position(light.target, origin);
    light.position
      .set(origin.x, origin.y, origin.z)
      .addScaledVector(direction, -presentation.shadowDistance);
    light.castShadow = presentation.castShadow;
    configureShadow(light, 2_048);
    light.shadow.camera.left = -presentation.shadowDistance;
    light.shadow.camera.right = presentation.shadowDistance;
    light.shadow.camera.top = presentation.shadowDistance;
    light.shadow.camera.bottom = -presentation.shadowDistance;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = presentation.shadowDistance * 3;
    light.shadow.camera.updateProjectionMatrix();
    return {
      light,
      target: light.target,
      volumetric: false,
      volumeDensity: 0,
    };
  }

  if (presentation.mode === "point") {
    const light = new THREE.PointLight(
      lightColor(presentation.color),
      presentation.intensity,
      presentation.range,
      presentation.decay,
    );
    position(light, origin);
    light.castShadow = presentation.castShadow;
    configureShadow(light, 512);
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = presentation.range;
    light.shadow.camera.updateProjectionMatrix();
    if (presentation.volumetric) light.layers.enable(VOLUMETRIC_LIGHT_LAYER);
    return {
      light,
      target: null,
      volumetric: presentation.volumetric,
      volumeDensity: 0,
    };
  }

  const light = new THREE.SpotLight(
    lightColor(presentation.color),
    presentation.intensity,
    presentation.range,
    presentation.angle,
    presentation.penumbra,
    presentation.decay,
  );
  position(light, origin);
  light.target.position.set(
    origin.x + presentation.direction.x * presentation.range,
    origin.y + presentation.direction.y * presentation.range,
    origin.z + presentation.direction.z * presentation.range,
  );
  light.castShadow = presentation.castShadow;
  configureShadow(light, 1_024);
  light.shadow.camera.near = 0.1;
  light.shadow.camera.far = presentation.range;
  light.shadow.focus = 1;
  light.shadow.camera.updateProjectionMatrix();
  if (presentation.volumetric) light.layers.enable(VOLUMETRIC_LIGHT_LAYER);
  return {
    light,
    target: light.target,
    volumetric: presentation.volumetric,
    volumeDensity: 0,
  };
}
