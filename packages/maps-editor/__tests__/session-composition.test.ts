import { describe, expect, it } from "vitest";

import {
  EditorSession,
  brushesInDocument,
  collaborationEditsBetween,
  createBoxBrush,
  createSequentialIdFactory,
  createStarterDocument,
  serializeMap,
} from "../src/core/index.js";

function sessionWithOneBrush(): EditorSession {
  const ids = createSequentialIdFactory("session-composition-fixture");
  const setup = new EditorSession(createStarterDocument());
  const brush = createBoxBrush([0, 0, 0], [32, 32, 32], "DEV/GRID", ids);
  setup.commitCreationCandidate(setup.createBrushCandidate(brush));
  return new EditorSession(setup.document);
}

function applyRepeatableSequence(
  session: EditorSession,
  duplicateIdPrefix: string,
): void {
  expect(
    session.duplicateSelected(
      createSequentialIdFactory(duplicateIdPrefix),
      [0, 0, 0],
    ),
  ).toBe(true);
  expect(session.translateSelected([48, 0, 16])).toBe(true);
  expect(session.rotateSelected([0, 0, 0], 2, 90)).toBe(true);
}

describe("EditorSession command composition", () => {
  it("uses the same command behavior for direct execution and atomic replay", () => {
    const repeated = sessionWithOneBrush();
    const sourceBrushId = brushesInDocument(repeated.document)[0]!.id;
    repeated.selectBrush(sourceBrushId);
    applyRepeatableSequence(repeated, "session-composition-first-copy");

    const beforeReplay = repeated.document;
    const selectionBeforeReplay = repeated.selection;
    const direct = new EditorSession(beforeReplay);
    direct.select(selectionBeforeReplay);
    applyRepeatableSequence(direct, `repeat-${beforeReplay.revision}-1`);

    expect(repeated.repeatLastCommands()).toBe(true);
    expect(serializeMap(repeated.document)).toBe(serializeMap(direct.document));
    expect(repeated.selection).toEqual(direct.selection);
    expect(collaborationEditsBetween(beforeReplay, repeated.document)).toEqual(
      collaborationEditsBetween(beforeReplay, direct.document),
    );

    expect(repeated.undoLabel).toBe("Repeat 3 commands");
    expect(repeated.undo()).toBe(true);
    expect(direct.undo()).toBe(true);
    expect(direct.undo()).toBe(true);
    expect(direct.undo()).toBe(true);
    expect(serializeMap(repeated.document)).toBe(serializeMap(direct.document));
    expect(repeated.selection).toEqual(direct.selection);

    expect(repeated.redo()).toBe(true);
    expect(direct.redo()).toBe(true);
    expect(direct.redo()).toBe(true);
    expect(direct.redo()).toBe(true);
    expect(serializeMap(repeated.document)).toBe(serializeMap(direct.document));
    expect(repeated.selection).toEqual(direct.selection);
  });

  it("keeps document, view, and history notifications on the shared kernel", () => {
    const session = sessionWithOneBrush();
    const brushId = brushesInDocument(session.document)[0]!.id;
    const changes: string[] = [];
    session.subscribe((change) =>
      changes.push(`${change.kind}:${change.label}`),
    );

    session.selectBrush(brushId);
    expect(session.hideSelected()).toBe(true);
    expect(session.undo()).toBe(true);
    expect(session.redo()).toBe(true);

    expect(changes).toEqual([
      "selection:Select brush",
      "view:Hide object",
      "view:Undo Hide object",
      "view:Redo Hide object",
    ]);
    expect(session.objectViewState.hiddenBrushIds).toEqual([brushId]);
  });
});
