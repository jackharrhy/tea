import { d, std } from "typegpu";
import { editorSceneLayout } from "./gpu-schemas.js";

// Original filtered ground grid: stop drawing each frequency before cells become subpixel.
export function perspectiveGridVertex(input: {
  readonly $vertexIndex: number;
}) {
  "use gpu";
  let x = -4096;
  let y = -4096;
  if (
    input.$vertexIndex === 1 ||
    input.$vertexIndex === 4 ||
    input.$vertexIndex === 5
  )
    x = 4096;
  if (
    input.$vertexIndex === 2 ||
    input.$vertexIndex === 3 ||
    input.$vertexIndex === 5
  )
    y = 4096;
  const world = d.vec2f(d.f32(x), d.f32(y));
  return {
    $position: editorSceneLayout.$.scene.projectionView.mul(
      d.vec4f(world, 0, 1),
    ),
    world,
  };
}
export function perspectiveGridFragment(input: {
  readonly world: d.v2f;
}): d.v4f {
  "use gpu";
  const scene = editorSceneLayout.$.scene;
  const coordinate = input.world.div(scene.grid.w);
  const width = std.max(std.fwidth(coordinate), d.vec2f(0.00001));
  const minorDistance = std
    .abs(std.fract(coordinate.add(0.5)).sub(0.5))
    .div(width);
  const minor = std
    .saturate(d.vec2f(1).sub(minorDistance))
    .mul(d.vec2f(1).sub(std.smoothstep(d.vec2f(0.125), d.vec2f(0.5), width)));
  const majorCoordinate = coordinate.div(8);
  const majorWidth = width.div(8);
  const majorDistance = std
    .abs(std.fract(majorCoordinate.add(0.5)).sub(0.5))
    .div(majorWidth);
  const major = std
    .saturate(d.vec2f(1).sub(majorDistance))
    .mul(
      d.vec2f(1).sub(std.smoothstep(d.vec2f(0.125), d.vec2f(0.5), majorWidth)),
    );
  const minorAlpha = std.max(minor.x, minor.y) * scene.gridMinor.a;
  const majorAlpha = std.max(major.x, major.y) * scene.gridMajor.a;
  return d.vec4f(
    std.mix(
      scene.gridMinor.rgb,
      scene.gridMajor.rgb,
      std.max(major.x, major.y),
    ),
    std.max(minorAlpha, majorAlpha),
  );
}
