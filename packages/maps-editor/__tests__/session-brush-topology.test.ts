import { describe, expect, it } from "vitest";

import {
  addBrushVertex,
  EditorSession,
  brushesInDocument,
  brushVertices,
  clipBrush,
  createBoxBrush,
  createSequentialIdFactory,
  createStarterDocument,
  deleteBrushVertices,
  deriveBrush,
  findBrush,
  intersectBrushRay,
  moveBrushVertices,
  rotateBrush,
  scaleBrush,
  selectedBrushIds,
  shearBrush,
  textureCoordinates,
} from "../src/core/index.js";

describe("editor brush topology transactions", () => {
  it("rotates, scales, and shears authoritative planes without texture-lock drift", () => {
    const brush = createBoxBrush([-16, -8, -4], [32, 24, 20]);
    const pivot = [0, 0, 0] as const;
    const originalFace = brush.faces[0]!;
    const originalPoint = originalFace.planePoints[0];

    const rotated = rotateBrush(brush, pivot, 2, 90, true);
    const rotatedPoint = [
      -originalPoint[1],
      originalPoint[0],
      originalPoint[2],
    ] as const;
    expect(deriveBrush(rotated).valid).toBe(true);
    expect(textureCoordinates(rotated.faces[0]!, rotatedPoint)[0]).toBeCloseTo(
      textureCoordinates(originalFace, originalPoint)[0],
    );
    expect(textureCoordinates(rotated.faces[0]!, rotatedPoint)[1]).toBeCloseTo(
      textureCoordinates(originalFace, originalPoint)[1],
    );

    const scaled = scaleBrush(brush, pivot, [2, 0.5, 1.5], true);
    const scaledPoint = [
      originalPoint[0] * 2,
      originalPoint[1] * 0.5,
      originalPoint[2] * 1.5,
    ] as const;
    expect(deriveBrush(scaled).valid).toBe(true);
    expect(textureCoordinates(scaled.faces[0]!, scaledPoint)[0]).toBeCloseTo(
      textureCoordinates(originalFace, originalPoint)[0],
    );
    expect(textureCoordinates(scaled.faces[0]!, scaledPoint)[1]).toBeCloseTo(
      textureCoordinates(originalFace, originalPoint)[1],
    );

    const sheared = shearBrush(brush, pivot, 2, 0, 0.5, true);
    const shearedPoint = [
      originalPoint[0] + originalPoint[2] * 0.5,
      originalPoint[1],
      originalPoint[2],
    ] as const;
    expect(deriveBrush(sheared).valid).toBe(true);
    expect(textureCoordinates(sheared.faces[0]!, shearedPoint)[0]).toBeCloseTo(
      textureCoordinates(originalFace, originalPoint)[0],
    );
    expect(textureCoordinates(sheared.faces[0]!, shearedPoint)[1]).toBeCloseTo(
      textureCoordinates(originalFace, originalPoint)[1],
    );
  });

  it("previews and commits rotate, scale, and shear as individual history entries", () => {
    const document = createStarterDocument();
    const brush = brushesInDocument(document)[1]!;
    const bounds = deriveBrush(brush).bounds!;
    const center = bounds.min.map(
      (component, axis) => (component + bounds.max[axis]!) / 2,
    ) as [number, number, number];
    const session = new EditorSession(document);
    session.select({ brushId: brush.id });

    const rotation = session.createRotationCandidate(brush.id, center, 2, 45)!;
    expect(session.document).toBe(document);
    expect(
      findBrush(rotation.document, brush.id)?.faces[0]?.planePoints,
    ).not.toEqual(brush.faces[0]?.planePoints);
    session.commitCandidate(rotation);
    expect(session.undoLabel).toBe("Rotate brush");
    expect(session.undo()).toBe(true);

    expect(session.scaleSelected(center, [2, 1, 1])).toBe(true);
    expect(session.undoLabel).toBe("Scale brush");
    expect(
      deriveBrush(findBrush(session.document, brush.id)!).bounds?.min[0],
    ).toBe(-128);
    expect(session.undo()).toBe(true);

    expect(session.shearSelected(bounds.min, 2, 0, 0.5)).toBe(true);
    expect(session.undoLabel).toBe("Shear brush");
    expect(
      deriveBrush(findBrush(session.document, brush.id)!).bounds?.max[0],
    ).toBeCloseTo(16);
    expect(session.undo()).toBe(true);
    expect(deriveBrush(findBrush(session.document, brush.id)!).bounds).toEqual(
      bounds,
    );
  });

  it("rebuilds a convex hull when one moved vertex chops formerly planar faces", () => {
    const brush = createBoxBrush([-16, -16, -16], [16, 16, 16]);
    const moved = moveBrushVertices(
      brush,
      [[16, 16, 16]],
      [16, 16, 16],
      createSequentialIdFactory("vertex-hull"),
    );
    const derived = deriveBrush(moved);

    expect(derived.valid).toBe(true);
    expect(derived.faces.length).toBeGreaterThan(6);
    const movedCorner = brushVertices(moved).find((point) =>
      point.every((component) => Math.abs(component - 32) < 0.001),
    );
    expect(movedCorner).toBeDefined();
    for (const component of derived.bounds?.min ?? [])
      expect(component).toBeCloseTo(-16);
    for (const component of derived.bounds?.max ?? [])
      expect(component).toBeCloseTo(32);
  });

  it("adds an outward vertex as one undoable convex-hull insertion", () => {
    const document = createStarterDocument();
    const brush = brushesInDocument(document)[0]!;
    const sourcePoint = [128, 0, -16] as const;
    const added = addBrushVertex(
      brush,
      [160, 0, -16],
      sourcePoint,
      createSequentialIdFactory("add-vertex"),
    );
    expect(deriveBrush(added).valid).toBe(true);
    expect(
      brushVertices(added).some(
        (point) =>
          Math.abs(point[0] - 160) < 0.001 &&
          Math.abs(point[1]) < 0.001 &&
          Math.abs(point[2] + 16) < 0.001,
      ),
    ).toBe(true);
    expect(added.faces.length).toBeGreaterThan(brush.faces.length);
    const sourceFaceId = intersectBrushRay(
      brush,
      [512, 0, -16],
      [-1, 0, 0],
    )!.faceId;
    const sourceFace = brush.faces.find((face) => face.id === sourceFaceId)!;
    const expectedUv = textureCoordinates(sourceFace, sourcePoint);
    const insertedFaces = deriveBrush(added).faces.filter((face) =>
      face.vertices.some(
        (point) =>
          Math.abs(point[0] - 160) < 0.001 &&
          Math.abs(point[1]) < 0.001 &&
          Math.abs(point[2] + 16) < 0.001,
      ),
    );
    expect(insertedFaces).toHaveLength(4);
    for (const derivedFace of insertedFaces) {
      const face = added.faces.find(
        (candidate) => candidate.id === derivedFace.faceId,
      )!;
      const uv = textureCoordinates(face, [160, 0, -16]);
      expect(uv[0]).toBeCloseTo(expectedUv[0]);
      expect(uv[1]).toBeCloseTo(expectedUv[1]);
    }

    const session = new EditorSession(document);
    session.select({ brushId: brush.id });
    const candidate = session.createVertexInsertionCandidate(
      brush.id,
      sourcePoint,
      [32, 0, 0],
      createSequentialIdFactory("add-candidate"),
    )!;
    session.commitCandidate(candidate);
    expect(session.undoLabel).toBe("Add vertex");
    expect(
      brushVertices(findBrush(session.document, brush.id)!).some(
        (point) =>
          Math.abs(point[0] - 160) < 0.001 &&
          Math.abs(point[1]) < 0.001 &&
          Math.abs(point[2] + 16) < 0.001,
      ),
    ).toBe(true);
    expect(session.undo()).toBe(true);
    expect(
      brushVertices(findBrush(session.document, brush.id)!).some(
        (point) =>
          Math.abs(point[0] - 160) < 0.001 &&
          Math.abs(point[1]) < 0.001 &&
          Math.abs(point[2] + 16) < 0.001,
      ),
    ).toBe(false);
    expect(() =>
      addBrushVertex(
        brush,
        [112, 0, -16],
        sourcePoint,
        createSequentialIdFactory("add-inside"),
      ),
    ).toThrow("extend the brush hull");
  });

  it("fits split-face Valve 220 projections to the pre-move vertex UVs", () => {
    const source = createBoxBrush([-16, -16, -16], [16, 16, 16]);
    const brush = {
      ...source,
      faces: source.faces.map((face, index) =>
        Object.assign({}, face, {
          material: `FACE_${index}`,
          projection: Object.assign({}, face.projection, {
            offset: [index * 3, index * -5] as const,
            scale: [1 + index * 0.1, 0.75 + index * 0.05] as const,
          }),
        }),
      ),
    };
    const moved = moveBrushVertices(
      brush,
      [[16, 16, 16]],
      [16, 16, 16],
      createSequentialIdFactory("vertex-uv-lock"),
      true,
    );

    for (const face of moved.faces) {
      const original = brush.faces.find(
        (candidate) => candidate.material === face.material,
      )!;
      for (const point of face.planePoints) {
        const sourcePoint = point.every(
          (component) => Math.abs(component - 32) < 0.001,
        )
          ? ([16, 16, 16] as const)
          : point;
        const expected = textureCoordinates(original, sourcePoint);
        const actual = textureCoordinates(face, point);
        expect(actual[0]).toBeCloseTo(expected[0]);
        expect(actual[1]).toBeCloseTo(expected[1]);
      }
    }
  });

  it("fuses or removes an inward vertex and moves an edge as one undoable candidate", () => {
    const document = createStarterDocument();
    const brush = brushesInDocument(document)[1]!;
    const inward = moveBrushVertices(
      brush,
      [[-32, 32, 96]],
      [-32, -32, -48],
      createSequentialIdFactory("vertex-inward"),
    );
    expect(deriveBrush(inward).valid).toBe(true);
    expect(brushVertices(inward)).toHaveLength(7);
    expect(
      brushVertices(inward).some(
        (point) =>
          Math.abs(point[0] + 64) < 0.001 &&
          Math.abs(point[1]) < 0.001 &&
          Math.abs(point[2] - 48) < 0.001,
      ),
    ).toBe(false);

    const session = new EditorSession(document);
    session.select({ brushId: brush.id });
    const edge = [
      [-96, -32, 96],
      [-32, -32, 96],
    ] as const;
    const candidate = session.createVertexMoveCandidate(
      brush.id,
      edge,
      [0, -16, 16],
      createSequentialIdFactory("edge-move"),
      true,
    )!;
    expect(session.document).toBe(document);
    expect(deriveBrush(candidate.after).valid).toBe(true);
    session.commitCandidate(candidate);
    expect(session.undoLabel).toBe("Move vertices");
    expect(
      brushVertices(findBrush(session.document, brush.id)!).some(
        (point) =>
          Math.abs(point[0] + 96) < 0.001 &&
          Math.abs(point[1] + 48) < 0.001 &&
          Math.abs(point[2] - 112) < 0.001,
      ),
    ).toBe(true);
    expect(session.undo()).toBe(true);
    expect(
      deriveBrush(findBrush(session.document, brush.id)!).bounds?.max[2],
    ).toBe(96);
  });

  it("quick-snaps selected vertices onto an existing corner as one hull-safe edit", () => {
    const document = createStarterDocument();
    const brush = brushesInDocument(document)[1]!;
    const source = [-32, 32, 96] as const;
    const target = [-32, -32, 96] as const;
    const session = new EditorSession(document);
    session.select({ brushId: brush.id });

    const candidate = session.createVertexSnapCandidate(
      [brush.id],
      [source],
      source,
      target,
      createSequentialIdFactory("vertex-snap"),
      true,
    )!;
    expect(session.document).toBe(document);
    expect(candidate.label).toBe("Snap vertices");
    expect(deriveBrush(findBrush(candidate.document, brush.id)!).valid).toBe(
      true,
    );
    expect(
      brushVertices(findBrush(candidate.document, brush.id)!),
    ).toHaveLength(7);

    session.commitCandidate(candidate);
    expect(session.undoLabel).toBe("Snap vertices");
    expect(
      brushVertices(findBrush(session.document, brush.id)!).some((point) =>
        point.every(
          (component, axis) => Math.abs(component - source[axis]!) < 0.001,
        ),
      ),
    ).toBe(false);
    expect(session.undo()).toBe(true);
    expect(brushVertices(findBrush(session.document, brush.id)!)).toHaveLength(
      8,
    );
    expect(() =>
      session.createVertexSnapCandidate(
        [brush.id],
        [source],
        [0, 0, 0],
        target,
        createSequentialIdFactory("vertex-snap-invalid"),
      ),
    ).toThrow("anchor");
  });

  it("deletes selected corners atomically and rejects a collapsed remainder", () => {
    const document = createStarterDocument();
    const brush = brushesInDocument(document)[1]!;
    const deleted = deleteBrushVertices(
      brush,
      [[-32, 32, 96]],
      createSequentialIdFactory("delete-vertex"),
      true,
    );
    expect(deriveBrush(deleted).valid).toBe(true);
    expect(brushVertices(deleted)).toHaveLength(7);

    const session = new EditorSession(document);
    session.select({ brushId: brush.id });
    const candidate = session.createVertexDeletionCandidate(
      brush.id,
      [[-32, 32, 96]],
      createSequentialIdFactory("delete-candidate"),
    )!;
    session.commitCandidate(candidate);
    expect(session.undoLabel).toBe("Delete vertices");
    expect(brushVertices(findBrush(session.document, brush.id)!)).toHaveLength(
      7,
    );
    expect(session.undo()).toBe(true);
    expect(brushVertices(findBrush(session.document, brush.id)!)).toHaveLength(
      8,
    );

    expect(() =>
      session.createVertexDeletionCandidate(
        brush.id,
        [
          [-96, -32, 96],
          [-96, 32, 96],
          [-32, -32, 96],
          [-32, 32, 96],
        ],
        createSequentialIdFactory("delete-collapse"),
      ),
    ).toThrow("collapse");
    expect(session.document.revision).toBe(2);
  });

  it("moves and deletes coincident vertices across selected brushes as one transaction", () => {
    const ids = createSequentialIdFactory("shared-topology");
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
    session.selectBrush(left.id);
    session.selectBrush(right.id, true);
    const sharedVertex = [0, 32, 32] as const;

    const move = session.createBrushSetVertexMoveCandidate(
      selectedBrushIds(session.selection),
      [sharedVertex],
      [0, 0, 16],
      createSequentialIdFactory("shared-move"),
    )!;
    expect(move.label).toBe("Move shared vertices");
    expect(move.document.revision).toBe(1);
    for (const brush of [left, right]) {
      expect(
        brushVertices(findBrush(move.document, brush.id)!).some(
          (point) =>
            Math.abs(point[0]) < 0.001 &&
            Math.abs(point[1] - 32) < 0.001 &&
            Math.abs(point[2] - 48) < 0.001,
        ),
      ).toBe(true);
    }
    session.commitCandidate(move);
    expect(session.undoLabel).toBe("Move shared vertices");
    expect(session.undo()).toBe(true);
    for (const brush of [left, right]) {
      expect(
        brushVertices(findBrush(session.document, brush.id)!),
      ).toContainEqual(sharedVertex);
    }

    const sharedEdge = [
      [0, -32, 0],
      [0, -32, 32],
    ] as const;
    const edgeMove = session.createBrushSetVertexMoveCandidate(
      selectedBrushIds(session.selection),
      sharedEdge,
      [0, -16, 0],
      createSequentialIdFactory("shared-edge-move"),
    )!;
    session.commitCandidate(edgeMove);
    expect(edgeMove.label).toBe("Move shared vertices");
    expect(
      deriveBrush(findBrush(session.document, left.id)!).bounds?.min[1],
    ).toBe(-48);
    expect(
      deriveBrush(findBrush(session.document, right.id)!).bounds?.min[1],
    ).toBe(-48);
    expect(session.undo()).toBe(true);

    expect(
      session.deleteSelectedVertices(
        [sharedVertex],
        createSequentialIdFactory("shared-delete"),
      ),
    ).toBe(true);
    expect(session.undoLabel).toBe("Delete shared vertices");
    expect(session.document.revision).toBe(5);
    expect(brushVertices(findBrush(session.document, left.id)!)).toHaveLength(
      7,
    );
    expect(brushVertices(findBrush(session.document, right.id)!)).toHaveLength(
      7,
    );
    expect(session.undo()).toBe(true);
    expect(brushVertices(findBrush(session.document, left.id)!)).toHaveLength(
      8,
    );
    expect(brushVertices(findBrush(session.document, right.id)!)).toHaveLength(
      8,
    );
  });

  it("clips a convex brush to either oriented half-space and prunes obsolete planes", () => {
    const brush = createBoxBrush([-16, -16, -16], [16, 16, 16]);
    const plane = [
      [0, 0, 0],
      [0, 0, 16],
      [0, 16, 0],
    ] as const;
    const ids = createSequentialIdFactory("clip-halves");
    const back = clipBrush(brush, plane, "back", ids.face())!;
    const front = clipBrush(brush, plane, "front", ids.face())!;

    expect(deriveBrush(back).bounds).toEqual({
      min: [-16, -16, -16],
      max: [0, 16, 16],
    });
    expect(deriveBrush(front).bounds).toEqual({
      min: [0, -16, -16],
      max: [16, 16, 16],
    });
    expect(deriveBrush(back).valid).toBe(true);
    expect(deriveBrush(front).valid).toBe(true);
  });

  it("previews, commits, undoes, and redoes a split brush as one transaction", () => {
    const document = createStarterDocument();
    const source = brushesInDocument(document)[1]!;
    const bounds = deriveBrush(source).bounds!;
    const x = (bounds.min[0] + bounds.max[0]) / 2;
    const plane = [
      [x, 0, 0],
      [x, 0, 16],
      [x, 16, 0],
    ] as const;
    const session = new EditorSession(document);
    const candidate = session.createClipCandidate(
      source.id,
      plane,
      "split",
      createSequentialIdFactory("clip-split"),
    )!;

    expect(candidate.after).toHaveLength(2);
    expect(deriveBrush(candidate.after[0]!).bounds?.max[0]).toBe(x);
    expect(deriveBrush(candidate.after[1]!).bounds?.min[0]).toBe(x);
    expect(brushesInDocument(candidate.document)).toHaveLength(4);
    expect(brushesInDocument(session.document)).toHaveLength(3);

    session.commitClipCandidate(candidate);
    expect(session.document.revision).toBe(1);
    expect(session.undoLabel).toBe("Split brush");
    expect(brushesInDocument(session.document)).toHaveLength(4);
    expect(session.undo()).toBe(true);
    expect(session.document.revision).toBe(2);
    expect(brushesInDocument(session.document)).toHaveLength(3);
    expect(deriveBrush(findBrush(session.document, source.id)!).bounds).toEqual(
      bounds,
    );
    expect(session.redo()).toBe(true);
    expect(session.document.revision).toBe(3);
    expect(brushesInDocument(session.document)).toHaveLength(4);
  });

  it("splits several selected brushes with one plane and one history transaction", () => {
    const document = createStarterDocument();
    const [, left, right] = brushesInDocument(document);
    const session = new EditorSession(document);
    session.selectBrush(left!.id);
    session.selectBrush(right!.id, true);
    const plane = [
      [0, 0, 0],
      [16, 0, 0],
      [0, 0, 16],
    ] as const;
    const candidate = session.createBrushSetClipCandidate(
      selectedBrushIds(session.selection),
      plane,
      "split",
      createSequentialIdFactory("clip-set-split"),
    )!;

    expect("edits" in candidate && candidate.edits).toHaveLength(2);
    expect(candidate.label).toBe("Split brushes");
    expect(brushesInDocument(candidate.document)).toHaveLength(5);
    session.commitClipCandidate(candidate);
    expect(session.document.revision).toBe(1);
    expect(brushesInDocument(session.document)).toHaveLength(5);
    expect(selectedBrushIds(session.selection)).toHaveLength(2);
    expect(session.undoLabel).toBe("Split brushes");

    expect(session.undo()).toBe(true);
    expect(brushesInDocument(session.document)).toHaveLength(3);
    expect(selectedBrushIds(session.selection)).toEqual([left!.id, right!.id]);
    expect(session.redo()).toBe(true);
    expect(brushesInDocument(session.document)).toHaveLength(5);
    expect(selectedBrushIds(session.selection)).toHaveLength(2);
  });

  it("preserves unaffected selection members when a set clip removes another brush", () => {
    const document = createStarterDocument();
    const [, left, right] = brushesInDocument(document);
    const session = new EditorSession(document);
    session.selectBrush(left!.id);
    session.selectBrush(right!.id, true);
    const plane = [
      [0, 0, 0],
      [0, 0, 16],
      [0, 16, 0],
    ] as const;
    const candidate = session.createBrushSetClipCandidate(
      selectedBrushIds(session.selection),
      plane,
      "back",
      createSequentialIdFactory("clip-set-delete"),
    )!;

    expect("edits" in candidate && candidate.edits).toHaveLength(1);
    if (!("edits" in candidate))
      throw new Error("Expected a batch clip candidate");
    const remainingId = candidate.selectionAfter[0]!;
    session.commitClipCandidate(candidate);
    expect(brushesInDocument(session.document)).toHaveLength(2);
    expect(selectedBrushIds(session.selection)).toEqual([remainingId]);
    expect(session.undo()).toBe(true);
    expect(brushesInDocument(session.document)).toHaveLength(3);
    expect(selectedBrushIds(session.selection)).toEqual([left!.id, right!.id]);
    expect(session.redo()).toBe(true);
    expect(brushesInDocument(session.document)).toHaveLength(2);
    expect(selectedBrushIds(session.selection)).toEqual([remainingId]);
  });
});
