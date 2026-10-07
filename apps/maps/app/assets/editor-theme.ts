import {
  DEFAULT_EDITOR_RENDER_THEME,
  type EditorRenderTheme,
} from "@tea/maps-editor/render";

export type EditorTheme = "dark" | "light";

export const editorThemeEvent = "tea-maps-editor-theme";

const lightRenderTheme: EditorRenderTheme = {
  ...DEFAULT_EDITOR_RENDER_THEME,
  background: [0.94, 0.97, 0.95, 1],
  edge: [0.17, 0.25, 0.2],
  material: [0.42, 0.49, 0.44],
  reference: [0.27, 0.48, 0.54],
  referenceEdge: [0.25, 0.52, 0.61],
  gridMinor: [0.81, 0.87, 0.82],
  gridMajor: [0.59, 0.69, 0.6],
};

export function editorRenderTheme(): EditorRenderTheme {
  return document.documentElement.dataset.theme === "light"
    ? lightRenderTheme
    : DEFAULT_EDITOR_RENDER_THEME;
}
