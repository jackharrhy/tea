import { describe, expect, it } from "vitest";

import {
  EditorSession,
  brushesInDocument,
  brushVertices,
  createBoxBrush,
  createSequentialIdFactory,
  createBrushSelection,
  createStarterDocument,
  deriveBrush,
  extrudableBrushFaces,
  findBrush,
  matchingBrushFaces,
  moveBrushFace,
  selectedBrushIds,
  selectedFaceReferences,
  splitBrushFace,
  stampBrushFace,
  type MapBrush,
  type MapDocument,
} from "../src/core/index.js";

describe("editor selection and face transactions", () => {
  it("toggles additive face selections and expands one brush to all of its faces", () => {
    const document = createStarterDocument();
    const [floor, pillar] = brushesInDocument(document);
    const floorFace = floor!.faces[4]!;
    const pillarFace = pillar!.faces[4]!;
    const session = new EditorSession(document);

    session.selectFace({ brushId: floor!.id, faceId: floorFace.id });
    session.selectFace({ brushId: pillar!.id, faceId: pillarFace.id }, true);
    expect(selectedFaceReferences(session.selection)).toEqual([
      { brushId: floor!.id, faceId: floorFace.id },
      { brushId: pillar!.id, faceId: pillarFace.id },
    ]);
    expect(session.selection).toMatchObject({
      brushId: pillar!.id,
      faceId: pillarFace.id,
    });

    session.selectFace({ brushId: floor!.id, faceId: floorFace.id }, true);
    expect(selectedFaceReferences(session.selection)).toEqual([
      { brushId: pillar!.id, faceId: pillarFace.id },
    ]);

    session.selectBrushFaces(floor!.id);
    expect(selectedFaceReferences(session.selection)).toHaveLength(6);
    expect(
      selectedFaceReferences(session.selection).every(
        (face) => face.brushId === floor!.id,
      ),
    ).toBe(true);
  });

  it("toggles mixed face lasso contents while Shift ensures every enclosed face is selected", () => {
    const document = createStarterDocument();
    const [floor, pillar] = brushesInDocument(document);
    const first = { brushId: floor!.id, faceId: floor!.faces[0]!.id };
    const second = { brushId: floor!.id, faceId: floor!.faces[1]!.id };
    const third = { brushId: pillar!.id, faceId: pillar!.faces[0]!.id };
    const session = new EditorSession(document);
    session.selectFaces([first, second]);

    session.selectFacesWithLasso([second, third]);
    expect(selectedFaceReferences(session.selection)).toEqual([first, third]);

    session.selectFacesWithLasso([second, third], true);
    expect(selectedFaceReferences(session.selection)).toEqual([
      first,
      third,
      second,
    ]);

    session.selectFacesWithLasso([first, third, second]);
    expect(session.selection).toBeNull();
  });

  it("normalizes additive object selection and moves the set in one history step", () => {
    const document = createStarterDocument();
    const [, left, right] = brushesInDocument(document);
    const session = new EditorSession(document);

    session.selectBrush(left!.id);
    session.selectBrush(right!.id, true);
    expect(selectedBrushIds(session.selection)).toEqual([left!.id, right!.id]);
    expect(session.selection).toMatchObject({ brushId: right!.id });

    expect(session.translateSelected([0, 32, 0])).toBe(true);
    expect(session.document.revision).toBe(1);
    expect(session.undoLabel).toBe("Move brushes");
    expect(
      deriveBrush(findBrush(session.document, left!.id)!).bounds?.min[1],
    ).toBe(0);
    expect(
      deriveBrush(findBrush(session.document, right!.id)!).bounds?.min[1],
    ).toBe(0);

    expect(session.undo()).toBe(true);
    expect(
      deriveBrush(findBrush(session.document, left!.id)!).bounds?.min[1],
    ).toBe(-32);
    expect(
      deriveBrush(findBrush(session.document, right!.id)!).bounds?.min[1],
    ).toBe(-32);
    expect(session.redo()).toBe(true);
    expect(
      deriveBrush(findBrush(session.document, left!.id)!).bounds?.min[1],
    ).toBe(0);

    session.selectBrush(left!.id, true);
    expect(selectedBrushIds(session.selection)).toEqual([right!.id]);
  });

  it("applies material to an object selection set atomically", () => {
    const document = createStarterDocument();
    const [, left, right] = brushesInDocument(document);
    const session = new EditorSession(document);
    session.selectBrush(left!.id);
    session.selectBrush(right!.id, true);

    expect(session.applyMaterial("MULTI")).toBe(true);
    expect(session.document.revision).toBe(1);
    expect(
      findBrush(session.document, left!.id)?.faces.every(
        (face) => face.material === "MULTI",
      ),
    ).toBe(true);
    expect(
      findBrush(session.document, right!.id)?.faces.every(
        (face) => face.material === "MULTI",
      ),
    ).toBe(true);
    expect(session.undo()).toBe(true);
    expect(
      findBrush(session.document, left!.id)?.faces.every(
        (face) => face.material === "DEV_PILLAR",
      ),
    ).toBe(true);
    expect(
      findBrush(session.document, right!.id)?.faces.every(
        (face) => face.material === "DEV_PILLAR",
      ),
    ).toBe(true);
  });

  it("flood selects only the connected part of a coplanar surface", () => {
    const ids = createSequentialIdFactory("coplanar");
    const left = createBoxBrush([-64, -32, 0], [0, 32, 32], "TOP", ids);
    const right = createBoxBrush([0, -32, 0], [64, 32, 32], "TOP", ids);
    const isolated = createBoxBrush([128, -32, 0], [192, 32, 32], "TOP", ids);
    const starter = createStarterDocument();
    const document = {
      ...starter,
      entities: [
        { ...starter.entities[0]!, primitives: [left, right, isolated] },
        ...starter.entities.slice(1),
      ],
    };
    const session = new EditorSession(document);

    session.selectConnectedCoplanarFaces({
      brushId: left.id,
      faceId: left.faces[4]!.id,
    });

    expect(selectedFaceReferences(session.selection)).toEqual([
      { brushId: left.id, faceId: left.faces[4]!.id },
      { brushId: right.id, faceId: right.faces[4]!.id },
    ]);
  });

  it("applies one reversible material transaction across selected faces on several brushes", () => {
    const document = createStarterDocument();
    const [floor, pillar] = brushesInDocument(document);
    const floorFace = floor!.faces[4]!;
    const pillarFace = pillar!.faces[4]!;
    const session = new EditorSession(document);
    session.selectFaces([
      { brushId: floor!.id, faceId: floorFace.id },
      { brushId: pillar!.id, faceId: pillarFace.id },
    ]);

    expect(session.applyMaterial("ROOF")).toBe(true);
    expect(session.document.revision).toBe(1);
    expect(findBrush(session.document, floor!.id)?.faces[4]?.material).toBe(
      "ROOF",
    );
    expect(findBrush(session.document, pillar!.id)?.faces[4]?.material).toBe(
      "ROOF",
    );
    expect(findBrush(session.document, pillar!.id)?.faces[0]?.material).toBe(
      "DEV_PILLAR",
    );
    expect(session.undoLabel).toBe("Apply material");

    expect(session.undo()).toBe(true);
    expect(findBrush(session.document, floor!.id)?.faces[4]?.material).toBe(
      "DEV_FLOOR",
    );
    expect(findBrush(session.document, pillar!.id)?.faces[4]?.material).toBe(
      "DEV_PILLAR",
    );
    expect(session.redo()).toBe(true);
    expect(findBrush(session.document, floor!.id)?.faces[4]?.material).toBe(
      "ROOF",
    );
    expect(findBrush(session.document, pillar!.id)?.faces[4]?.material).toBe(
      "ROOF",
    );
  });

  it("moves a face plane along its normal and rejects collapsed extrusion", () => {
    const brush = createBoxBrush([-16, -16, -16], [16, 16, 16]);
    const topFace = brush.faces[4]!;
    const expanded = moveBrushFace(brush, topFace.id, 32);

    expect(deriveBrush(expanded).bounds).toEqual({
      min: [-16, -16, -16],
      max: [16, 16, 48],
    });
    expect(expanded.faces).toHaveLength(brush.faces.length);
    expect(expanded.faces[4]?.id).toBe(topFace.id);

    const session = new EditorSession({
      ...createStarterDocument(),
      entities: [
        {
          ...createStarterDocument().entities[0]!,
          primitives: [brush],
        },
      ],
    });
    session.select({ brushId: brush.id, faceId: topFace.id });
    expect(() =>
      session.createFaceExtrusionCandidate(brush.id, topFace.id, -32),
    ).toThrow(/invalid brush/);
  });

  it("split-extrudes a face outward or inward into two valid adjacent brushes", () => {
    const brush = createBoxBrush([-16, -16, -16], [16, 16, 16], "SPLIT");
    const face = brush.faces[0]!;
    const outward = splitBrushFace(
      brush,
      face.id,
      16,
      createSequentialIdFactory("split-outward"),
    );
    const inward = splitBrushFace(
      brush,
      face.id,
      -16,
      createSequentialIdFactory("split-inward"),
    );

    expect(outward.map((piece) => deriveBrush(piece).bounds)).toEqual([
      { min: [-16, -16, -16], max: [16, 16, 16] },
      { min: [16, -16, -16], max: [32, 16, 16] },
    ]);
    expect(inward.map((piece) => deriveBrush(piece).bounds)).toEqual([
      { min: [-16, -16, -16], max: [0, 16, 16] },
      { min: [0, -16, -16], max: [16, 16, 16] },
    ]);
    expect(
      [...outward, ...inward].every((piece) => deriveBrush(piece).valid),
    ).toBe(true);
    expect(
      [...outward, ...inward].every((piece) =>
        piece.faces.some((candidate) => candidate.material === "SPLIT"),
      ),
    ).toBe(true);
  });

  it("stamps an independent textured prism from one face without changing its source brush", () => {
    const ids = createSequentialIdFactory("face-stamp-operation");
    const original = createBoxBrush(
      [-32, -16, 0],
      [32, 16, 16],
      "STAMPED",
      ids,
    );
    const topFace = original.faces[4]!;
    const source: MapBrush = {
      ...original,
      faces: original.faces.map((face) =>
        face.id === topFace.id
          ? Object.assign({}, face, { surface: { flags: 7, value: 23 } })
          : face,
      ),
    };
    const stamped = stampBrushFace(
      source,
      topFace.id,
      32,
      createSequentialIdFactory("face-stamp-result"),
    );

    expect(deriveBrush(source).bounds).toEqual({
      min: [-32, -16, 0],
      max: [32, 16, 16],
    });
    expect(deriveBrush(stamped).bounds).toEqual({
      min: [-32, -16, 16],
      max: [32, 16, 48],
    });
    expect(deriveBrush(stamped).valid).toBe(true);
    expect(stamped.id).not.toBe(source.id);
    expect(stamped.faces.every((face) => face.material === "STAMPED")).toBe(
      true,
    );
    expect(
      stamped.faces.every(
        (face) => face.surface.flags === 7 && face.surface.value === 23,
      ),
    ).toBe(true);
    expect(() =>
      stampBrushFace(
        source,
        topFace.id,
        0,
        createSequentialIdFactory("zero-face-stamp"),
      ),
    ).toThrow("non-zero");
  });

  it("previews and commits a face stamp as one reversible creation in the source entity", () => {
    const ids = createSequentialIdFactory("face-stamp-session");
    const source = createBoxBrush(
      [-16, -16, 0],
      [16, 16, 16],
      "STAMP_SOURCE",
      ids,
    );
    const starter = createStarterDocument();
    const entityId = ids.entity();
    const document: MapDocument = {
      ...starter,
      entities: [
        starter.entities[0]!,
        {
          id: entityId,
          properties: { classname: "func_detail" },
          primitives: [source],
        },
        ...starter.entities.slice(1),
      ],
    };
    const face = { brushId: source.id, faceId: source.faces[4]!.id };
    const session = new EditorSession(document);
    session.select(face);
    const candidate = session.createFaceStampCandidate(
      [face],
      face,
      16,
      createSequentialIdFactory("face-stamp-candidate"),
      true,
    )!;

    expect(candidate.label).toBe("Stamp face");
    expect(candidate.insertions).toHaveLength(1);
    expect(candidate.insertions[0]?.entityId).toBe(entityId);
    expect(brushesInDocument(candidate.document)).toHaveLength(
      brushesInDocument(document).length + 1,
    );
    expect(brushesInDocument(session.document)).toHaveLength(
      brushesInDocument(document).length,
    );

    session.commitBatchCreationCandidate(candidate);
    expect(session.document.revision).toBe(1);
    expect(selectedBrushIds(session.selection)).toEqual([
      candidate.insertions[0]!.brush.id,
    ]);
    expect(session.undoLabel).toBe("Stamp face");
    expect(session.undo()).toBe(true);
    expect(session.selection).toEqual(face);
    expect(brushesInDocument(session.document)).toHaveLength(
      brushesInDocument(document).length,
    );
    expect(session.redo()).toBe(true);
    expect(selectedBrushIds(session.selection)).toEqual([
      candidate.insertions[0]!.brush.id,
    ]);
  });

  it("commits an undoable face split and rejects opposing shared-face splits", () => {
    const ids = createSequentialIdFactory("face-split-session");
    const left = createBoxBrush([-32, -32, 0], [0, 32, 32], "LEFT", ids);
    const right = createBoxBrush([0, -32, 0], [32, 32, 32], "RIGHT", ids);
    const starter = createStarterDocument();
    const document = {
      ...starter,
      entities: [
        { ...starter.entities[0]!, primitives: [left, right] },
        ...starter.entities.slice(1),
      ],
    };
    const session = new EditorSession(document);
    const face = { brushId: left.id, faceId: left.faces[0]!.id };
    session.select(face);
    const candidate = session.createFaceSetSplitCandidate(
      [face],
      face,
      16,
      createSequentialIdFactory("face-split-candidate"),
    )!;

    expect(candidate.label).toBe("Split-extrude face");
    expect(candidate.edits).toHaveLength(1);
    expect(candidate.edits[0]!.after).toHaveLength(2);
    expect(candidate.selectionAfter).toEqual([
      candidate.edits[0]!.after[1]!.id,
    ]);
    expect(brushesInDocument(candidate.document)).toHaveLength(3);
    session.commitClipCandidate(candidate);
    expect(session.document.revision).toBe(1);
    expect(brushesInDocument(session.document)).toHaveLength(3);
    expect(session.undoLabel).toBe("Split-extrude face");
    expect(session.undo()).toBe(true);
    expect(brushesInDocument(session.document)).toHaveLength(2);
    expect(session.redo()).toBe(true);
    expect(brushesInDocument(session.document)).toHaveLength(3);

    const sharedFaces = matchingBrushFaces(document, face, [left.id, right.id]);
    expect(() =>
      new EditorSession(document).createFaceSetSplitCandidate(
        sharedFaces,
        face,
        16,
        createSequentialIdFactory("opposing-face-split"),
      ),
    ).toThrow("opposing shared faces");
  });

  it("split-extrudes identical same-facing faces as one batch transaction", () => {
    const firstIds = createSequentialIdFactory("same-facing-first");
    const secondIds = createSequentialIdFactory("same-facing-second");
    const first = createBoxBrush(
      [-16, -16, -16],
      [16, 16, 16],
      "FIRST",
      firstIds,
    );
    const second = createBoxBrush(
      [-16, -16, -16],
      [16, 16, 16],
      "SECOND",
      secondIds,
    );
    const starter = createStarterDocument();
    const document = {
      ...starter,
      entities: [
        { ...starter.entities[0]!, primitives: [first, second] },
        ...starter.entities.slice(1),
      ],
    };
    const seed = { brushId: first.id, faceId: first.faces[0]!.id };
    const faces = matchingBrushFaces(document, seed, [first.id, second.id]);
    const session = new EditorSession(document);
    const candidate = session.createFaceSetSplitCandidate(
      faces,
      seed,
      16,
      createSequentialIdFactory("same-facing-split"),
    )!;

    if (!("edits" in candidate))
      throw new Error("Expected a batch face split candidate");
    expect(candidate.label).toBe("Split-extrude faces");
    expect(candidate.edits).toHaveLength(2);
    expect(candidate.selectionAfter).toHaveLength(2);
    expect(brushesInDocument(candidate.document)).toHaveLength(4);
    session.commitClipCandidate(candidate);
    expect(session.document.revision).toBe(1);
    expect(brushesInDocument(session.document)).toHaveLength(4);
    expect(selectedBrushIds(session.selection)).toHaveLength(2);
    expect(session.undo()).toBe(true);
    expect(brushesInDocument(session.document)).toHaveLength(2);
    expect(selectedBrushIds(session.selection)).toEqual([first.id, second.id]);
  });

  it("split-extrudes different coplanar polygons and continues from only the new pieces", () => {
    const ids = createSequentialIdFactory("different-split");
    const first = createBoxBrush([-32, -64, 0], [0, 0, 32], "FIRST", ids);
    const second = createBoxBrush([-64, 0, 0], [0, 64, 48], "SECOND", ids);
    const starter = createStarterDocument();
    const document = {
      ...starter,
      entities: [{ ...starter.entities[0]!, primitives: [first, second] }],
    };
    const session = new EditorSession(document);
    session.select(createBrushSelection([first.id, second.id]));
    for (const [iteration, expectedStart] of [
      [0, 0],
      [1, 16],
    ] as const) {
      const selected = selectedBrushIds(session.selection);
      const brush = findBrush(session.document, selected[0]!)!;
      const cap = deriveBrush(brush).faces.find(
        (face) => face.normal[0] > 0.99,
      )!;
      const seed = { brushId: brush.id, faceId: cap.faceId };
      const faces = extrudableBrushFaces(session.document, seed, selected);
      const candidate = session.createFaceSetSplitCandidate(
        faces,
        seed,
        16,
        createSequentialIdFactory(`split-${iteration}`),
      )!;
      session.commitClipCandidate(candidate);
      const newIds = selectedBrushIds(session.selection);
      expect(newIds).toHaveLength(2);
      expect(newIds.some((id) => selected.includes(id))).toBe(false);
      for (const id of newIds)
        expect(
          deriveBrush(findBrush(session.document, id)!).bounds,
        ).toMatchObject({
          min: [expectedStart, expect.any(Number), 0],
          max: [expectedStart + 16, expect.any(Number), expect.any(Number)],
        });
    }
    const finalSelection = selectedBrushIds(session.selection);
    expect(session.undo()).toBe(true);
    expect(session.redo()).toBe(true);
    expect(selectedBrushIds(session.selection)).toEqual(finalSelection);
    expect(brushesInDocument(session.document)).toHaveLength(6);
  });

  it("previews and commits one undoable selected-face extrusion", () => {
    const document = createStarterDocument();
    const brush = brushesInDocument(document)[1]!;
    const face = brush.faces[0]!;
    const session = new EditorSession(document);
    session.select({ brushId: brush.id, faceId: face.id });

    const candidate = session.createFaceExtrusionCandidate(
      brush.id,
      face.id,
      16,
    )!;
    expect(
      deriveBrush(findBrush(candidate.document, brush.id)!).bounds?.max[0],
    ).toBe(-16);
    expect(findBrush(session.document, brush.id)?.revision).toBe(0);

    session.commitCandidate(candidate);
    expect(session.undoLabel).toBe("Extrude face");
    expect(
      deriveBrush(findBrush(session.document, brush.id)!).bounds?.max[0],
    ).toBe(-16);
    expect(session.undo()).toBe(true);
    expect(
      deriveBrush(findBrush(session.document, brush.id)!).bounds?.max[0],
    ).toBe(-32);
    expect(session.redo()).toBe(true);
    expect(
      deriveBrush(findBrush(session.document, brush.id)!).bounds?.max[0],
    ).toBe(-16);
  });

  it("matches and extrudes exact shared faces with opposing normals atomically", () => {
    const ids = createSequentialIdFactory("shared-faces");
    const left = createBoxBrush([-32, -32, 0], [0, 32, 32], "LEFT", ids);
    const right = createBoxBrush([0, -32, 0], [32, 32, 32], "RIGHT", ids);
    const starter = createStarterDocument();
    const document = {
      ...starter,
      entities: [
        { ...starter.entities[0]!, primitives: [left, right] },
        ...starter.entities.slice(1),
      ],
    };
    const seed = { brushId: left.id, faceId: left.faces[0]!.id };
    const faces = matchingBrushFaces(document, seed, [left.id, right.id]);
    expect(faces).toEqual([
      seed,
      { brushId: right.id, faceId: right.faces[1]!.id },
    ]);

    const session = new EditorSession(document);
    session.selectBrush(left.id);
    session.selectBrush(right.id, true);
    session.selectMatchingBrushFaces(seed, selectedBrushIds(session.selection));
    expect(selectedFaceReferences(session.selection)).toEqual(faces);
    const candidate = session.createFaceSetExtrusionCandidate(faces, seed, 16)!;
    expect(candidate.label).toBe("Extrude shared faces");
    expect(
      deriveBrush(findBrush(candidate.document, left.id)!).bounds?.max[0],
    ).toBe(16);
    expect(
      deriveBrush(findBrush(candidate.document, right.id)!).bounds?.min[0],
    ).toBe(16);

    session.commitCandidate(candidate);
    expect(session.document.revision).toBe(1);
    expect(session.undoLabel).toBe("Extrude shared faces");
    expect(session.undo()).toBe(true);
    expect(
      deriveBrush(findBrush(session.document, left.id)!).bounds?.max[0],
    ).toBe(0);
    expect(
      deriveBrush(findBrush(session.document, right.id)!).bounds?.min[0],
    ).toBe(0);

    expect(() =>
      session.createFaceSetExtrusionCandidate(
        [seed, { brushId: right.id, faceId: right.faces[4]!.id }],
        seed,
        16,
      ),
    ).toThrow("compatible coplanar faces");
  });

  it("extrudes coplanar faces across an object selection without requiring identical polygons", () => {
    const ids = createSequentialIdFactory("coplanar-selection");
    const lower = createBoxBrush([-32, -32, 0], [0, -8, 32], "LOWER", ids);
    const upper = createBoxBrush([-32, 8, 0], [0, 32, 32], "UPPER", ids);
    const unrelated = createBoxBrush(
      [0, 48, 0],
      [32, 64, 32],
      "UNRELATED",
      ids,
    );
    const starter = createStarterDocument();
    const document = {
      ...starter,
      entities: [
        { ...starter.entities[0]!, primitives: [lower, upper, unrelated] },
        ...starter.entities.slice(1),
      ],
    };
    const seed = { brushId: lower.id, faceId: lower.faces[0]!.id };
    const faces = extrudableBrushFaces(document, seed, [
      lower.id,
      upper.id,
      unrelated.id,
    ]);

    expect(faces).toEqual([
      seed,
      { brushId: upper.id, faceId: upper.faces[0]!.id },
    ]);
    const candidate = new EditorSession(
      document,
    ).createFaceSetExtrusionCandidate(faces, seed, 16)!;
    if (!("edits" in candidate))
      throw new Error("Expected a batch face extrusion candidate");
    expect(candidate.edits).toHaveLength(2);
    expect(
      deriveBrush(findBrush(candidate.document, lower.id)!).bounds?.max[0],
    ).toBe(16);
    expect(
      deriveBrush(findBrush(candidate.document, upper.id)!).bounds?.max[0],
    ).toBe(16);
    expect(
      deriveBrush(findBrush(candidate.document, unrelated.id)!).bounds?.min[0],
    ).toBe(0);
  });

  it("translates selected face vertices across adjacent brushes as one convex edit", () => {
    const ids = createSequentialIdFactory("face-translation");
    const left = createBoxBrush([-32, -32, 0], [0, 32, 32], "LEFT", ids);
    const right = createBoxBrush([0, -32, 0], [32, 32, 32], "RIGHT", ids);
    const starter = createStarterDocument();
    const document = {
      ...starter,
      entities: [
        { ...starter.entities[0]!, primitives: [left, right] },
        ...starter.entities.slice(1),
      ],
    };
    const faces = [
      { brushId: left.id, faceId: left.faces[4]!.id },
      { brushId: right.id, faceId: right.faces[4]!.id },
    ];
    const session = new EditorSession(document);
    session.selectFaces(faces);
    const candidate = session.createFaceSetTranslationCandidate(
      faces,
      [16, 0, 0],
      createSequentialIdFactory("face-translation-candidate"),
    )!;

    if (!("edits" in candidate))
      throw new Error("Expected a batch face translation candidate");
    expect(candidate.label).toBe("Move faces");
    expect(candidate.edits).toHaveLength(2);
    expect(
      deriveBrush(findBrush(candidate.document, left.id)!).bounds?.max[0],
    ).toBe(16);
    expect(
      deriveBrush(findBrush(candidate.document, right.id)!).bounds?.max[0],
    ).toBe(48);
    for (const face of faces) {
      expect(
        findBrush(candidate.document, face.brushId)?.faces.some(
          (candidateFace) => candidateFace.id === face.faceId,
        ),
      ).toBe(true);
    }
    session.commitCandidate(candidate);
    expect(session.document.revision).toBe(1);
    expect(session.undoLabel).toBe("Move faces");
    expect(selectedFaceReferences(session.selection)).toEqual(faces);
    expect(session.undo()).toBe(true);
    expect(
      deriveBrush(findBrush(session.document, left.id)!).bounds?.max[0],
    ).toBe(0);
    expect(
      deriveBrush(findBrush(session.document, right.id)!).bounds?.max[0],
    ).toBe(32);
  });

  it("rotates, scales, and shears selected components through convex hull candidates", () => {
    const ids = createSequentialIdFactory("component-transform");
    const brush = createBoxBrush(
      [-16, -16, -16],
      [16, 16, 16],
      "COMPONENT",
      ids,
    );
    const starter = createStarterDocument();
    const document = {
      ...starter,
      entities: [
        { ...starter.entities[0]!, primitives: [brush] },
        ...starter.entities.slice(1),
      ],
    };
    const vertices = brushVertices(brush).filter((point) => point[2] === 16);
    const session = new EditorSession(document);
    session.selectBrush(brush.id);

    const rotated = session.createBrushSetVertexRotationCandidate(
      [brush.id],
      vertices,
      [0, 0, 0],
      2,
      45,
      createSequentialIdFactory("component-rotate"),
    )!;
    const scaled = session.createBrushSetVertexScaleCandidate(
      [brush.id],
      vertices,
      [0, 0, 16],
      [1.5, 1.5, 1],
      createSequentialIdFactory("component-scale"),
    )!;
    const sheared = session.createBrushSetVertexShearCandidate(
      [brush.id],
      vertices,
      [0, 0, 0],
      2,
      0,
      1,
      createSequentialIdFactory("component-shear"),
    )!;

    expect(rotated.label).toBe("Rotate components");
    expect(
      deriveBrush(findBrush(rotated.document, brush.id)!).bounds?.max[0],
    ).toBeCloseTo(Math.SQRT2 * 16);
    expect(
      deriveBrush(findBrush(scaled.document, brush.id)!).bounds?.max[0],
    ).toBe(24);
    expect(
      deriveBrush(findBrush(sheared.document, brush.id)!).bounds?.max[0],
    ).toBe(32);
    expect(
      [rotated, scaled, sheared].every(
        (candidate) =>
          deriveBrush(findBrush(candidate.document, brush.id)!).valid,
      ),
    ).toBe(true);

    session.commitCandidate(scaled);
    expect(session.document.revision).toBe(1);
    expect(session.undoLabel).toBe("Scale components");
    expect(session.undo()).toBe(true);
    expect(
      deriveBrush(findBrush(session.document, brush.id)!).bounds?.max[0],
    ).toBe(16);
  });
});
