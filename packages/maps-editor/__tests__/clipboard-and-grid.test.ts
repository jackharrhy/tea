import { describe, expect, it } from "vitest";

import {
  EditorSession,
  brushesInDocument,
  brushVertices,
  createBoxBrush,
  createObjectClipboardDocument,
  createObjectSelection,
  createFaceSelection,
  createSequentialIdFactory,
  createStarterDocument,
  FACE_ATTRIBUTE_CLIPBOARD_HEADER,
  deriveBrush,
  findBrush,
  objectClipboardPasteOffset,
  parseFaceAttributeClipboard,
  parseMap,
  parseEntityOrigin,
  serializeFaceAttributeClipboard,
  serializeMap,
  serializeObjectClipboard,
  selectedBrushIds,
  selectedFaceReferences,
  selectedPointEntityIds,
  type MapDocument,
} from "../src/core/index.js";
import { withTestFace } from "./support/core-fixtures.js";

describe("face attribute clipboard transactions", () => {
  it("round-trips an ID-free primary-face payload without copying brush contents", () => {
    const ids = createSequentialIdFactory("face-clipboard");
    const starter = createStarterDocument();
    const sourceBase = createBoxBrush(
      [-64, -32, 0],
      [-32, 32, 32],
      "SOURCE",
      ids,
    );
    const sourceFace = sourceBase.faces[0]!;
    const source = withTestFace(sourceBase, sourceFace.id, {
      ...sourceFace,
      projection: {
        kind: "valve-220",
        uAxis: [0, 1, 0],
        vAxis: [0, 0, -1],
        offset: [24, -12],
        rotationDegrees: 37,
        scale: [0.5, 2],
      },
      surface: { contents: 7, flags: 3, value: 480 },
    });
    const document: MapDocument = {
      ...starter,
      entities: [{ ...starter.entities[0]!, primitives: [source] }],
    };
    const text = serializeFaceAttributeClipboard(
      document,
      createFaceSelection([{ brushId: source.id, faceId: sourceFace.id }]),
    )!;
    const payload = parseFaceAttributeClipboard(text)!;

    expect(payload.material).toBe("SOURCE");
    expect(payload.projection).toEqual(source.faces[0]!.projection);
    expect(payload.surface).toEqual({ flags: 3, value: 480 });
    expect("contents" in payload.surface).toBe(false);
    expect(parseFaceAttributeClipboard(serializeMap(document))).toBeNull();
    expect(() =>
      parseFaceAttributeClipboard("// Maps face attributes v1\n{"),
    ).toThrow("invalid JSON");
    const withUnknownField = JSON.parse(
      text.slice(FACE_ATTRIBUTE_CLIPBOARD_HEADER.length),
    ) as Record<string, unknown>;
    withUnknownField.legacy = true;
    expect(() =>
      parseFaceAttributeClipboard(
        `${FACE_ATTRIBUTE_CLIPBOARD_HEADER}\n${JSON.stringify(withUnknownField)}`,
      ),
    ).toThrow(/invalid.*legacy/i);
  });

  it("pastes one payload onto a face set atomically and preserves each target contents value", () => {
    const ids = createSequentialIdFactory("face-clipboard-paste");
    const starter = createStarterDocument();
    const sourceBase = createBoxBrush(
      [-96, -32, 0],
      [-64, 32, 32],
      "SOURCE",
      ids,
    );
    const firstTargetBase = createBoxBrush(
      [-16, -32, 0],
      [16, 32, 32],
      "FIRST",
      ids,
    );
    const secondTargetBase = createBoxBrush(
      [64, -32, 0],
      [96, 32, 32],
      "SECOND",
      ids,
    );
    const sourceFaceId = sourceBase.faces[0]!.id;
    const firstTargetId = firstTargetBase.faces[1]!.id;
    const secondTargetId = secondTargetBase.faces[2]!.id;
    const sourceFace = sourceBase.faces[0]!;
    const source = withTestFace(sourceBase, sourceFaceId, {
      ...sourceFace,
      projection: {
        ...sourceFace.projection,
        uAxis: [0, 1, 0],
        vAxis: [0, 0, -1],
        offset: [32, 8],
        rotationDegrees: 90,
        scale: [0.25, 0.75],
      },
      surface: { flags: 5, value: 120 },
    });
    const firstTargetFace = firstTargetBase.faces[1]!;
    const firstTarget = withTestFace(firstTargetBase, firstTargetId, {
      ...firstTargetFace,
      surface: { contents: 11 },
    });
    const secondTargetFace = secondTargetBase.faces[2]!;
    const secondTarget = withTestFace(secondTargetBase, secondTargetId, {
      ...secondTargetFace,
      surface: { contents: 29 },
    });
    const document: MapDocument = {
      ...starter,
      entities: [
        {
          ...starter.entities[0]!,
          primitives: [source, firstTarget, secondTarget],
        },
      ],
    };
    const payload = parseFaceAttributeClipboard(
      serializeFaceAttributeClipboard(
        document,
        createFaceSelection([{ brushId: source.id, faceId: sourceFaceId }]),
      )!,
    )!;
    const session = new EditorSession(document);
    session.select(
      createFaceSelection([
        { brushId: firstTarget.id, faceId: firstTargetId },
        { brushId: secondTarget.id, faceId: secondTargetId },
      ]),
    );

    expect(session.pasteFaceAttributes(payload)).toBe(true);
    expect(session.document.revision).toBe(1);
    expect(session.undoLabel).toBe("Paste face attributes");
    const pastedFirst = findBrush(session.document, firstTarget.id)!.faces.find(
      (face) => face.id === firstTargetId,
    )!;
    const pastedSecond = findBrush(
      session.document,
      secondTarget.id,
    )!.faces.find((face) => face.id === secondTargetId)!;
    expect(pastedFirst.material).toBe("SOURCE");
    expect(pastedSecond.projection).toEqual(payload.projection);
    expect(pastedFirst.surface).toEqual({ flags: 5, value: 120, contents: 11 });
    expect(pastedSecond.surface).toEqual({
      flags: 5,
      value: 120,
      contents: 29,
    });
    expect(selectedFaceReferences(session.selection)).toHaveLength(2);

    expect(session.undo()).toBe(true);
    expect(
      findBrush(session.document, firstTarget.id)!.faces.find(
        (face) => face.id === firstTargetId,
      )!.material,
    ).toBe("FIRST");
    expect(session.redo()).toBe(true);
    expect(
      findBrush(session.document, secondTarget.id)!.faces.find(
        (face) => face.id === secondTargetId,
      )!.material,
    ).toBe("SOURCE");
  });
});

describe("selection grid snapping", () => {
  it("snaps every selected brush vertex and restores the exact brush on undo", () => {
    const ids = createSequentialIdFactory("selection-grid-snap");
    const starter = createStarterDocument();
    const brush = createBoxBrush([3, 5, 7], [27, 29, 31], "GRID", ids);
    const document = {
      ...starter,
      entities: [
        { ...starter.entities[0]!, primitives: [brush] },
        ...starter.entities.slice(1),
      ],
    };
    const session = new EditorSession(document);
    session.selectBrush(brush.id);

    expect(session.snapSelectionToGrid(8, ids)).toBe(true);
    const snapped = findBrush(session.document, brush.id)!;
    expect(
      brushVertices(snapped).every((point) =>
        point.every((value) => value % 8 === 0),
      ),
    ).toBe(true);
    expect(session.undoLabel).toBe("Snap brush vertices to grid");
    expect(session.undo()).toBe(true);
    expect(findBrush(session.document, brush.id)?.faces).toEqual(brush.faces);
  });

  it("limits face-selection snapping to the selected face vertices", () => {
    const ids = createSequentialIdFactory("face-grid-snap");
    const starter = createStarterDocument();
    const brush = createBoxBrush([0, 0, 0], [10, 10, 10], "GRID", ids);
    const document = {
      ...starter,
      entities: [
        { ...starter.entities[0]!, primitives: [brush] },
        ...starter.entities.slice(1),
      ],
    };
    const selectedFace = deriveBrush(brush).faces.find((face) =>
      face.vertices.every((point) => Math.abs(point[2] - 10) < 0.001),
    )!;
    const session = new EditorSession(document);
    session.select(
      createFaceSelection([{ brushId: brush.id, faceId: selectedFace.faceId }]),
    );

    expect(session.snapSelectionToGrid(8, ids)).toBe(true);
    const vertices = brushVertices(findBrush(session.document, brush.id)!);
    expect(vertices.filter((point) => Math.abs(point[2]) < 0.001)).toHaveLength(
      4,
    );
    expect(
      vertices.filter((point) => Math.abs(point[2] - 8) < 0.001),
    ).toHaveLength(4);
    expect(session.undoLabel).toBe("Snap face vertices to grid");
  });
});

describe("object clipboard transactions", () => {
  it("serializes a mixed selection as parseable map text with brush-entity ownership", () => {
    const ids = createSequentialIdFactory("clipboard-source");
    const starter = createStarterDocument();
    const worldBrush = createBoxBrush(
      [-64, -32, 0],
      [-32, 32, 32],
      "WORLD",
      ids,
    );
    const detailBrush = createBoxBrush(
      [32, -32, 0],
      [64, 32, 32],
      "DETAIL",
      ids,
    );
    const player = starter.entities.find(
      (entity) => entity.properties.classname === "info_player_start",
    )!;
    const document: MapDocument = {
      ...starter,
      entities: [
        { ...starter.entities[0]!, primitives: [worldBrush] },
        {
          id: ids.entity(),
          properties: { classname: "func_detail", targetname: "copied_detail" },
          primitives: [detailBrush],
        },
        player,
      ],
    };
    const selection = createObjectSelection(
      [worldBrush.id, detailBrush.id],
      [player.id],
    )!;

    const clipboard = createObjectClipboardDocument(document, selection)!;
    expect(clipboard.entities).toHaveLength(3);
    expect(clipboard.entities[0]!.properties).toEqual({
      classname: "worldspawn",
    });
    expect(clipboard.entities[1]!.properties.targetname).toBe("copied_detail");
    expect(clipboard.entities[1]!.primitives).toEqual([detailBrush]);
    const text = serializeObjectClipboard(document, selection)!;
    const reparsed = parseMap(
      text,
      createSequentialIdFactory("clipboard-reparsed"),
    );
    expect(brushesInDocument(reparsed)).toHaveLength(2);
    expect(
      reparsed.entities.map((entity) => entity.properties.classname),
    ).toEqual(["worldspawn", "func_detail", "info_player_start"]);
  });

  it("pastes world brushes, brush entities, and point entities with fresh IDs in one undo step", () => {
    const sourceIds = createSequentialIdFactory("clipboard-paste-source");
    const starter = createStarterDocument();
    const worldBrush = createBoxBrush(
      [-64, -32, 0],
      [-32, 32, 32],
      "WORLD",
      sourceIds,
    );
    const detailBrush = createBoxBrush(
      [32, -32, 0],
      [64, 32, 32],
      "DETAIL",
      sourceIds,
    );
    const player = starter.entities.find(
      (entity) => entity.properties.classname === "info_player_start",
    )!;
    const source: MapDocument = {
      ...starter,
      entities: [
        { ...starter.entities[0]!, primitives: [worldBrush] },
        {
          id: sourceIds.entity(),
          properties: { classname: "func_detail", targetname: "detail_clip" },
          primitives: [detailBrush],
        },
        player,
      ],
    };
    const clipboard = createObjectClipboardDocument(
      source,
      createObjectSelection([worldBrush.id, detailBrush.id], [player.id]),
    )!;
    const destination = createStarterDocument();
    const originalBrushCount = brushesInDocument(destination).length;
    const originalEntityCount = destination.entities.length;
    const session = new EditorSession(destination);
    const candidate = session.createPasteCandidate(
      clipboard,
      createSequentialIdFactory("clipboard-pasted"),
      [128, 64, 16],
    )!;

    expect(candidate.label).toBe("Paste objects");
    expect(candidate.document.revision).toBe(1);
    expect(brushesInDocument(candidate.document)).toHaveLength(
      originalBrushCount + 2,
    );
    expect(candidate.document.entities).toHaveLength(originalEntityCount + 2);
    expect(selectedBrushIds(candidate.selectionAfter)).toHaveLength(2);
    expect(selectedPointEntityIds(candidate.selectionAfter)).toHaveLength(1);
    const pastedIds = new Set(selectedBrushIds(candidate.selectionAfter));
    expect(pastedIds.has(worldBrush.id)).toBe(false);
    expect(pastedIds.has(detailBrush.id)).toBe(false);
    const pastedDetail = candidate.document.entities.find(
      (entity) => entity.properties.targetname === "detail_clip",
    )!;
    expect(pastedDetail.primitives).toHaveLength(1);
    const pastedBrush = pastedDetail.primitives[0]!;
    if (pastedBrush.kind !== "brush") throw new Error("Expected pasted brush");
    expect(deriveBrush(pastedBrush).bounds).toEqual({
      min: [160, 32, 16],
      max: [192, 96, 48],
    });
    const pastedPlayerId = selectedPointEntityIds(candidate.selectionAfter)[0]!;
    expect(
      parseEntityOrigin(
        candidate.document.entities.find(
          (entity) => entity.id === pastedPlayerId,
        )!,
      ),
    ).toEqual([128, -32, 40]);

    session.commitDocumentCandidate(candidate);
    expect(session.undoLabel).toBe("Paste objects");
    expect(session.undo()).toBe(true);
    expect(brushesInDocument(session.document)).toHaveLength(
      originalBrushCount,
    );
    expect(session.document.entities).toHaveLength(originalEntityCount);
    expect(session.redo()).toBe(true);
    expect(brushesInDocument(session.document)).toHaveLength(
      originalBrushCount + 2,
    );
    expect(selectedPointEntityIds(session.selection)).toHaveLength(1);
  });

  it("computes a Paste Here offset that rests copied bounds on the hit surface", () => {
    const ids = createSequentialIdFactory("clipboard-offset");
    const starter = createStarterDocument();
    const brush = createBoxBrush([-16, -8, 0], [16, 8, 32], "CLIP", ids);
    const clipboard: MapDocument = {
      ...starter,
      entities: [{ ...starter.entities[0]!, primitives: [brush] }],
    };

    expect(
      objectClipboardPasteOffset(clipboard, [128, 64, 48], [0, 0, 1]),
    ).toEqual([128, 64, 48]);
    const session = new EditorSession(starter);
    const candidate = session.createPasteCandidate(
      clipboard,
      createSequentialIdFactory("clipboard-offset-result"),
      [128, 64, 48],
    )!;
    const pasted = findBrush(
      candidate.document,
      selectedBrushIds(candidate.selectionAfter)[0]!,
    )!;
    expect(deriveBrush(pasted).bounds).toEqual({
      min: [112, 56, 48],
      max: [144, 72, 80],
    });
  });

  it("snaps pasted bounds on axes tangent to the target surface", () => {
    const ids = createSequentialIdFactory("clipboard-grid-offset");
    const starter = createStarterDocument();
    const brush = createBoxBrush([-15, -7, 0], [16, 8, 32], "ODD_BOUNDS", ids);
    const clipboard: MapDocument = {
      ...starter,
      entities: [{ ...starter.entities[0]!, primitives: [brush] }],
    };

    const offset = objectClipboardPasteOffset(
      clipboard,
      [128, 64, 48],
      [0, 0, 1],
      16,
    )!;
    const candidate = new EditorSession(starter).createPasteCandidate(
      clipboard,
      createSequentialIdFactory("clipboard-grid-result"),
      offset,
    )!;
    const pasted = findBrush(
      candidate.document,
      selectedBrushIds(candidate.selectionAfter)[0]!,
    )!;
    expect(deriveBrush(pasted).bounds).toEqual({
      min: [112, 64, 48],
      max: [143, 79, 80],
    });
  });
});
