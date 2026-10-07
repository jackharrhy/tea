import {
  projectedFaceGridSegments,
  type Bounds,
  type DerivedFace,
  type TransformAxis,
  type Vec3,
} from "../core/index.js";
import { boundsCenter } from "./transform-handles.js";
import { appendTransformMarker } from "./transform-overlay.js";
import type { EditorRenderTheme } from "./theme.js";
import type { MovementTrace } from "./viewport-geometry.js";

export function appendMovementTrace(
  lines: number[],
  trace: MovementTrace,
  theme: EditorRenderTheme,
): void {
  const color = theme.accent;
  lines.push(...trace.start, ...color, ...trace.end, ...color);
  appendTransformMarker(lines, trace.start, color, 2.5);
  appendTransformMarker(lines, trace.end, theme.danger, 3.5);
  if (trace.axisRestriction === null) return;
  for (const axis of [0, 1, 2] as const) {
    if (axis === trace.axisRestriction) continue;
    for (const offset of [-0.8, 0.8]) {
      const start = [...trace.start] as [number, number, number];
      const end = [...trace.end] as [number, number, number];
      start[axis] += offset;
      end[axis] += offset;
      lines.push(...start, ...color, ...end, ...color);
    }
  }
}

export function appendProjectedFaceGrid(
  lines: number[],
  face: DerivedFace,
  gridSize: number,
  emphasized: boolean,
  theme: EditorRenderTheme,
): void {
  const offset = 0.035;
  for (const segment of projectedFaceGridSegments(face, gridSize)) {
    const color = emphasized
      ? segment.major
        ? theme.accent
        : theme.faceHandle
      : segment.major
        ? theme.gridMajor
        : theme.gridMinor;
    const start: Vec3 = [
      segment.start[0] + face.normal[0] * offset,
      segment.start[1] + face.normal[1] * offset,
      segment.start[2] + face.normal[2] * offset,
    ];
    const end: Vec3 = [
      segment.end[0] + face.normal[0] * offset,
      segment.end[1] + face.normal[1] * offset,
      segment.end[2] + face.normal[2] * offset,
    ];
    lines.push(...start, ...color, ...end, ...color);
  }
}

export function sweepCapsBounds(
  caps: readonly (readonly Vec3[])[],
): Bounds | null {
  const points = caps.flat();
  if (points.length === 0) return null;
  return {
    min: [
      Math.min(...points.map((point) => point[0])),
      Math.min(...points.map((point) => point[1])),
      Math.min(...points.map((point) => point[2])),
    ],
    max: [
      Math.max(...points.map((point) => point[0])),
      Math.max(...points.map((point) => point[1])),
      Math.max(...points.map((point) => point[2])),
    ],
  };
}

export function sweepScaleHandle(bounds: Bounds): Vec3 {
  const center = boundsCenter(bounds);
  const size: Vec3 = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];
  const largestAxis = size.reduce<TransformAxis>(
    (best, value, axis) =>
      value > size[best] ? (axis as TransformAxis) : best,
    0,
  );
  const handle = [...bounds.max] as [number, number, number];
  if (Math.abs(handle[largestAxis] - center[largestAxis]) <= 1e-6) {
    handle[largestAxis] += Math.max(8, Math.max(...size) * 0.5);
  }
  return handle;
}

export function appendSweepOverlay(
  lines: number[],
  caps: readonly (readonly Vec3[])[],
  theme: EditorRenderTheme,
): void {
  const bounds = sweepCapsBounds(caps);
  if (!bounds) return;
  const capColor = theme.success;
  const center = boundsCenter(bounds);
  const size: Vec3 = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];
  const markerRadius = Math.max(3, Math.min(10, Math.max(...size) * 0.04));
  for (const cap of caps) {
    for (let index = 0; index < cap.length; index += 1) {
      lines.push(
        ...cap[index]!,
        ...capColor,
        ...cap[(index + 1) % cap.length]!,
        ...capColor,
      );
    }
  }
  appendTransformMarker(lines, center, theme.accent, markerRadius);

  const radius = Math.max(12, Math.max(...size) * 0.62 + markerRadius);
  const rings = [
    { first: 1, second: 2, color: theme.axisX },
    { first: 0, second: 2, color: theme.axisY },
    { first: 0, second: 1, color: theme.axisZ },
  ] as const;
  for (const { first, second, color } of rings) {
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
  const scaleHandle = sweepScaleHandle(bounds);
  lines.push(...center, ...capColor, ...scaleHandle, ...capColor);
  appendTransformMarker(lines, scaleHandle, theme.success, markerRadius * 1.35);
}

export function appendTopologyMarker(
  lines: number[],
  point: Vec3,
  color: readonly [number, number, number],
  radius = 4,
): void {
  for (let axis = 0; axis < 3; axis += 1) {
    const start = [...point] as [number, number, number];
    const end = [...point] as [number, number, number];
    start[axis] = start[axis]! - radius;
    end[axis] = end[axis]! + radius;
    lines.push(...start, ...color, ...end, ...color);
  }
}

export function appendPointEntityHeading(
  lines: number[],
  center: Vec3,
  yawDegrees: number,
  color: readonly [number, number, number],
  length: number,
): void {
  const radians = (yawDegrees * Math.PI) / 180;
  const direction: Vec3 = [Math.cos(radians), Math.sin(radians), 0];
  const end: Vec3 = [
    center[0] + direction[0] * length,
    center[1] + direction[1] * length,
    center[2],
  ];
  lines.push(...center, ...color, ...end, ...color);
  const wingLength = Math.max(4, length * 0.28);
  for (const wingAngle of [yawDegrees + 150, yawDegrees - 150]) {
    const wingRadians = (wingAngle * Math.PI) / 180;
    const wing: Vec3 = [
      end[0] + Math.cos(wingRadians) * wingLength,
      end[1] + Math.sin(wingRadians) * wingLength,
      end[2],
    ];
    lines.push(...end, ...color, ...wing, ...color);
  }
}
