import {
  DEFAULT_EDITOR_RENDER_THEME,
  type EditorRenderTheme,
} from "@tea/maps-editor/render";

export type EditorTheme = "dark" | "light";

export const editorThemeEvent = "tea-maps-editor-theme";

const lightRenderTheme: EditorRenderTheme = {
  ...DEFAULT_EDITOR_RENDER_THEME,
  background: [0.965, 0.966, 0.97, 1],
  edge: [0.22, 0.23, 0.25],
  material: [0.48, 0.5, 0.54],
  reference: [0.27, 0.48, 0.54],
  referenceEdge: [0.25, 0.52, 0.61],
  gridMinor: [0.87, 0.88, 0.9],
  gridMajor: [0.67, 0.69, 0.73],
};

export function editorRenderTheme(): EditorRenderTheme {
  return document.documentElement.dataset.theme === "light"
    ? lightRenderTheme
    : DEFAULT_EDITOR_RENDER_THEME;
}
