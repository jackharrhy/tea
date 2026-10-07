import { describe, expect, it } from "vitest";

import {
  EditorSession,
  brushesInDocument,
  brushVertices,
  convexMergeBrushes,
  createBoxBrush,
  createConvexHullBrush,
  createSequentialIdFactory,
  createSimpleShapeBrushes,
  createStarterDocument,
  deriveBrush,
  findBrush,
  hollowBrush,
  intersectBrushes,
  intersectBrushRay,
  projectedFaceGridSegments,
  selectedBrushIds,
  selectedFaceReferences,
  subtractBrush,
  sweepBrushFace,
  type MapDocument,
} from "../src/core/index.js";
import { simpleShapeOptions, averagePoints } from "./support/core-fixtures.js";

describe("convex brush derivation", () => {
  it("derives a closed box from its six authoritative face planes", () => {
    const brush = createBoxBrush([-64, -32, -16], [64, 32, 80]);
    const derived = deriveBrush(brush);

    expect(derived.diagnostics).toEqual([]);
    expect(derived.valid).toBe(true);
    expect(derived.bounds).toEqual({ min: [-64, -32, -16], max: [64, 32, 80] });
    expect(derived.faces).toHaveLength(6);
    expect(derived.edges).toHaveLength(12);
    expect(derived.vertices).toHaveLength(36 * 8);
    expect(derived.faces.every((face) => face.vertices.length === 4)).toBe(
      true,
    );
  });

  it("rejects a brush that cannot enclose a convex volume", () => {
    const complete = createBoxBrush([-16, -16, -16], [16, 16, 16]);
    const incomplete = { ...complete, faces: complete.faces.slice(0, 3) };
    const derived = deriveBrush(incomplete);

    expect(derived.valid).toBe(false);
    expect(derived.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "too-few-faces",
    );
    expect(derived.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "empty-brush",
    );
  });

  it("picks the first crossed source face rather than the derived triangle mesh", () => {
    const brush = createBoxBrush([-16, -16, -16], [16, 16, 16]);
    const hit = intersectBrushRay(brush, [64, 0, 0], [-1, 0, 0]);

    expect(hit?.distance).toBeCloseTo(48);
    expect(hit?.point).toEqual([16, 0, 0]);
    expect(hit?.faceId).toBe(brush.faces[0]?.id);
  });
});

describe("projected construction grids", () => {
  it("clips world-grid lines to an axis-aligned convex face", () => {
    const ids = createSequentialIdFactory("grid-face");
    const brush = createBoxBrush([-32, -32, 0], [32, 32, 32], "GRID", ids);
    const top = deriveBrush(brush).faces.find((face) => face.normal[2] > 0.99)!;
    const segments = projectedFaceGridSegments(top, 16);

    expect(segments).toHaveLength(6);
    expect(segments.filter((segment) => segment.major)).toHaveLength(2);
    for (const segment of segments) {
      expect(segment.start[2]).toBeCloseTo(32, 8);
      expect(segment.end[2]).toBeCloseTo(32, 8);
      expect(
        [
          segment.start[0],
          segment.start[1],
          segment.end[0],
          segment.end[1],
        ].some(
          (coordinate) =>
            Math.abs(coordinate / 16 - Math.round(coordinate / 16)) < 1e-8,
        ),
      ).toBe(true);
    }
  });

  it("keeps every generated endpoint on a sloped source plane", () => {
    const inverseRootTwo = 1 / Math.sqrt(2);
    const face = {
      normal: [-inverseRootTwo, 0, inverseRootTwo] as const,
      distance: 0,
      vertices: [
        [-32, -32, -32],
        [32, -32, 32],
        [32, 32, 32],
        [-32, 32, -32],
      ] as const,
    };
    const segments = projectedFaceGridSegments(face, 16);

    expect(segments).toHaveLength(6);
    for (const point of segments.flatMap((segment) => [
      segment.start,
      segment.end,
    ])) {
      expect(
        point[0] * face.normal[0] +
          point[1] * face.normal[1] +
          point[2] * face.normal[2],
      ).toBeCloseTo(face.distance, 8);
    }
    expect(
      segments.some(
        (segment) =>
          Math.abs(segment.start[0] - segment.end[0]) > 1 &&
          Math.abs(segment.start[2] - segment.end[2]) > 1,
      ),
    ).toBe(true);
  });

  it("coarsens extremely large faces to the requested line budget", () => {
    const face = {
      normal: [0, 0, 1] as const,
      distance: 0,
      vertices: [
        [-4096, -4096, 0],
        [4096, -4096, 0],
        [4096, 4096, 0],
        [-4096, 4096, 0],
      ] as const,
    };
    expect(projectedFaceGridSegments(face, 1, 16).length).toBeLessThanOrEqual(
      34,
    );
  });
});

describe("sweep brush generation", () => {
  it("fills a straight destination-cap move with ordered convex segments and inherited UVs", () => {
    const ids = createSequentialIdFactory("straight-sweep");
    const source = createBoxBrush([-16, -16, -16], [16, 16, 16], "SWEEP", ids);
    const face = source.faces[0]!;
    const result = sweepBrushFace(
      source,
      face.id,
      { translation: [64, 0, 0], rotationDegrees: [0, 0, 0], scale: 1 },
      {
        path: "straight",
        segments: 4,
        iterations: 1,
        snapToInteger: false,
        textureLock: true,
      },
      ids,
    );

    expect(result.brushes).toHaveLength(4);
    expect(result.caps).toHaveLength(5);
    expect(result.brushes.map((brush) => deriveBrush(brush).bounds)).toEqual([
      { min: [16, -16, -16], max: [32, 16, 16] },
      { min: [32, -16, -16], max: [48, 16, 16] },
      { min: [48, -16, -16], max: [64, 16, 16] },
      { min: [64, -16, -16], max: [80, 16, 16] },
    ]);
    expect(result.brushes.every((brush) => deriveBrush(brush).valid)).toBe(
      true,
    );
    expect(
      result.brushes.every((brush) =>
        brush.faces.every(
          (candidate) =>
            candidate.material === face.material &&
            candidate.projection.offset[0] === face.projection.offset[0],
        ),
      ),
    ).toBe(true);
  });

  it("builds repeated arc and S-bend paths and snaps every generated cap when requested", () => {
    const ids = createSequentialIdFactory("curved-sweep");
    const source = createBoxBrush([-16, -16, -16], [16, 16, 16], "CURVE", ids);
    const face = source.faces[0]!;
    const arc = sweepBrushFace(
      source,
      face.id,
      { translation: [-16, 16, 0], rotationDegrees: [0, 0, 90], scale: 1 },
      {
        path: "arc",
        segments: 4,
        iterations: 2,
        snapToInteger: false,
        textureLock: true,
      },
      ids,
    );
    expect(arc.brushes).toHaveLength(8);
    expect(arc.brushes.every((brush) => deriveBrush(brush).valid)).toBe(true);
    expect(averagePoints(arc.caps.at(-1)!)).toEqual([-16, 0, 0]);

    const sBend = sweepBrushFace(
      source,
      face.id,
      {
        translation: [95.25, 47.5, 3.75],
        rotationDegrees: [0, 0, 0],
        scale: 0.8,
      },
      {
        path: "s-bend",
        segments: 5,
        iterations: 1,
        snapToInteger: true,
        textureLock: false,
      },
      ids,
    );
    expect(sBend.brushes).toHaveLength(5);
    expect(sBend.brushes.every((brush) => deriveBrush(brush).valid)).toBe(true);
    expect(
      sBend.caps
        .flat()
        .every((point) =>
          point.every((component) => Number.isInteger(component)),
        ),
    ).toBe(true);
  });

  it("previews and commits several source faces with one insertion history transaction", () => {
    const ids = createSequentialIdFactory("multi-face-sweep");
    const left = createBoxBrush([-48, -16, -16], [-16, 16, 16], "LEFT", ids);
    const right = createBoxBrush([16, -16, -16], [48, 16, 16], "RIGHT", ids);
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
    const candidate = session.createSweepCandidate(
      faces,
      { translation: [0, 0, 32], rotationDegrees: [0, 0, 15], scale: 1 },
      {
        path: "straight",
        segments: 2,
        iterations: 2,
        snapToInteger: false,
        textureLock: true,
      },
      ids,
    )!;

    expect(candidate.insertions).toHaveLength(8);
    expect(candidate.sourceFaces).toEqual(faces);
    expect(candidate.destinationCaps).toHaveLength(2);
    expect(candidate.destinationCaps.every((cap) => cap.length === 4)).toBe(
      true,
    );
    expect(brushesInDocument(candidate.document)).toHaveLength(10);
    expect(brushesInDocument(session.document)).toHaveLength(2);
    session.commitBatchCreationCandidate(candidate);
    expect(session.document.revision).toBe(1);
    expect(session.undoLabel).toBe("Sweep faces");
    expect(brushesInDocument(session.document)).toHaveLength(10);
    expect(selectedBrushIds(session.selection)).toHaveLength(8);

    expect(session.undo()).toBe(true);
    expect(brushesInDocument(session.document)).toHaveLength(2);
    expect(selectedFaceReferences(session.selection)).toEqual(faces);
    expect(session.redo()).toBe(true);
    expect(brushesInDocument(session.document)).toHaveLength(10);
    expect(selectedBrushIds(session.selection)).toHaveLength(8);
  });
});

describe("simple shape brush generation", () => {
  const bounds = { min: [-64, -48, 0], max: [64, 48, 96] } as const;

  it("creates axis-aligned cylinders, cones, and integer-grid scalable circles", () => {
    const ids = createSequentialIdFactory("round-shapes");
    const cylinder = createSimpleShapeBrushes(
      bounds,
      "CYLINDER",
      simpleShapeOptions({ kind: "cylinder", sides: 8, axis: 2 }),
      ids,
    );
    const cone = createSimpleShapeBrushes(
      bounds,
      "CONE",
      simpleShapeOptions({
        kind: "cone",
        sides: 8,
        axis: 1,
        circleMode: "vertex-aligned",
      }),
      ids,
    );
    const scalable = createSimpleShapeBrushes(
      bounds,
      "SCALABLE",
      simpleShapeOptions({
        kind: "cylinder",
        sides: 12,
        circleMode: "scalable",
      }),
      ids,
    );

    expect(cylinder).toHaveLength(1);
    expect(deriveBrush(cylinder[0]!).faces).toHaveLength(10);
    expect(cone).toHaveLength(1);
    expect(deriveBrush(cone[0]!).faces).toHaveLength(9);
    expect(
      [cylinder[0]!, cone[0]!, scalable[0]!].every(
        (brush) => deriveBrush(brush).valid,
      ),
    ).toBe(true);
    expect(
      brushVertices(scalable[0]!).every((point) =>
        point.every(
          (component) => Math.abs(component - Math.round(component)) <= 1e-6,
        ),
      ),
    ).toBe(true);
  });

  it("builds hollow cylinders, stairs, and arches as validated brush batches", () => {
    const ids = createSequentialIdFactory("compound-shapes");
    const hollow = createSimpleShapeBrushes(
      bounds,
      "HOLLOW",
      simpleShapeOptions({
        kind: "cylinder",
        sides: 8,
        hollow: true,
        thickness: 12,
      }),
      ids,
    );
    const stairs = createSimpleShapeBrushes(
      bounds,
      "STAIRS",
      simpleShapeOptions({
        kind: "stairs",
        stepHeight: 24,
        stairDirection: "negative-y",
      }),
      ids,
    );
    const arch = createSimpleShapeBrushes(
      bounds,
      "ARCH",
      simpleShapeOptions({ kind: "arch", axis: 1, sides: 8, thickness: 12 }),
      ids,
    );

    expect(hollow).toHaveLength(8);
    expect(stairs).toHaveLength(4);
    expect(arch).toHaveLength(4);
    expect(
      [...hollow, ...stairs, ...arch].every(
        (brush) => deriveBrush(brush).valid,
      ),
    ).toBe(true);
    expect(stairs.map((brush) => deriveBrush(brush).bounds?.max[2])).toEqual([
      24, 48, 72, 96,
    ]);
    expect(deriveBrush(stairs[0]!).bounds?.min[1]).toBe(24);
    expect(deriveBrush(stairs.at(-1)!).bounds?.min[1]).toBe(-48);
  });

  it("fits every round shape mode and construction axis inside the authored bounds", () => {
    const ids = createSequentialIdFactory("shape-axis-matrix");
    const cases = ([0, 1, 2] as const).flatMap((axis) =>
      (["edge-aligned", "vertex-aligned", "scalable"] as const).flatMap(
        (circleMode) =>
          (["cylinder", "cone", "arch"] as const).map((kind) => ({
            axis,
            circleMode,
            kind,
          })),
      ),
    );

    for (const { axis, circleMode, kind } of cases) {
      const brushes = createSimpleShapeBrushes(
        bounds,
        "MATRIX",
        simpleShapeOptions({
          kind,
          axis,
          circleMode,
          sides: circleMode === "scalable" ? 12 : 8,
          thickness: 12,
        }),
        ids,
      );
      expect(brushes.length).toBeGreaterThan(0);
      for (const brush of brushes) {
        const derived = deriveBrush(brush);
        expect(derived.valid).toBe(true);
        derived.bounds?.min.forEach((component, componentAxis) =>
          expect(component).toBeGreaterThanOrEqual(
            bounds.min[componentAxis]! - 1e-6,
          ),
        );
        derived.bounds?.max.forEach((component, componentAxis) =>
          expect(component).toBeLessThanOrEqual(
            bounds.max[componentAxis]! + 1e-6,
          ),
        );
      }
    }
  });

  it("creates UV and subdivided icosahedron spheroids inside non-uniform bounds", () => {
    const ids = createSequentialIdFactory("spheroids");
    const uv = createSimpleShapeBrushes(
      bounds,
      "UV_SPHERE",
      simpleShapeOptions({ kind: "uv-sphere", sides: 8, rings: 4 }),
      ids,
    )[0]!;
    const ico = createSimpleShapeBrushes(
      bounds,
      "ICO_SPHERE",
      simpleShapeOptions({ kind: "ico-sphere", accuracy: 2 }),
      ids,
    )[0]!;

    expect(deriveBrush(uv).valid).toBe(true);
    expect(deriveBrush(uv).faces).toHaveLength(40);
    expect(deriveBrush(ico).valid).toBe(true);
    expect(deriveBrush(ico).faces).toHaveLength(80);
    deriveBrush(ico).bounds?.min.forEach((component, axis) =>
      expect(component).toBeCloseTo(bounds.min[axis]!),
    );
    deriveBrush(ico).bounds?.max.forEach((component, axis) =>
      expect(component).toBeCloseTo(bounds.max[axis]!),
    );
  });

  it("previews and commits a compound shape as one selection-restoring history entry", () => {
    const ids = createSequentialIdFactory("shape-session");
    const session = new EditorSession(createStarterDocument());
    const original = session.document.entities[0]!.primitives[0]!;
    session.select({ brushId: original.id });
    const brushes = createSimpleShapeBrushes(
      bounds,
      "STAIRS",
      simpleShapeOptions({ kind: "stairs", stepHeight: 24 }),
      ids,
    );
    const candidate = session.createBrushesCandidate(brushes, "Create stairs");

    expect(brushesInDocument(candidate.document)).toHaveLength(7);
    expect(brushesInDocument(session.document)).toHaveLength(3);
    session.commitBatchCreationCandidate(candidate);
    expect(selectedBrushIds(session.selection)).toEqual(
      brushes.map((brush) => brush.id),
    );
    expect(session.undoLabel).toBe("Create stairs");
    expect(session.undo()).toBe(true);
    expect(session.selection).toEqual({ brushId: original.id });
    expect(session.redo()).toBe(true);
    expect(selectedBrushIds(session.selection)).toEqual(
      brushes.map((brush) => brush.id),
    );
  });

  it("rejects impossible hollowing, unsupported scalable counts, and excessive UV meshes", () => {
    const ids = createSequentialIdFactory("invalid-shapes");
    expect(() =>
      createSimpleShapeBrushes(
        bounds,
        "INVALID",
        simpleShapeOptions({ kind: "cylinder", hollow: true, thickness: 128 }),
        ids,
      ),
    ).toThrow(/interior/);
    expect(() =>
      createSimpleShapeBrushes(
        bounds,
        "INVALID",
        simpleShapeOptions({
          kind: "cylinder",
          sides: 16,
          circleMode: "scalable",
        }),
        ids,
      ),
    ).toThrow(/12, 24, 48, or 96/);
    expect(() =>
      createSimpleShapeBrushes(
        bounds,
        "INVALID",
        simpleShapeOptions({ kind: "uv-sphere", sides: 48, rings: 8 }),
        ids,
      ),
    ).toThrow(/at most 192 faces/);
  });
});

describe("constructive solid geometry", () => {
  it("convex-merges every input vertex and preserves matching source face materials", () => {
    const ids = createSequentialIdFactory("csg-merge-input");
    const left = createBoxBrush([-32, -16, -16], [0, 16, 16], "LEFT", ids);
    const right = createBoxBrush([0, -16, -16], [32, 16, 16], "RIGHT", ids);
    const merged = convexMergeBrushes(
      [left, right],
      createSequentialIdFactory("csg-merge-result"),
      "CURRENT",
    );

    expect(deriveBrush(merged).bounds).toEqual({
      min: [-32, -16, -16],
      max: [32, 16, 16],
    });
    expect(merged.faces).toHaveLength(6);
    expect(merged.faces.map((face) => face.material)).toContain("LEFT");
    expect(merged.faces.map((face) => face.material)).toContain("RIGHT");
  });

  it("intersects convex inputs and removes a disjoint solid result", () => {
    const ids = createSequentialIdFactory("csg-intersection-input");
    const left = createBoxBrush([-16, -16, -16], [16, 16, 16], "LEFT", ids);
    const right = createBoxBrush([0, -8, -8], [32, 8, 8], "RIGHT", ids);
    const disjoint = createBoxBrush([64, 64, 64], [80, 80, 80], "VOID", ids);
    const touching = createBoxBrush(
      [16, -16, -16],
      [32, 16, 16],
      "TOUCHING",
      ids,
    );
    const intersection = intersectBrushes(
      [left, right],
      createSequentialIdFactory("csg-intersection-result"),
    );

    expect(intersection).not.toBeNull();
    expect(deriveBrush(intersection!).bounds).toEqual({
      min: [0, -8, -8],
      max: [16, 8, 8],
    });
    expect(
      intersectBrushes(
        [left, disjoint],
        createSequentialIdFactory("csg-empty-result"),
      ),
    ).toBeNull();
    expect(
      intersectBrushes(
        [left, touching],
        createSequentialIdFactory("csg-touching-result"),
      ),
    ).toBeNull();
  });

  it("represents subtraction and hollow as non-overlapping convex wall fragments", () => {
    const ids = createSequentialIdFactory("csg-subtraction-input");
    const outer = createBoxBrush([-32, -32, -32], [32, 32, 32], "OUTER", ids);
    const inner = createBoxBrush([-16, -16, -16], [16, 16, 16], "INNER", ids);
    const fragments = subtractBrush(
      outer,
      inner,
      createSequentialIdFactory("csg-subtraction-result"),
    );
    const walls = hollowBrush(
      outer,
      8,
      createSequentialIdFactory("csg-hollow-result"),
    );

    expect(fragments).toHaveLength(6);
    expect(fragments.every((fragment) => deriveBrush(fragment).valid)).toBe(
      true,
    );
    expect(
      fragments.flatMap((fragment) =>
        fragment.faces.map((face) => face.material),
      ),
    ).toContain("INNER");
    expect(walls).toHaveLength(6);
    expect(walls.every((wall) => deriveBrush(wall).valid)).toBe(true);
  });

  it("commits merge and subtraction as atomic selection-aware history entries", () => {
    const ids = createSequentialIdFactory("csg-session-input");
    const target = createBoxBrush([-32, -32, -32], [32, 32, 32], "TARGET", ids);
    const cutter = createBoxBrush([-8, -8, -48], [8, 8, 48], "CUTTER", ids);
    const side = createBoxBrush([48, -16, -16], [80, 16, 16], "SIDE", ids);
    const starter = createStarterDocument();
    const document: MapDocument = {
      ...starter,
      entities: [
        { ...starter.entities[0]!, primitives: [target, cutter, side] },
      ],
    };
    const session = new EditorSession(document);
    session.selectBrush(target.id);
    session.selectBrush(side.id, true);

    expect(
      session.csgConvexMergeSelected(
        createSequentialIdFactory("csg-session-merge"),
      ),
    ).toBe(true);
    expect(brushesInDocument(session.document)).toHaveLength(2);
    expect(selectedBrushIds(session.selection)).toHaveLength(1);
    expect(session.undoLabel).toBe("CSG convex merge");
    expect(session.undo()).toBe(true);
    expect(
      brushesInDocument(session.document).map((brush) => brush.id),
    ).toEqual([target.id, cutter.id, side.id]);
    expect(session.redo()).toBe(true);
    expect(brushesInDocument(session.document)).toHaveLength(2);

    expect(session.undo()).toBe(true);
    session.selectBrush(cutter.id);
    expect(
      session.csgSubtractSelected(
        createSequentialIdFactory("csg-session-subtract"),
      ),
    ).toBe(true);
    expect(findBrush(session.document, cutter.id)).toBeNull();
    expect(brushesInDocument(session.document)).toHaveLength(5);
    expect(session.undo()).toBe(true);
    expect(
      brushesInDocument(session.document).map((brush) => brush.id),
    ).toEqual([target.id, cutter.id, side.id]);
  });
});

describe("point-defined convex brush creation", () => {
  it("builds the smallest valid hull, discards interior points, and uses the current material", () => {
    const brush = createConvexHullBrush(
      [
        [-16, -16, 0],
        [16, -16, 0],
        [16, 16, 0],
        [-16, 16, 0],
        [-16, -16, 32],
        [16, -16, 32],
        [16, 16, 32],
        [-16, 16, 32],
        [0, 0, 16],
      ],
      "CURRENT",
      createSequentialIdFactory("point-hull"),
    );

    expect(deriveBrush(brush).bounds).toEqual({
      min: [-16, -16, 0],
      max: [16, 16, 32],
    });
    expect(brush.faces).toHaveLength(6);
    expect(brush.faces.every((face) => face.material === "CURRENT")).toBe(true);
    expect(brushVertices(brush)).toHaveLength(8);
  });

  it("rejects a point set that does not enclose three-dimensional volume", () => {
    expect(() =>
      createConvexHullBrush(
        [
          [-16, -16, 0],
          [16, -16, 0],
          [16, 16, 0],
          [-16, 16, 0],
        ],
        "CURRENT",
      ),
    ).toThrow(/three-dimensional volume/);
  });
});
