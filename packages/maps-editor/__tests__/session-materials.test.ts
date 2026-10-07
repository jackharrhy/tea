import { describe, expect, it } from "vitest";

import {
  alignFaceTexture,
  EditorSession,
  brushesInDocument,
  createBoxBrush,
  createFaceSelection,
  createSequentialIdFactory,
  createStarterDocument,
  deriveBrush,
  findBrush,
  textureCoordinates,
  transformFaceTexture,
  transferFaceAttributes,
  type MapDocument,
} from "../src/core/index.js";
import {
  dotVectors,
  normalizeVector,
  faceTextureBounds,
} from "./support/core-fixtures.js";

describe("editor material transactions", () => {
  it("updates Valve 220 shift, scale, and explicit axes as one texture edit", () => {
    const document = createStarterDocument();
    const brush = brushesInDocument(document)[1]!;
    const face = brush.faces[0]!;
    const session = new EditorSession(document);
    session.select({ brushId: brush.id, faceId: face.id });

    expect(
      session.applyTextureTransform({
        offset: [24, -8],
        rotationDegrees: 90,
        scale: [0.5, 2],
      }),
    ).toBe(true);
    const changed = findBrush(session.document, brush.id)?.faces[0];
    expect(changed?.projection).toMatchObject({
      offset: [24, -8],
      rotationDegrees: 90,
      scale: [0.5, 2],
    });
    expect(changed?.projection.uAxis).not.toEqual(face.projection.uAxis);
    expect(session.undo()).toBe(true);
    expect(findBrush(session.document, brush.id)?.faces[0]?.projection).toEqual(
      face.projection,
    );
  });

  it("edits one mixed projection field without flattening the other face attributes", () => {
    const source = createStarterDocument();
    const sourceBrush = brushesInDocument(source)[1]!;
    const first = sourceBrush.faces[0]!;
    const second = sourceBrush.faces[1]!;
    const brush = Object.assign({}, sourceBrush, {
      faces: sourceBrush.faces.map((face) => {
        if (face.id === first.id) {
          return Object.assign({}, face, {
            projection: Object.assign({}, face.projection, {
              offset: [8, 16] as const,
              scale: [0.5, 1] as const,
            }),
          });
        }
        if (face.id === second.id) {
          return Object.assign({}, face, {
            projection: Object.assign({}, face.projection, {
              offset: [24, -12] as const,
              scale: [2, 0.25] as const,
              rotationDegrees: 30,
            }),
          });
        }
        return face;
      }),
    });
    const document: MapDocument = {
      ...source,
      entities: source.entities.map((entity) =>
        Object.assign({}, entity, {
          primitives: entity.primitives.map((candidate) =>
            candidate.id === brush.id ? brush : candidate,
          ),
        }),
      ),
    };
    const session = new EditorSession(document);
    const selection = createFaceSelection([
      { brushId: brush.id, faceId: first.id },
      { brushId: brush.id, faceId: second.id },
    ]);
    session.select(selection);

    expect(session.setSelectedTextureProjectionField("offset-u", 64)).toBe(
      true,
    );
    const changed = findBrush(session.document, brush.id)!;
    expect(changed.faces[0]?.projection).toEqual({
      ...brush.faces[0]!.projection,
      offset: [64, 16],
    });
    expect(changed.faces[1]?.projection).toEqual({
      ...brush.faces[1]!.projection,
      offset: [64, -12],
    });
    expect(session.undoLabel).toBe("Adjust texture");
    expect(session.undo()).toBe(true);
    expect(findBrush(session.document, brush.id)?.faces).toEqual(brush.faces);
    expect(session.setSelectedTextureProjectionField("offset-u", 8)).toBe(true);
    expect(() =>
      session.setSelectedTextureProjectionField("scale-u", 0),
    ).toThrow("Texture scale cannot be zero");
  });

  it("edits Quake II surface flags atomically while preserving unknown bits and undo", () => {
    const document = createStarterDocument();
    const brush = brushesInDocument(document)[1]!;
    const first = brush.faces[0]!;
    const second = brush.faces[1]!;
    const withSurface: MapDocument = {
      ...document,
      entities: document.entities.map((entity) =>
        Object.assign({}, entity, {
          primitives: entity.primitives.map((primitive) =>
            primitive.id === brush.id && primitive.kind === "brush"
              ? Object.assign({}, primitive, {
                  faces: primitive.faces.map((face) =>
                    face.id === first.id
                      ? Object.assign({}, face, {
                          surface: { flags: 0x101, value: 100 },
                        })
                      : face.id === second.id
                        ? Object.assign({}, face, {
                            surface: { flags: 0x100, value: 200 },
                          })
                        : face,
                  ),
                })
              : primitive,
          ),
        }),
      ),
    };
    const session = new EditorSession(withSurface);
    session.select(
      createFaceSelection([
        { brushId: brush.id, faceId: first.id },
        { brushId: brush.id, faceId: second.id },
      ]),
    );

    expect(session.setSelectedSurfaceFlag("flags", 0x04, true)).toBe(true);
    const changed = findBrush(session.document, brush.id)!;
    expect(
      changed.faces.slice(0, 2).map(({ surface }) => surface.flags),
    ).toEqual([0x105, 0x104]);
    expect(session.setSelectedSurfaceValue(300)).toBe(true);
    expect(
      findBrush(session.document, brush.id)!
        .faces.slice(0, 2)
        .map(({ surface }) => surface.value),
    ).toEqual([300, 300]);
    expect(session.undo()).toBe(true);
    expect(
      findBrush(session.document, brush.id)!
        .faces.slice(0, 2)
        .map(({ surface }) => surface.value),
    ).toEqual([100, 200]);
    expect(session.undo()).toBe(true);
    expect(
      findBrush(session.document, brush.id)!
        .faces.slice(0, 2)
        .map(({ surface }) => surface.flags),
    ).toEqual([0x101, 0x100]);
  });

  it("previews relative UV transforms around a stable face-space pivot", () => {
    const document = createStarterDocument();
    const brush = brushesInDocument(document)[1]!;
    const face = brush.faces[4]!;
    const vertices = deriveBrush(brush).faces.find(
      (candidate) => candidate.faceId === face.id,
    )!.vertices;
    const sum = vertices.reduce(
      (value, point) => [
        value[0] + point[0],
        value[1] + point[1],
        value[2] + point[2],
      ],
      [0, 0, 0],
    );
    const pivot = [
      sum[0]! / vertices.length,
      sum[1]! / vertices.length,
      sum[2]! / vertices.length,
    ] as const;
    const transform = {
      offset: [12, -6] as const,
      rotationDegrees: 30,
      scale: [2, 0.5] as const,
    };
    const transformed = transformFaceTexture(brush, face.id, transform, pivot);
    const transformedFace = transformed.faces.find(
      (candidate) => candidate.id === face.id,
    )!;
    const beforePivot = textureCoordinates(face, pivot);
    const afterPivot = textureCoordinates(transformedFace, pivot);

    expect(afterPivot[0]).toBeCloseTo(beforePivot[0] + 12);
    expect(afterPivot[1]).toBeCloseTo(beforePivot[1] - 6);
    expect(transformedFace.projection.rotationDegrees).toBe(
      face.projection.rotationDegrees + 30,
    );
    expect(transformedFace.projection.scale).toEqual([
      face.projection.scale[0] * 2,
      face.projection.scale[1] * 0.5,
    ]);
    expect(transformed.faces[0]?.projection).toEqual(
      brush.faces[0]?.projection,
    );

    const session = new EditorSession(document);
    session.select({ brushId: brush.id, faceId: face.id });
    const candidate = session.createTextureTransformDeltaCandidate(
      transform,
      { brushId: brush.id, faceId: face.id },
      pivot,
    );
    expect(candidate).not.toBeNull();
    expect(findBrush(session.document, brush.id)?.faces[4]?.projection).toEqual(
      face.projection,
    );
    session.commitCandidate(candidate!);
    expect(
      textureCoordinates(
        findBrush(session.document, brush.id)!.faces[4]!,
        pivot,
      )[0],
    ).toBeCloseTo(beforePivot[0] + 12);
    expect(session.undo()).toBe(true);
    expect(findBrush(session.document, brush.id)?.faces[4]?.projection).toEqual(
      face.projection,
    );
  });

  it("applies graphical UV deltas relatively across a multi-face selection", () => {
    const source = createStarterDocument();
    const sourceBrush = brushesInDocument(source)[1]!;
    const first = sourceBrush.faces[0]!;
    const second = sourceBrush.faces[1]!;
    const brush = {
      ...sourceBrush,
      faces: sourceBrush.faces.map((face) =>
        face.id === first.id
          ? Object.assign({}, face, {
              projection: Object.assign({}, face.projection, {
                offset: [10, 20] as const,
              }),
            })
          : face.id === second.id
            ? Object.assign({}, face, {
                projection: Object.assign({}, face.projection, {
                  offset: [40, -10] as const,
                }),
              })
            : face,
      ),
    };
    const document = {
      ...source,
      entities: source.entities.map((entity) =>
        Object.assign({}, entity, {
          primitives: entity.primitives.map((candidate) =>
            candidate.id === brush.id ? brush : candidate,
          ),
        }),
      ),
    };
    const session = new EditorSession(document);
    const primary = { brushId: brush.id, faceId: first.id };
    session.select(
      createFaceSelection(
        [primary, { brushId: brush.id, faceId: second.id }],
        primary,
      ),
    );
    const candidate = session.createTextureTransformDeltaCandidate(
      { offset: [5, 7], rotationDegrees: 0, scale: [1, 1] },
      primary,
      first.planePoints[0],
    );
    expect(candidate).not.toBeNull();
    session.commitCandidate(candidate!);
    const changed = findBrush(session.document, brush.id)!;

    expect(
      changed.faces.find((face) => face.id === first.id)?.projection.offset,
    ).toEqual([15, 27]);
    expect(
      changed.faces.find((face) => face.id === second.id)?.projection.offset,
    ).toEqual([45, -3]);
    expect(session.undo()).toBe(true);
    expect(
      findBrush(session.document, brush.id)?.faces.find(
        (face) => face.id === second.id,
      )?.projection.offset,
    ).toEqual([40, -10]);
  });

  it("transfers face attributes with project, rotated, and material-only semantics", () => {
    const ids = createSequentialIdFactory("face-attribute-transfer");
    const sourceBrush = createBoxBrush(
      [-48, -16, -16],
      [-16, 16, 16],
      "SOURCE",
      ids,
    );
    const targetBrush = createBoxBrush(
      [16, -16, -16],
      [48, 16, 16],
      "TARGET",
      ids,
    );
    const sourceFace = {
      ...sourceBrush.faces[4]!,
      projection: {
        kind: "valve-220" as const,
        uAxis: [1, 0, 0] as const,
        vAxis: [0, -1, 0] as const,
        offset: [24, -8] as const,
        rotationDegrees: 15,
        scale: [0.5, 2] as const,
      },
      surface: { contents: 1, flags: 7, value: 3 },
    };
    const originalTarget = {
      ...targetBrush.faces[0]!,
      projection: {
        kind: "valve-220" as const,
        uAxis: [0, 1, 0] as const,
        vAxis: [0, 0, -1] as const,
        offset: [3, 4] as const,
        rotationDegrees: 30,
        scale: [4, 8] as const,
      },
      surface: { contents: 42, flags: 2, value: 9 },
    };
    const target = {
      ...targetBrush,
      faces: targetBrush.faces.map((face) =>
        face.id === originalTarget.id ? originalTarget : face,
      ),
    };

    const projected = transferFaceAttributes(
      target,
      originalTarget.id,
      sourceFace,
      "project",
    );
    const projectedFace = projected.faces.find(
      (face) => face.id === originalTarget.id,
    )!;
    expect(projectedFace.material).toBe("SOURCE");
    expect(projectedFace.projection).toEqual(sourceFace.projection);
    expect(projectedFace.surface).toEqual({ contents: 42, flags: 7, value: 3 });

    const materialOnly = transferFaceAttributes(
      target,
      originalTarget.id,
      sourceFace,
      "material",
    );
    const materialFace = materialOnly.faces.find(
      (face) => face.id === originalTarget.id,
    )!;
    expect(materialFace.material).toBe("SOURCE");
    expect(materialFace.projection).toEqual(originalTarget.projection);
    expect(materialFace.surface).toEqual(originalTarget.surface);

    const rotated = transferFaceAttributes(
      target,
      originalTarget.id,
      sourceFace,
      "rotate",
    );
    const rotatedFace = rotated.faces.find(
      (face) => face.id === originalTarget.id,
    )!;
    const targetNormal = deriveBrush(rotated).faces.find(
      (face) => face.faceId === originalTarget.id,
    )!.normal;
    expect(
      Math.abs(dotVectors(rotatedFace.projection.uAxis, targetNormal)),
    ).toBeLessThan(1e-6);
    expect(
      Math.abs(dotVectors(rotatedFace.projection.vAxis, targetNormal)),
    ).toBeLessThan(1e-6);
    expect(rotatedFace.projection.offset).toEqual(sourceFace.projection.offset);
    expect(rotatedFace.projection.scale).toEqual(sourceFace.projection.scale);
    expect(rotatedFace.surface).toEqual({ contents: 42, flags: 7, value: 3 });
  });

  it("chains a painted transfer path across brushes and commits it as one undo step", () => {
    const ids = createSequentialIdFactory("face-transfer-chain");
    const source = createBoxBrush(
      [-64, -16, -16],
      [-32, 16, 16],
      "SOURCE",
      ids,
    );
    const first = createBoxBrush([-16, -16, -16], [16, 16, 16], "FIRST", ids);
    const second = createBoxBrush([32, -16, -16], [64, 16, 16], "SECOND", ids);
    const sourceFace = source.faces[4]!;
    const firstTarget = first.faces[0]!;
    const secondTarget = second.faces[2]!;
    const starter = createStarterDocument();
    const document = {
      ...starter,
      entities: [
        { ...starter.entities[0]!, primitives: [source, first, second] },
        ...starter.entities.slice(1),
      ],
    };
    const session = new EditorSession(document);
    const candidate = session.createFaceAttributeTransferCandidate(
      { brushId: source.id, faceId: sourceFace.id },
      [
        { brushId: first.id, faceId: firstTarget.id },
        { brushId: second.id, faceId: secondTarget.id },
      ],
      "rotate",
    )!;
    if (!("edits" in candidate))
      throw new Error("Expected a batch face transfer candidate");

    const expectedFirst = transferFaceAttributes(
      first,
      firstTarget.id,
      sourceFace,
      "rotate",
    );
    const chainedSource = expectedFirst.faces.find(
      (face) => face.id === firstTarget.id,
    )!;
    const expectedSecond = transferFaceAttributes(
      second,
      secondTarget.id,
      chainedSource,
      "rotate",
    );
    expect(candidate.edits).toHaveLength(2);
    expect(
      findBrush(candidate.document, second.id)?.faces.find(
        (face) => face.id === secondTarget.id,
      )?.projection,
    ).toEqual(
      expectedSecond.faces.find((face) => face.id === secondTarget.id)
        ?.projection,
    );

    session.commitCandidate(candidate);
    expect(session.document.revision).toBe(1);
    expect(session.undoLabel).toBe("Transfer face attributes");
    expect(findBrush(session.document, first.id)?.faces[0]?.material).toBe(
      "SOURCE",
    );
    expect(findBrush(session.document, second.id)?.faces[2]?.material).toBe(
      "SOURCE",
    );
    expect(session.undo()).toBe(true);
    expect(findBrush(session.document, first.id)?.faces[0]?.material).toBe(
      "FIRST",
    );
    expect(findBrush(session.document, second.id)?.faces[2]?.material).toBe(
      "SECOND",
    );
  });

  it("aligns one face directly and every face in an object selection atomically", () => {
    const brush = createBoxBrush([-16, -16, -16], [16, 16, 16], "ALIGN");
    const face = brush.faces[4]!;
    const rotated = alignFaceTexture(brush, face.id, "rotate-ccw");
    const rotatedFace = rotated.faces[4]!;
    expect(rotatedFace.projection.rotationDegrees).toBe(
      face.projection.rotationDegrees + 90,
    );
    expect(rotatedFace.projection.uAxis).not.toEqual(face.projection.uAxis);
    expect(
      alignFaceTexture(rotated, face.id, "flip-u").faces[4]?.projection.scale,
    ).toEqual([-face.projection.scale[0], face.projection.scale[1]]);

    const ids = createSequentialIdFactory("object-texture-align");
    const first = createBoxBrush([-48, -16, -16], [-16, 16, 16], "FIRST", ids);
    const second = createBoxBrush([16, -16, -16], [48, 16, 16], "SECOND", ids);
    const starter = createStarterDocument();
    const document = {
      ...starter,
      entities: [
        { ...starter.entities[0]!, primitives: [first, second] },
        ...starter.entities.slice(1),
      ],
    };
    const session = new EditorSession(document);
    session.selectBrush(first.id);
    session.selectBrush(second.id, true);

    expect(session.alignTexture("flip-v")).toBe(true);
    expect(
      [first.id, second.id].every((brushId) =>
        findBrush(session.document, brushId)?.faces.every(
          (candidate) => candidate.projection.scale[1] === -1,
        ),
      ),
    ).toBe(true);
    expect(session.document.revision).toBe(1);
    expect(session.undoLabel).toBe("Flip texture vertically");
    expect(session.undo()).toBe(true);
    expect(
      [first.id, second.id].every((brushId) =>
        findBrush(session.document, brushId)?.faces.every(
          (candidate) => candidate.projection.scale[1] === 1,
        ),
      ),
    ).toBe(true);
  });

  it("cycles edge alignment, atlas justification, repeats, subdivisions, and auto-fit", () => {
    const brush = createBoxBrush([-16, -16, -16], [16, 16, 16], "LAYOUT");
    const face = brush.faces[4]!;
    const textureSize = [64, 64] as const;
    expect(() => alignFaceTexture(brush, face.id, "fit-u")).toThrow(
      "Texture dimensions for LAYOUT are required",
    );

    const edgeAligned = alignFaceTexture(brush, face.id, "align-edge");
    const alignedFace = edgeAligned.faces[4]!;
    const edges = deriveBrush(edgeAligned).faces.find(
      (candidate) => candidate.faceId === face.id,
    )!.vertices;
    expect(alignedFace.projection.uAxis).not.toEqual(face.projection.uAxis);
    expect(
      edges.some((vertex, index) => {
        const next = edges[(index + 1) % edges.length]!;
        const edge = next.map(
          (component, axis) => component - vertex[axis]!,
        ) as [number, number, number];
        return (
          Math.abs(
            dotVectors(normalizeVector(edge), alignedFace.projection.uAxis),
          ) > 0.999
        );
      }),
    ).toBe(true);

    const justified = alignFaceTexture(brush, face.id, "justify-u-min", {
      textureSize,
    });
    expect(faceTextureBounds(justified, face.id).min[0]).toBeCloseTo(0);
    const nextAtlasSlot = alignFaceTexture(
      justified,
      face.id,
      "justify-u-min",
      { textureSize },
    );
    expect(faceTextureBounds(nextAtlasSlot, face.id).min[0]).toBeCloseTo(32);
    const previousAtlasSlot = alignFaceTexture(
      nextAtlasSlot,
      face.id,
      "justify-u-min",
      {
        textureSize,
        direction: -1,
      },
    );
    expect(faceTextureBounds(previousAtlasSlot, face.id).min[0]).toBeCloseTo(0);

    const fitted = alignFaceTexture(brush, face.id, "fit-u", { textureSize });
    let bounds = faceTextureBounds(fitted, face.id);
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(64);
    const repeated = alignFaceTexture(fitted, face.id, "fit-u", {
      textureSize,
    });
    bounds = faceTextureBounds(repeated, face.id);
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(128);
    const subdivided = alignFaceTexture(brush, face.id, "fit-u", {
      textureSize,
      fitMode: "subdivide",
    });
    bounds = faceTextureBounds(subdivided, face.id);
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(64 / 3);

    const autoFitted = alignFaceTexture(brush, face.id, "auto-fit", {
      textureSize,
    });
    bounds = faceTextureBounds(autoFitted, face.id);
    expect(bounds.min[0]).toBeCloseTo(0);
    expect(bounds.min[1]).toBeCloseTo(0);
    expect(bounds.max[0]).toBeCloseTo(64);
    expect(bounds.max[1]).toBeCloseTo(64);
  });
});
