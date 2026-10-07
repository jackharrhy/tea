import { describe, expect, it } from "vitest";
import {
  EditorSession,
  applyCollaborationOperation,
  brushesInDocument,
  collaborationEditsBetween,
  createBoxBrush,
  createSequentialIdFactory,
  createStarterDocument,
  findBrush,
  selectedBrushIds,
} from "@tea/maps-editor/core";
import { createEditorClipboard } from "../editor-clipboard.ts";

describe("editor clipboard", () => {
  it("commits hosted object paste as room-compatible semantic edits", () => {
    const session = new EditorSession(createStarterDocument());
    const before = session.document;
    session.selectAllEditable();
    const clipboard = createEditorClipboard({
      session: () => session,
      pointer: () => null,
      gridSize: () => 16,
      textureLock: () => true,
      canPaste: () => true,
      hosted: () => true,
      prepare: () => true,
      status: () => {},
    });
    const text = clipboard.copyText();
    expect(selectedBrushIds(session.selection).length).toBeGreaterThan(0);
    expect(clipboard.pasteText(text!, "original")).toBe(true);
    const edits = collaborationEditsBetween(before, session.document);
    expect(edits.some((edit) => edit.kind === "insert-brush")).toBe(true);
    const replayed = applyCollaborationOperation(before, {
      schemaVersion: 1,
      operationId: "paste",
      transactionId: "paste",
      actorId: "editor",
      baseMapVersion: 0,
      label: "Paste objects",
      edits,
    });
    expect(replayed.status).toBe("applied");
    expect(brushesInDocument(replayed.document)).toHaveLength(
      brushesInDocument(session.document).length,
    );
  });

  it("copies a face and pastes its material into another face", () => {
    const ids = createSequentialIdFactory("tea-face-clipboard");
    const source = createBoxBrush([-64, -32, 0], [-32, 32, 32], "SOURCE", ids);
    const target = createBoxBrush([32, -32, 0], [64, 32, 32], "TARGET", ids);
    const starter = createStarterDocument();
    const session = new EditorSession({
      ...starter,
      entities: [{ ...starter.entities[0]!, primitives: [source, target] }],
    });
    let message = "";
    const clipboard = createEditorClipboard({
      session: () => session,
      pointer: () => null,
      gridSize: () => 16,
      textureLock: () => true,
      canPaste: () => true,
      hosted: () => true,
      prepare: () => true,
      status: (value) => {
        message = value;
      },
    });

    session.selectFace({ brushId: source.id, faceId: source.faces[0]!.id });
    const text = clipboard.copyText();
    session.selectFace({ brushId: target.id, faceId: target.faces[0]!.id });
    expect(clipboard.pasteText(text!, "original")).toBe(true);
    expect(findBrush(session.document, target.id)?.faces[0]?.material).toBe(
      "SOURCE",
    );
    expect(message).toContain("Pasted SOURCE onto 1 face");
    expect(session.undo()).toBe(true);
    expect(findBrush(session.document, target.id)?.faces[0]?.material).toBe(
      "TARGET",
    );
  });
});
