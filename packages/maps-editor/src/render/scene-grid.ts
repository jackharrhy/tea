import type { Vec3 } from "../core/index.js";
import type { EditorViewportKind } from "./types.js";
import {
  DEFAULT_EDITOR_RENDER_THEME,
  type EditorRenderTheme,
} from "./theme.js";

const COORDINATE_SYSTEM_EXTENT = 65_536;

export function adaptiveGridSpacing(
  requestedSpacing: number,
  worldUnitsPerPixel: number,
  minimumPixels = 8,
): number {
  let spacing = Math.max(1, requestedSpacing);
  const unitsPerPixel = Math.max(Number.EPSILON, worldUnitsPerPixel);
  while (spacing / unitsPerPixel < minimumPixels) spacing *= 2;
  return spacing;
}

export function coordinateSystemVertices(
  kind: EditorViewportKind,
  theme: EditorRenderTheme = DEFAULT_EDITOR_RENDER_THEME,
): Float32Array {
  const visibleAxes: readonly (0 | 1 | 2)[] =
    kind === "perspective"
      ? [0, 1, 2]
      : kind === "xy"
        ? [0, 1]
        : kind === "xz"
          ? [0, 2]
          : [1, 2];
  const colors = [theme.axisX, theme.axisY, theme.axisZ] as const;
  const vertices: number[] = [];
  for (const axis of visibleAxes) {
    const start: Vec3 = [
      axis === 0 ? -COORDINATE_SYSTEM_EXTENT : 0,
      axis === 1 ? -COORDINATE_SYSTEM_EXTENT : 0,
      axis === 2 ? -COORDINATE_SYSTEM_EXTENT : 0,
    ];
    const end: Vec3 = [
      axis === 0 ? COORDINATE_SYSTEM_EXTENT : 0,
      axis === 1 ? COORDINATE_SYSTEM_EXTENT : 0,
      axis === 2 ? COORDINATE_SYSTEM_EXTENT : 0,
    ];
    vertices.push(...start, ...colors[axis], ...end, ...colors[axis]);
  }
  return new Float32Array(vertices);
}
