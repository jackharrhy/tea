import {
  brushVertices,
  deriveBrush,
  findBrush,
  projectedFaceGridSegments,
  type Vec3,
} from "../core/index.js";
import type { ToolPreviewInput } from "./scene-interaction-contributions.js";
import { planarHullOutline } from "./hull-outline.js";
import {
  dedupeHullPoints,
  cross,
  normalize,
  dot,
} from "./viewport-geometry.js";

// Original construction visualization, informed by TrenchBroom's assembly interaction.
const HANDLE_COLOR: Vec3 = [1, 0.92, 0];
export function buildHullOverlay(input: ToolPreviewInput) {
  const lines: number[] = [];
  const grid: number[] = [];
  const handles: number[] = [];
  const face: number[] = [];
  const points =
    input.tool === "hull"
      ? dedupeHullPoints([...input.hullPoints, ...input.hullPreviewPoints])
      : [];
  const appendGrid = (
    surface: Parameters<typeof projectedFaceGridSegments>[0],
  ) => {
    for (const segment of projectedFaceGridSegments(surface, input.gridSize)) {
      const strength = segment.major ? 1 : 0.72;
      const color: Vec3 = [
        input.theme.edge[0] * strength,
        input.theme.edge[1] * strength,
        input.theme.edge[2] * strength,
      ];
      grid.push(...segment.start, ...color, ...segment.end, ...color);
    }
  };
  const polygon = planarHullOutline(points);
  if (polygon.length >= 3) {
    const origin = polygon[0]!;
    const delta = (point: Vec3): Vec3 => [
      point[0] - origin[0],
      point[1] - origin[1],
      point[2] - origin[2],
    ];
    const normal = normalize(cross(delta(polygon[1]!), delta(polygon[2]!)));
    appendGrid({ vertices: polygon, normal, distance: dot(normal, origin) });
  }
  let vertices = polygon.length ? polygon : points;
  if (polygon.length > 1) {
    for (let i = 0; i < (polygon.length === 2 ? 1 : polygon.length); i++) {
      lines.push(
        ...polygon[i]!,
        ...HANDLE_COLOR,
        ...polygon[(i + 1) % polygon.length]!,
        ...HANDLE_COLOR,
      );
    }
    for (let i = 1; i < polygon.length - 1; i++) {
      for (const point of [polygon[0]!, polygon[i]!, polygon[i + 1]!])
        face.push(...point, ...HANDLE_COLOR, 0, 0);
    }
  } else if (points.length >= 4 && input.selection?.brushId) {
    const brush = findBrush(input.document, input.selection.brushId);
    if (
      brush &&
      brushVertices(brush).every((vertex) =>
        points.some(
          (point) =>
            Math.hypot(
              vertex[0] - point[0],
              vertex[1] - point[1],
              vertex[2] - point[2],
            ) < 0.01,
        ),
      )
    ) {
      vertices = brushVertices(brush);
      for (const surface of deriveBrush(brush).faces) {
        appendGrid(surface);
        for (let i = 1; i < surface.vertices.length - 1; i++) {
          for (const point of [
            surface.vertices[0]!,
            surface.vertices[i]!,
            surface.vertices[i + 1]!,
          ]) {
            face.push(...point, ...input.theme.material, 1, 0);
          }
        }
      }
      for (const edge of deriveBrush(brush).edges)
        lines.push(
          ...edge.start,
          ...HANDLE_COLOR,
          ...edge.end,
          ...HANDLE_COLOR,
        );
    }
  }
  for (const point of vertices) {
    for (const uv of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ])
      handles.push(...point, ...HANDLE_COLOR, ...uv);
  }
  return { lines, grid, handles, face, polygon };
}

export function containsProjectedHull(
  polygon: readonly (readonly [number, number] | null)[],
  point: readonly [number, number],
): boolean {
  if (polygon.length < 3 || polygon.some((vertex) => !vertex)) return false;
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const signedArea =
      (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
    if (Math.abs(signedArea) < 0.001) continue;
    if (sign && Math.sign(signedArea) !== sign) return false;
    sign = Math.sign(signedArea);
  }
  return sign !== 0;
}
