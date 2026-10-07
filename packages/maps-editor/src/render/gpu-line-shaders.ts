import { d, std } from "typegpu";
import { editorSceneLayout } from "./gpu-schemas.js";

// Shared, original antialiased stroke rendering for world edges and editor tool overlays.
interface LineVertexInput {
  readonly start: d.v3f;
  readonly startColor: d.v3f;
  readonly end: d.v3f;
  readonly endColor: d.v3f;
  readonly $vertexIndex: number;
}

export function lineVertex(input: LineVertexInput) {
  "use gpu";
  const start = editorSceneLayout.$.scene.projectionView.mul(
    d.vec4f(input.start, 1),
  );
  const end = editorSceneLayout.$.scene.projectionView.mul(
    d.vec4f(input.end, 1),
  );
  let clippedStart = d.vec4f(start);
  let clippedEnd = d.vec4f(end);
  let clippedStartColor = d.vec3f(input.startColor);
  let clippedEndColor = d.vec3f(input.endColor);
  // Clip in homogeneous space before dividing by w. This also bounds pixel-space
  // distance calculations for long axes that cross the camera or extend off-screen.
  let first = d.f32(0);
  let last = d.f32(1);
  for (let plane = 0; plane < 6; plane++) {
    let a = start.z;
    let b = end.z;
    if (plane === 4) {
      a = start.w - start.z;
      b = end.w - end.z;
    } else if (plane < 4) {
      const sign = plane % 2 === 0 ? 1 : -1;
      const startComponent = plane < 2 ? start.x : start.y;
      const endComponent = plane < 2 ? end.x : end.y;
      a = start.w * 1.01 + startComponent * d.f32(sign);
      b = end.w * 1.01 + endComponent * d.f32(sign);
    }
    if (a < 0 && b < 0) first = 2;
    else if (a < 0) first = std.max(first, a / (a - b));
    else if (b < 0) last = std.min(last, a / (a - b));
  }
  const boundedStart = std.mix(clippedStart, clippedEnd, first);
  const boundedStartColor = std.mix(clippedStartColor, clippedEndColor, first);
  clippedEnd = std.mix(clippedStart, clippedEnd, last);
  clippedEndColor = std.mix(clippedStartColor, clippedEndColor, last);
  clippedStart = d.vec4f(boundedStart);
  clippedStartColor = d.vec3f(boundedStartColor);
  if (first > last) {
    clippedStart = d.vec4f(2, 2, 2, 1);
    clippedEnd = d.vec4f(2, 2, 2, 1);
  }
  const startNdc = clippedStart.xy.div(clippedStart.w);
  const endNdc = clippedEnd.xy.div(clippedEnd.w);
  const viewport = editorSceneLayout.$.scene.viewport.xy;
  const delta = endNdc.sub(startNdc).mul(viewport);
  let direction = d.vec2f(1, 0);
  if (std.length(delta) > 0.000001) direction = std.normalize(delta);
  const perpendicular = d.vec2f(0 - direction.y, direction.x);
  let atEnd = false;
  let positiveSide = false;
  if (
    input.$vertexIndex === 1 ||
    input.$vertexIndex === 4 ||
    input.$vertexIndex === 5
  )
    atEnd = true;
  if (
    input.$vertexIndex === 2 ||
    input.$vertexIndex === 3 ||
    input.$vertexIndex === 5
  )
    positiveSide = true;
  let clip = d.vec4f(clippedStart);
  let color = d.vec3f(clippedStartColor);
  let side = -1;
  if (atEnd) {
    clip = d.vec4f(clippedEnd);
    color = d.vec3f(clippedEndColor);
  }
  if (positiveSide) side = 1;
  // Expand in physical pixel space, including a one-pixel antialiasing fringe.
  const radius = editorSceneLayout.$.scene.viewport.z + 0.75;
  const cap = atEnd ? 1 : -1;
  const offset = perpendicular
    .mul(d.f32(side) * radius)
    .add(direction.mul(d.f32(cap) * radius));
  const clipOffset = offset
    .mul(d.vec2f(2 / viewport.x, 2 / viewport.y))
    .mul(clip.w);
  return {
    $position: d.vec4f(clip.xy.add(clipOffset), clip.z, clip.w),
    color,
    screenStart: d.vec2f(
      (startNdc.x + 1) * viewport.x * 0.5,
      (1 - startNdc.y) * viewport.y * 0.5,
    ),
    screenEnd: d.vec2f(
      (endNdc.x + 1) * viewport.x * 0.5,
      (1 - endNdc.y) * viewport.y * 0.5,
    ),
  };
}
interface LineFragmentInput {
  readonly color: d.v3f;
  readonly screenStart: d.v2f;
  readonly screenEnd: d.v2f;
  readonly $position: d.v4f;
}
function lineCoverage(position: d.v2f, start: d.v2f, end: d.v2f): number {
  "use gpu";
  const segment = end.sub(start);
  const offset = position.sub(start);
  const amount = std.clamp(
    std.dot(offset, segment) / std.max(std.dot(segment, segment), 0.00001),
    0,
    1,
  );
  const distance = std.length(offset.sub(segment.mul(amount)));
  return std.saturate(editorSceneLayout.$.scene.viewport.z + 0.5 - distance);
}

export function lineFragment(input: LineFragmentInput): d.v4f {
  "use gpu";
  return d.vec4f(
    input.color,
    lineCoverage(input.$position.xy, input.screenStart, input.screenEnd),
  );
}
// Guide RGB carries the distance fade; premultiplied blending fades opacity, not hue.
export function guideLineFragment(input: LineFragmentInput): d.v4f {
  "use gpu";
  const opacity =
    0.26 * lineCoverage(input.$position.xy, input.screenStart, input.screenEnd);
  const strength = std.max(
    input.color.x,
    std.max(input.color.y, input.color.z),
  );
  return d.vec4f(std.mul(input.color, opacity), strength * opacity);
}
export function occludedLineFragment(input: LineFragmentInput): d.v4f {
  "use gpu";
  return d.vec4f(
    input.color,
    0.4 * lineCoverage(input.$position.xy, input.screenStart, input.screenEnd),
  );
}
