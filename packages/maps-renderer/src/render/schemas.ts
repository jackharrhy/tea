import tgpu, { d } from "typegpu";

export const WorldVertex = d.unstruct({
  position: d.float32x3,
  diffuseUv: d.float32x2,
  lightmapUv: d.float32x2,
});

export const worldVertexLayout = tgpu.vertexLayout((count) =>
  d.disarrayOf(WorldVertex, count),
);

export const SceneUniform = d.struct({
  projectionView: d.mat4x4f,
  eyeTime: d.vec4f,
  frameOptions: d.vec4f,
  cutawayTransform: d.vec4f,
  cutawayOptions: d.vec4f,
  cutawayHeight: d.vec4f,
});

export const MaterialUniform = d.struct({
  sizes: d.vec4f,
  options: d.vec4f,
  renderColor: d.vec4f,
  lightmapScale: d.f32,
});

export const sceneLayout = tgpu
  .bindGroupLayout({
    scene: { uniform: SceneUniform },
    cutaway: { texture: d.texture2d(d.f32) },
  })
  .$idx(0);

export const materialLayout = tgpu
  .bindGroupLayout({
    material: { uniform: MaterialUniform },
    diffuse: { texture: d.texture2d(d.f32) },
    fullbright: { texture: d.texture2d(d.f32) },
    lightmap: { texture: d.texture2d(d.f32) },
    skyAlpha: { texture: d.texture2d(d.f32) },
    skybox: { texture: d.texture2dArray(d.f32) },
    textureSampler: { sampler: "filtering" },
    lightmapSampler: { sampler: "filtering" },
    skyboxSampler: { sampler: "filtering" },
  })
  .$idx(1);
