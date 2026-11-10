import { describe, expect, test } from "bun:test";
import * as THREE from "three/webgpu";
import type { LightPresentation } from "@tea/gurgur-engine";
import {
  createPresentationLight,
  VOLUMETRIC_LIGHT_LAYER,
} from "../../web/src/lighting";

const origin = { x: 2, y: 3, z: 4 };
const color = { r: 1, g: 0.5, b: 0.25 };

describe("typed light presentation", () => {
  test("builds ambient light and retains the authored participating-medium density", () => {
    const result = createPresentationLight(
      {
        kind: "light",
        mode: "ambient",
        color,
        intensity: 0.6,
        volumeDensity: 0.35,
      },
      origin,
    );
    expect(result.light).toBeInstanceOf(THREE.AmbientLight);
    expect(result.light.intensity).toBe(0.6);
    expect(result.volumeDensity).toBe(0.35);
    expect(result.volumetric).toBeFalse();
  });

  test("aims a directional shadow volume through its authored coverage center", () => {
    const result = createPresentationLight(
      {
        kind: "light",
        mode: "directional",
        color,
        intensity: 1,
        direction: { x: 0, y: -1, z: 0 },
        castShadow: true,
        shadowDistance: 12,
      },
      origin,
    );
    const light = result.light as THREE.DirectionalLight;
    expect(light.target.position.toArray()).toEqual([2, 3, 4]);
    expect(light.position.toArray()).toEqual([2, 15, 4]);
    expect(light.shadow.camera.left).toBe(-12);
    expect(light.shadow.camera.right).toBe(12);
    expect(light.shadow.mapSize.toArray()).toEqual([2_048, 2_048]);
    expect(light.shadow.bias).toBe(0);
    expect(light.shadow.normalBias).toBe(0);
    light.shadow.dispose();
  });

  test.each([
    {
      kind: "light",
      mode: "point",
      color,
      intensity: 60,
      range: 10,
      decay: 2,
      castShadow: true,
      volumetric: true,
    },
    {
      kind: "light",
      mode: "spot",
      color,
      intensity: 100,
      direction: { x: 0, y: -1, z: 0 },
      range: 14,
      decay: 2,
      angle: Math.PI / 6,
      penumbra: 0.4,
      castShadow: true,
      volumetric: true,
    },
  ] satisfies LightPresentation[])(
    "adds volumetric local lights to both the ordinary and volume layers",
    (presentation) => {
      const result = createPresentationLight(presentation, origin);
      expect(result.volumetric).toBeTrue();
      expect(result.light.layers.isEnabled(0)).toBeTrue();
      expect(result.light.layers.isEnabled(VOLUMETRIC_LIGHT_LAYER)).toBeTrue();
      const shadowLight = result.light as THREE.PointLight | THREE.SpotLight;
      expect(shadowLight.shadow.bias).toBe(0);
      expect(shadowLight.shadow.normalBias).toBe(0);
      shadowLight.shadow.dispose();
    },
  );
});
