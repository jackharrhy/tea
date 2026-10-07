import type { Vec3 } from "../core/index.js";

export interface EditorRenderTheme {
  readonly background: readonly [number, number, number, number];
  readonly edge: Vec3;
  readonly material: Vec3;
  readonly edgeSelected: Vec3;
  readonly edgeHover: Vec3;
  readonly edgeLocked: Vec3;
  readonly faceSelected: Vec3;
  readonly faceHover: Vec3;
  readonly faceHandle: Vec3;
  readonly reference: Vec3;
  readonly referenceEdge: Vec3;
  readonly axisX: Vec3;
  readonly axisY: Vec3;
  readonly axisZ: Vec3;
  readonly accent: Vec3;
  readonly danger: Vec3;
  readonly success: Vec3;
  readonly info: Vec3;
  readonly special: Vec3;
  readonly gridMinor: Vec3;
  readonly gridMajor: Vec3;
}

export const DEFAULT_EDITOR_RENDER_THEME: EditorRenderTheme = {
  background: [38 / 255, 38 / 255, 38 / 255, 1],
  edge: [0.9, 0.9, 0.9],
  material: [0.48, 0.54, 0.58],
  edgeSelected: [1, 0, 0],
  edgeHover: [1, 0.76, 0.2],
  edgeLocked: [0.13, 0.3, 1],
  faceSelected: [1, 0.3, 0.12],
  faceHover: [1, 0.78, 0.25],
  faceHandle: [0.9, 0.62, 0.18],
  reference: [0.25, 0.48, 0.58],
  referenceEdge: [0.42, 0.72, 0.82],
  axisX: [0.94, 0.25, 0.2],
  axisY: [0.3, 0.86, 0.38],
  axisZ: [0.25, 0.52, 1],
  accent: [1, 0.76, 0.2],
  danger: [1, 0.24, 0.12],
  success: [0.25, 1, 0.58],
  info: [0.2, 0.78, 1],
  special: [0.78, 0.34, 1],
  gridMinor: [0.25, 0.25, 0.25],
  gridMajor: [0.46, 0.46, 0.46],
};
