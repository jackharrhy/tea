import { describe, expect, it } from "vitest";

import {
  adaptiveGridSpacing,
  coordinateSystemVertices,
} from "../src/render/scene-grid.js";
import { DEFAULT_EDITOR_RENDER_THEME } from "../src/render/theme.js";

describe("editor grid and coordinate system", () => {
  it("keeps the selected spacing when it is readable", () => {
    expect(adaptiveGridSpacing(16, 1)).toBe(16);
  });

  it("promotes by powers of two until lines are at least eight pixels apart", () => {
    expect(adaptiveGridSpacing(1, 4)).toBe(32);
    expect(adaptiveGridSpacing(16, 4)).toBe(32);
  });

  it("never renders a sub-unit grid", () => {
    expect(adaptiveGridSpacing(0.25, 0.25)).toBe(2);
  });

  it.each([
    ["perspective", [0, 1, 2]],
    ["xy", [0, 1]],
    ["xz", [0, 2]],
    ["yz", [1, 2]],
  ] as const)(
    "builds the visible colored coordinate axes for %s",
    (kind, expectedAxes) => {
      const vertices = coordinateSystemVertices(kind);
      expect(vertices).toHaveLength(expectedAxes.length * 12);

      const colors = [
        DEFAULT_EDITOR_RENDER_THEME.axisX,
        DEFAULT_EDITOR_RENDER_THEME.axisY,
        DEFAULT_EDITOR_RENDER_THEME.axisZ,
      ] as const;
      for (const [lineIndex, axis] of expectedAxes.entries()) {
        const line = vertices.slice(lineIndex * 12, lineIndex * 12 + 12);
        const start = [0, 0, 0];
        const end = [0, 0, 0];
        start[axis] = -65_536;
        end[axis] = 65_536;
        expect(line).toEqual(
          new Float32Array([
            ...start,
            ...colors[axis],
            ...end,
            ...colors[axis],
          ]),
        );
      }
    },
  );
});
