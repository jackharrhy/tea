import { surfaceGridColor } from "./surface-grid-shader.js";
import { d, std } from "typegpu";
import { editorMaterialLayout, editorSceneLayout } from "./gpu-schemas.js";

interface SolidVertexInput {
  readonly position: d.v3f;
  readonly color: d.v3f;
  readonly uv: d.v2f;
}
interface SolidFragmentInput {
  readonly color: d.v3f;
  readonly uv: d.v2f;
}
export function solidVertex(input: SolidVertexInput) {
  "use gpu";
  return {
    $position: editorSceneLayout.$.scene.projectionView.mul(
      d.vec4f(input.position, 1),
    ),
    color: input.color,
    uv: input.uv,
    world: input.position,
  };
}
export function solidFragment(
  input: SolidFragmentInput & { readonly world: d.v3f },
): d.v4f {
  "use gpu";
  const dimensions = editorMaterialLayout.$.material.settings.zw;
  const sampled = std.textureSample(
    editorMaterialLayout.$.materialTexture,
    editorMaterialLayout.$.materialSampler,
    input.uv.div(dimensions),
  );
  if (editorMaterialLayout.$.material.settings.y > 0.5 && sampled.a < 0.5)
    std.discard();
  const base = std.mix(
    input.color,
    sampled.rgb,
    editorMaterialLayout.$.material.settings.x,
  );
  return d.vec4f(surfaceGridColor(input.world, base), 1);
}
export function selectionFragment(input: SolidFragmentInput): d.v4f {
  "use gpu";
  return d.vec4f(input.color, 0.22);
}
export function gridVertex(input: { readonly $vertexIndex: number }) {
  "use gpu";
  let position = d.vec2f(-1, -1);
  if (input.$vertexIndex === 1) position = d.vec2f(3, -1);
  if (input.$vertexIndex === 2) position = d.vec2f(-1, 3);
  return { $position: d.vec4f(position, 0, 1) };
}

export function gridFragment(input: { readonly $position: d.v4f }): d.v4f {
  "use gpu";
  const scene = editorSceneLayout.$.scene;
  const centeredPixels = d.vec2f(
    input.$position.x - scene.viewport.x * 0.5,
    scene.viewport.y * 0.5 - input.$position.y,
  );
  const world = scene.grid.xy.add(centeredPixels.mul(scene.grid.z));
  const minorCoordinate = world.div(scene.grid.w);
  const minorCell = std.abs(std.fract(minorCoordinate.add(0.5)).sub(0.5));
  const minorWidth = std.fwidth(minorCoordinate);
  const minorDistance = std.min(
    minorCell.x / minorWidth.x,
    minorCell.y / minorWidth.y,
  );
  const majorCoordinate = minorCoordinate.div(8);
  const majorCell = std.abs(std.fract(majorCoordinate.add(0.5)).sub(0.5));
  const majorWidth = std.fwidth(majorCoordinate);
  const majorDistance = std.min(
    majorCell.x / majorWidth.x,
    majorCell.y / majorWidth.y,
  );
  const minorAlpha = std.saturate(1 - minorDistance);
  const majorAlpha = std.saturate(1 - majorDistance);
  const color = std.mix(scene.gridMinor.rgb, scene.gridMajor.rgb, majorAlpha);
  return d.vec4f(
    color,
    std.max(minorAlpha * scene.gridMinor.a, majorAlpha * scene.gridMajor.a),
  );
}

export function hullHandleVertex(input: SolidVertexInput) {
  "use gpu";
  const clip = editorSceneLayout.$.scene.projectionView.mul(
    d.vec4f(input.position, 1),
  );
  const offset = input.uv.mul(
    d.vec2f(
      (6 * editorSceneLayout.$.scene.viewport.w) /
        editorSceneLayout.$.scene.viewport.x,
      (6 * editorSceneLayout.$.scene.viewport.w) /
        editorSceneLayout.$.scene.viewport.y,
    ),
  );
  return {
    $position: d.vec4f(clip.xy.add(offset.mul(clip.w)), clip.z, clip.w),
    color: input.color,
    uv: input.uv,
  };
}
export function hullHandleFragment(input: SolidFragmentInput): d.v4f {
  "use gpu";
  if (std.length(input.uv) > 1) std.discard();
  return d.vec4f(input.color, 1);
}
export function hullFaceFragment(input: SolidFragmentInput): d.v4f {
  "use gpu";
  return d.vec4f(input.color, std.mix(0.5, 0.24, input.uv.x));
}
