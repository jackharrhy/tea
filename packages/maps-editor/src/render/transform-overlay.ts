import type { Bounds, TransformAxis, Vec3 } from "../core/index.js";
import type { EditorTool, EditorViewportKind } from "./types.js";
import { boundsCenter, scaleHandles } from "./transform-handles.js";
import {
  DEFAULT_EDITOR_RENDER_THEME,
  type EditorRenderTheme,
} from "./theme.js";

export function appendTransformMarker(
  lines: number[],
  point: Vec3,
  color: readonly [number, number, number],
  radius: number,
): void {
  for (let axis = 0; axis < 3; axis += 1) {
    const start = [...point] as [number, number, number];
    const end = [...point] as [number, number, number];
    start[axis] = start[axis]! - radius;
    end[axis] = end[axis]! + radius;
    lines.push(...start, ...color, ...end, ...color);
  }
}

export function scaleOverlayVertices(
  bounds: Bounds,
  kind: EditorViewportKind,
  theme: EditorRenderTheme = DEFAULT_EDITOR_RENDER_THEME,
): Float32Array {
  const size = bounds.max.map(
    (component, axis) => component - bounds.min[axis]!,
  ) as [number, number, number];
  const markerRadius = Math.max(3, Math.min(10, Math.max(...size) * 0.04));
  const activeAxes: readonly TransformAxis[] =
    kind === "perspective" || kind === "xy"
      ? kind === "perspective"
        ? [0, 1, 2]
        : [0, 1]
      : kind === "xz"
        ? [0, 2]
        : [1, 2];
  const lines: number[] = [];
  for (const handle of scaleHandles(bounds, activeAxes)) {
    const color =
      handle.axes.length === 1
        ? theme.faceHandle
        : handle.axes.length === 2
          ? theme.accent
          : theme.faceHover;
    appendTransformMarker(lines, handle.point, color, markerRadius);
  }
  return new Float32Array(lines);
}

export function appendTransformOverlay(
  lines: number[],
  bounds: Bounds,
  tool: EditorTool,
  transformPivot: Vec3 | null = null,
  transformPivotHovered = false,
  theme: EditorRenderTheme = DEFAULT_EDITOR_RENDER_THEME,
): void {
  const center =
    tool === "rotate" && transformPivot ? transformPivot : boundsCenter(bounds);
  const size: Vec3 = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];
  const markerRadius = Math.max(3, Math.min(10, Math.max(...size) * 0.04));
  if (tool === "rotate") {
    const radius = Math.max(...size) * 0.62 + markerRadius;
    const axes = [
      { first: 1, second: 2, color: theme.axisX },
      { first: 0, second: 2, color: theme.axisY },
      { first: 0, second: 1, color: theme.axisZ },
    ] as const;
    for (const { first, second, color } of axes) {
      let previous: Vec3 | null = null;
      for (let segment = 0; segment <= 32; segment += 1) {
        const radians = (segment / 32) * Math.PI * 2;
        const point = [...center] as [number, number, number];
        point[first] += Math.cos(radians) * radius;
        point[second] += Math.sin(radians) * radius;
        if (previous) lines.push(...previous, ...color, ...point, ...color);
        previous = point;
      }
    }
    if (transformPivotHovered) {
      appendTransformMarker(lines, center, theme.danger, markerRadius * 1.65);
    }
    appendTransformMarker(lines, center, theme.accent, markerRadius);
    return;
  }
  if (tool === "shear") {
    for (let axis = 0; axis < 3; axis += 1) {
      for (const side of [bounds.min[axis], bounds.max[axis]]) {
        const point = [...center] as [number, number, number];
        point[axis] = side!;
        appendTransformMarker(lines, point, theme.special, markerRadius);
      }
    }
  }
}
