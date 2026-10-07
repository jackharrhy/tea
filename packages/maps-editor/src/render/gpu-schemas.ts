import tgpu, { d } from "typegpu";

export const SolidVertex = d.unstruct({
  position: d.float32x3,
  color: d.float32x3,
  uv: d.float32x2,
});
export const LineSegment = d.unstruct({
  start: d.float32x3,
  startColor: d.float32x3,
  end: d.float32x3,
  endColor: d.float32x3,
});
export const solidVertexLayout = tgpu.vertexLayout((count) =>
  d.disarrayOf(SolidVertex, count),
);
export const lineSegmentLayout = tgpu.vertexLayout(
  (count) => d.disarrayOf(LineSegment, count),
  "instance",
);
export const SceneUniform = d.struct({
  projectionView: d.mat4x4f,
  viewport: d.vec4f,
  grid: d.vec4f,
  gridMinor: d.vec4f,
  gridMajor: d.vec4f,
});
export const MaterialUniform = d.struct({ settings: d.vec4f });
export const editorSceneLayout = tgpu
  .bindGroupLayout({ scene: { uniform: SceneUniform } })
  .$idx(0);
export const editorMaterialLayout = tgpu
  .bindGroupLayout({
    materialSampler: { sampler: "filtering" },
    materialTexture: { texture: d.texture2d(d.f32) },
    material: { uniform: MaterialUniform },
  })
  .$idx(1);
