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

export function gridVertices(
  kind: EditorViewportKind,
  requestedSpacing: number,
  theme: EditorRenderTheme = DEFAULT_EDITOR_RENDER_THEME,
): Float32Array {
  const vertices: number[] = [];
  const extent = 4096;
  let spacing = Math.max(1, requestedSpacing);
  while ((extent * 2) / spacing > 4096) spacing *= 2;
  const push = (start: Vec3, end: Vec3, major: boolean) => {
    const color = major ? theme.gridMajor : theme.gridMinor;
    vertices.push(...start, ...color, ...end, ...color);
  };
  for (let offset = -extent; offset <= extent; offset += spacing) {
    const major = offset === 0 || offset % (spacing * 8) === 0;
    if (kind === "xy" || kind === "perspective") {
      push([-extent, offset, 0], [extent, offset, 0], major);
      push([offset, -extent, 0], [offset, extent, 0], major);
    } else if (kind === "xz") {
      push([-extent, 0, offset], [extent, 0, offset], major);
      push([offset, 0, -extent], [offset, 0, extent], major);
    } else {
      push([0, -extent, offset], [0, extent, offset], major);
      push([0, offset, -extent], [0, offset, extent], major);
    }
  }
  return new Float32Array(vertices);
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
