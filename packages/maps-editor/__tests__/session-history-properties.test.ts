import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import {
  EditorSession,
  brushesInDocument,
  createStarterDocument,
  findBrush,
  selectedBrushIds,
  serializeMap,
  type Vec3,
} from "../src/core/index.js";

const nonZeroTranslation = fc
  .tuple(
    fc.integer({ min: -64, max: 64 }),
    fc.integer({ min: -64, max: 64 }),
    fc.integer({ min: -64, max: 64 }),
  )
  .filter(([x, y, z]) => x !== 0 || y !== 0 || z !== 0);

const translationHistory = fc.oneof(
  fc.array(nonZeroTranslation, { minLength: 1, maxLength: 24 }),
  nonZeroTranslation.map((delta): Vec3[] => [
    delta,
    [-delta[0], -delta[1], -delta[2]],
  ]),
);

test.prop([translationHistory], { numRuns: 50 })(
  "undo and redo restore exact source and selection across generated translation histories",
  (translations) => {
    const session = new EditorSession(createStarterDocument());
    const brush = brushesInDocument(session.document)[1]!;
    session.selectBrush(brush.id);
    const initialSource = serializeMap(session.document);
    const initialSelection = selectedBrushIds(session.selection);

    for (const translation of translations) {
      expect(session.translateSelected(translation)).toBe(true);
    }

    const editedSource = serializeMap(session.document);
    const editedSelection = selectedBrushIds(session.selection);
    const total = translations.reduce<Vec3>(
      (sum, delta) => [sum[0] + delta[0], sum[1] + delta[1], sum[2] + delta[2]],
      [0, 0, 0],
    );
    expect(
      findBrush(session.document, brush.id)?.faces.map(
        (face) => face.planePoints,
      ),
    ).toEqual(
      brush.faces.map((face) =>
        face.planePoints.map((point) =>
          point.map((value, axis) => value + total[axis]!),
        ),
      ),
    );

    for (let index = 0; index < translations.length; index += 1) {
      expect(session.undo()).toBe(true);
    }
    expect(serializeMap(session.document)).toBe(initialSource);
    expect(selectedBrushIds(session.selection)).toEqual(initialSelection);
    expect(session.canUndo).toBe(false);

    for (let index = 0; index < translations.length; index += 1) {
      expect(session.redo()).toBe(true);
    }
    expect(serializeMap(session.document)).toBe(editedSource);
    expect(selectedBrushIds(session.selection)).toEqual(editedSelection);
    expect(session.canRedo).toBe(false);
  },
);
