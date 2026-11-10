import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import { bayer16 } from "three/addons/tsl/math/Bayer.js";
import { RETRO_COLOR_INTERVALS } from "./retro-color";
import { VOLUMETRIC_LIGHT_LAYER } from "./lighting";

// Avoid TypeScript 7's unbounded expansion of TSL's recursive shader types.
const tsl: Record<string, any> = TSL;
const bayer2 = (x: any, y: any) => x.mul(2).add(y.mul(3)).sub(x.mul(y).mul(4));

// Exact silhouettes accumulate stencil coverage before the expanded hull draws.
// Players render afterward against the original world depth.
export const INTERACTION_OUTLINE_SCALE = 1.08;
export const INTERACTION_OUTLINE_MASK_RENDER_ORDER = 900;
export const INTERACTION_OUTLINE_RENDER_ORDER = 1_000;
export const PLAYER_RENDER_ORDER = 2_000;

function animatedTexture(textureMap: THREE.Texture, name: string) {
  const retroUv = tsl.uv();

  if (name.includes("WATER")) {
    const waveA = tsl.vec2(
      tsl.time
        .mul(0.035)
        .add(tsl.sin(retroUv.y.mul(6.283).add(tsl.time.mul(0.9))).mul(0.04)),
      tsl.time.mul(0.018),
    );
    const waveB = tsl.vec2(
      tsl.time.mul(-0.022),
      tsl.time
        .mul(0.028)
        .add(tsl.sin(retroUv.x.mul(9.425).sub(tsl.time.mul(0.65))).mul(0.035)),
    );
    const first = tsl.texture(textureMap, retroUv.mul(1.08).add(waveA)).rgb;
    const second = tsl.texture(textureMap, retroUv.mul(0.73).add(waveB)).rgb;
    return first.mul(0.66).add(second.mul(0.42));
  }

  if (name.includes("DANGER") || name.includes("CAUTION")) {
    return tsl.texture(
      textureMap,
      retroUv.add(tsl.vec2(tsl.time.mul(0.045), 0)),
    ).rgb;
  }

  if (name.includes("PLATFORM")) {
    const wobble = tsl
      .sin(tsl.time.mul(1.3).add(retroUv.y.mul(6.283)))
      .mul(0.018);
    return tsl.texture(
      textureMap,
      retroUv.add(tsl.vec2(wobble, tsl.time.mul(0.025))),
    ).rgb;
  }

  return tsl.texture(textureMap, retroUv).rgb;
}

export function createWorldNodeMaterial(
  textureMap: THREE.Texture | null,
  name: string,
  sensor: boolean,
): THREE.MeshBasicNodeMaterial | THREE.MeshLambertNodeMaterial {
  const water = name.includes("WATER");
  const material = sensor
    ? new THREE.MeshBasicNodeMaterial({
        color: 0x56e0d2,
        side: THREE.FrontSide,
        transparent: true,
        opacity: 0.16,
        wireframe: true,
      })
    : new THREE.MeshLambertNodeMaterial({
        color: 0xffffff,
        map: textureMap,
        side: THREE.FrontSide,
        transparent: water,
        opacity: 1,
        depthWrite: !water,
      });
  if (textureMap) {
    let color = animatedTexture(textureMap, name);
    if (water) {
      color = color.mul(tsl.sin(tsl.time.mul(0.7)).mul(0.06).add(1.02));
    }
    material.colorNode = tsl.vec4(color, water ? 0.76 : 1);
  }
  return material;
}

export function createRealityNodeMaterial(
  textureMap: THREE.Texture,
): THREE.MeshLambertNodeMaterial {
  return new THREE.MeshLambertNodeMaterial({
    map: textureMap,
    side: THREE.FrontSide,
    fog: false,
    toneMapped: false,
  });
}

export function createSpriteNodeMaterial(
  textureMap: THREE.Texture,
  glow: boolean,
): THREE.MeshBasicNodeMaterial | THREE.MeshLambertNodeMaterial {
  const parameters = {
    map: textureMap,
    transparent: true,
    alphaTest: 0.42,
    depthWrite: !glow,
    fog: true,
    side: THREE.DoubleSide,
    blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
  } as const;
  const material = glow
    ? new THREE.MeshBasicNodeMaterial(parameters)
    : new THREE.MeshLambertNodeMaterial(parameters);
  if (glow)
    material.colorNode = tsl.materialColor.mul(
      tsl.sin(tsl.time.mul(2.8)).mul(0.12).add(1.0),
    );
  return material;
}

export function createInteractionOutlineMaterial(
  held: boolean,
): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    stencilWrite: true,
    stencilWriteMask: 0,
    stencilFuncMask: 0xff,
    stencilRef: 0,
    stencilFunc: THREE.EqualStencilFunc,
    fog: false,
    toneMapped: false,
  });
  const base = held ? tsl.vec3(1, 0.48, 0.08) : tsl.vec3(0.12, 1, 0.72);
  const pulse = tsl
    .sin(tsl.time.mul(held ? 4.8 : 3.2))
    .mul(0.14)
    .add(0.86);
  material.colorNode = tsl.vec4(base.mul(pulse), 1);
  return material;
}

export function createInteractionOutlineMaskMaterial(): THREE.MeshBasicNodeMaterial {
  return new THREE.MeshBasicNodeMaterial({
    side: THREE.FrontSide,
    colorWrite: false,
    depthTest: false,
    depthWrite: false,
    stencilWrite: true,
    stencilWriteMask: 0xff,
    stencilFuncMask: 0xff,
    stencilRef: 0,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilZPass: THREE.IncrementStencilOp,
    fog: false,
    toneMapped: false,
  });
}

export type RetroRenderPipeline = {
  render(): void;
  resize(width: number, height: number): void;
  configureSky(color: THREE.Color): void;
  configureVolume(bounds: THREE.Box3, density: number, enabled: boolean): void;
  dispose(): void;
};

export function createRetroRenderPipeline(
  renderer: THREE.Renderer,
  scene: THREE.Scene,
  realityScene: THREE.Scene,
  camera: THREE.Camera,
): RetroRenderPipeline {
  const scenePass = tsl.pass(scene, camera, { stencilBuffer: true });
  scenePass.renderTarget.depthTexture.format = THREE.DepthStencilFormat;
  scenePass.renderTarget.depthTexture.type = THREE.UnsignedInt248Type;
  scenePass.renderTarget.texture.type = THREE.UnsignedByteType;
  scenePass.renderTarget.texture.magFilter = THREE.NearestFilter;
  scenePass.renderTarget.texture.minFilter = THREE.NearestFilter;
  const volumeDepthCamera = camera.clone();
  volumeDepthCamera.layers.set(0);
  const volumeDepthPass = tsl.pass(scene, volumeDepthCamera);
  const occlusionPass = tsl.pass(scene, camera);
  const volumeDensity = tsl.uniform(0);
  const volumeMaterial = new THREE.VolumeNodeMaterial();
  volumeMaterial.steps = 12;
  volumeMaterial.offsetNode = bayer16(tsl.screenCoordinate);
  volumeMaterial.scatteringNode = () => volumeDensity;
  volumeMaterial.depthNode = volumeDepthPass
    .getTextureNode("depth")
    .sample(tsl.screenUV);
  const volumeGeometry = new THREE.BoxGeometry(1, 1, 1);
  const volumeMesh = new THREE.Mesh(volumeGeometry, volumeMaterial);
  volumeMesh.name = "world-volumetric-medium";
  volumeMesh.receiveShadow = true;
  volumeMesh.visible = false;
  volumeMesh.layers.disableAll();
  volumeMesh.layers.enable(VOLUMETRIC_LIGHT_LAYER);
  scene.add(volumeMesh);
  const volumeLayer = new THREE.Layers();
  volumeLayer.disableAll();
  volumeLayer.enable(VOLUMETRIC_LIGHT_LAYER);
  const volumePass = tsl.pass(scene, camera, { depthBuffer: false });
  volumePass.name = "Volumetric Lighting";
  volumePass.setLayers(volumeLayer);
  const realityPass = tsl.pass(realityScene, camera);
  realityPass.renderTarget.texture.type = THREE.UnsignedByteType;
  realityPass.renderTarget.texture.magFilter = THREE.LinearFilter;
  realityPass.renderTarget.texture.minFilter = THREE.LinearFilter;

  const skyColor = tsl.uniform(new THREE.Color(0x17111f));
  const opaqueScene = tsl.mix(skyColor, scenePass.rgb, scenePass.a);
  const sceneColor = tsl.vec4(opaqueScene.add(volumePass.rgb), 1);
  const vignette = tsl
    .smoothstep(0.35, 1.05, tsl.distance(tsl.screenUV, tsl.vec2(0.5)))
    .oneMinus();
  const shaded = tsl
    .max(sceneColor.rgb, tsl.vec3(0))
    .mul(1.05)
    .mul(tsl.mix(0.76, 1, vignette))
    .clamp(0, 1);
  const retroResolution = tsl.uniform(new THREE.Vector2(480, 270));
  const ditherCell = tsl.floor(tsl.screenUV.mul(retroResolution)).mod(4);
  const bayerIndex = bayer2(ditherCell.x.mod(2), ditherCell.y.mod(2))
    .mul(4)
    .add(bayer2(ditherCell.x.div(2).floor(), ditherCell.y.div(2).floor()));
  const bayerThreshold = tsl.mix(0.5, bayerIndex.add(0.5).div(16), 0.35);
  const levels = tsl.vec3(...RETRO_COLOR_INTERVALS);
  const displayColor = tsl.sRGBTransferOETF(shaded);
  const quantizedDisplay = tsl
    .floor(displayColor.mul(levels).add(bayerThreshold))
    .div(levels);
  const retroOutput = tsl.vec4(
    tsl.sRGBTransferEOTF(quantizedDisplay),
    sceneColor.a,
  );
  const realityColor = realityPass;
  const realityVisible = realityPass
    .getLinearDepthNode()
    .lessThanEqual(occlusionPass.getLinearDepthNode().add(0.002));
  const realityAlpha = realityVisible.select(realityColor.a, 0);
  const output = tsl.mix(retroOutput, realityColor, realityAlpha);
  const pipeline = new THREE.RenderPipeline(renderer, output);

  return {
    render() {
      volumeDepthCamera.copy(camera, false);
      volumeDepthCamera.layers.set(0);
      pipeline.render();
    },
    resize(width, height) {
      const scale = Math.min(
        1,
        480 / Math.max(1, width),
        270 / Math.max(1, height),
      );
      scenePass.setResolutionScale(scale);
      volumePass.setResolutionScale(scale);
      occlusionPass.setResolutionScale(scale);
      retroResolution.value.set(
        Math.max(1, Math.round(width * scale)),
        Math.max(1, Math.round(height * scale)),
      );
    },
    configureSky(color) {
      skyColor.value.copy(color);
    },
    configureVolume(bounds, density, enabled) {
      const padded = bounds.clone().expandByScalar(4);
      const center = padded.getCenter(new THREE.Vector3());
      const size = padded.getSize(new THREE.Vector3());
      volumeMesh.position.copy(center);
      volumeMesh.scale.set(
        Math.max(1, size.x),
        Math.max(1, size.y),
        Math.max(1, size.z),
      );
      volumeDensity.value = density;
      volumeMesh.visible = enabled && density > 0 && !padded.isEmpty();
    },
    dispose() {
      scene.remove(volumeMesh);
      volumeGeometry.dispose();
      volumeMaterial.dispose();
      scenePass.dispose();
      volumeDepthPass.dispose();
      volumePass.dispose();
      occlusionPass.dispose();
      realityPass.dispose();
      pipeline.dispose();
    },
  };
}
