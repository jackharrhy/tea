import { describe, expect, it } from "vitest";
import { createStarterDocument } from "@tea/maps-editor/core";
import { summarizeEditorDocument } from "../editor-document-summary.ts";

describe("editor document summary", () => {
  it("counts map objects and live visibility without counting editor metadata", () => {
    const document = createStarterDocument();
    const brush = document.entities[0]!.primitives[0]!;
    const entity = document.entities[1]!;
    const empty = {
      hiddenBrushIds: [],
      hiddenEntityIds: [],
      lockedBrushIds: [],
      lockedEntityIds: [],
    };
    expect(summarizeEditorDocument(document, empty)).toEqual({
      revision: 0,
      entityCount: 3,
      brushCount: 3,
      groupCount: 0,
      hiddenObjectCount: 0,
      lockedObjectCount: 0,
      geometryErrorCount: 0,
    });
    expect(
      summarizeEditorDocument(document, {
        hiddenBrushIds: [brush.id],
        hiddenEntityIds: [],
        lockedBrushIds: [],
        lockedEntityIds: [entity.id],
      }),
    ).toMatchObject({ hiddenObjectCount: 1, lockedObjectCount: 1 });
  });
});
