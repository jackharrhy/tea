import tgpu, { d } from "typegpu";

export const WalkabilityVertex = d.unstruct({
  position: d.float32x3,
  color: d.float32x4,
});

export const walkabilityVertexLayout = tgpu.vertexLayout((count) =>
  d.disarrayOf(WalkabilityVertex, count),
);
