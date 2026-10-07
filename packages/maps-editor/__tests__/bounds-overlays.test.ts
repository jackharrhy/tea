import { describe, expect, it } from "vitest";

import {
  createSequentialIdFactory,
  type EditorSelection,
} from "../src/core/index.js";
import {
  appendSelectionBoundsGuide,
  selectionContainsHoveredObject,
} from "../src/render/bounds-overlays.js";

describe("selection bounds guides", () => {
  it("adds a bounds box and three fading outward guides at each corner", () => {
    const floatsPerSegment = 12;
    const boundsSegmentCount = 12;
    const guideSegmentCount = 8 * 3 * 2;
    const lines: number[] = [];
    appendSelectionBoundsGuide(
      lines,
      { min: [0, 0, 0], max: [16, 32, 64] },
      [1, 0, 0],
      [0.1, 0.1, 0.1],
    );

    expect(lines).toHaveLength(
      (boundsSegmentCount + guideSegmentCount) * floatsPerSegment,
    );
    const firstSpike = lines.slice(
      boundsSegmentCount * floatsPerSegment,
      (boundsSegmentCount + 2) * floatsPerSegment,
    );
    expect(firstSpike).toEqual([
      0, 0, 0, 1, 0.35, 0.35, -153.6, 0, 0, 1, 0.35, 0.35, -153.6, 0, 0, 1,
      0.35, 0.35, -1024, 0, 0, 0.1, 0.1, 0.1,
    ]);
  });

  it("shows only when an object under the pointer belongs to the object selection", () => {
    const ids = createSequentialIdFactory("selection-guide");
    const brushA = ids.brush();
    const brushB = ids.brush();
    const brushC = ids.brush();
    const faceA = ids.face();
    const entityA = ids.entity();
    const selection: EditorSelection = {
      brushId: brushA,
      brushIds: [brushA, brushB],
      entityIds: [entityA],
    };
    expect(selectionContainsHoveredObject(selection, { brushId: brushB })).toBe(
      true,
    );
    expect(
      selectionContainsHoveredObject(selection, {
        brushId: brushA,
        faceId: faceA,
      }),
    ).toBe(true);
    expect(
      selectionContainsHoveredObject(selection, { entityId: entityA }),
    ).toBe(true);
    expect(selectionContainsHoveredObject(selection, { brushId: brushC })).toBe(
      false,
    );
    expect(
      selectionContainsHoveredObject(
        { brushId: brushA, faceId: faceA },
        { brushId: brushA },
      ),
    ).toBe(false);
    expect(selectionContainsHoveredObject(selection, null)).toBe(false);
  });
});
