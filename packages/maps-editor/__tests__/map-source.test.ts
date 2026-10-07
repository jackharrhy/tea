import { describe, expect, it } from "vitest";

import {
  createStarterDocument,
  createSequentialIdFactory,
  deriveEditorIssues,
  derivePatch,
  mapSourceFingerprint,
  parseMapSource,
  parseMapFragment,
  planMapSave,
  rebaseMapSource,
  serializeMap,
  type MapDocument,
} from "../src/core/index.js";

const SOURCE = [
  "// retained header",
  "{",
  '"classname" "worldspawn" // retained property comment',
  '"message" "before"',
  "editor_data",
  "{",
  '  "future" "value"',
  "}",
  "}",
  "{",
  '"classname" "light"',
  '"origin" "0 0 32"',
  "}",
  "",
].join("\n");

const CLASSIC_SOURCE = [
  "// classic source must remain classic",
  "{",
  '  "classname" "worldspawn"',
  '  "message" "before"',
  "  {",
  "    ( 0 0 0 ) ( 0 64 0 ) ( 0 0 64 ) STONE 8 16 0 1 1",
  "  }",
  "}",
  "",
].join("\n");

function replaceEntityProperties(
  document: MapDocument,
  entityIndex: number,
  properties: Readonly<Record<string, string>>,
): MapDocument {
  return {
    ...document,
    revision: document.revision + 1,
    entities: document.entities.map((entity, index) =>
      index === entityIndex ? { ...entity, properties } : entity,
    ),
  };
}

describe("source-backed map saving", () => {
  it("keeps classic axial projection stable across normalized plane rounding", () => {
    const source = [
      "{",
      '"classname" "worldspawn"',
      "{",
      "( -414.89602728784894 51.040974600749166 -184 ) ( -460.1508612837879 96.29580859668829 -248 ) ( -460.1508612837879 96.29580859668829 -184 ) crate0_side -55.81717 -56 180 0.70710677 -1",
      "( -460.1508612837879 96.29580859668829 -184 ) ( -414.89602728784894 51.040974600749166 -184 ) ( -460.1508612837879 96.29580859668829 -120 ) crate0_side 0 0 0 1 1",
      "( -460.1508612837879 96.29580859668829 -248 ) ( -414.89602728784894 51.040974600749166 -184 ) ( -460.1508612837879 96.29580859668829 -120 ) crate0_side 0 0 0 1 1",
      "( -500 0 -300 ) ( -500 0 -100 ) ( -300 0 -300 ) crate0_side 0 0 0 1 1",
      "}",
      "}",
    ].join("\n");
    const firstBrush =
      parseMapSource(source).document.entities[0]!.primitives[0]!;
    const reparsedBrush = parseMapSource(
      serializeMap(parseMapSource(source).document),
    ).document.entities[0]!.primitives[0]!;
    if (firstBrush.kind !== "brush" || reparsedBrush.kind !== "brush") {
      throw new Error("Expected classic brushes");
    }
    const first = firstBrush.faces[0]!;
    const reparsed = reparsedBrush.faces[0]!;

    const alignment = first.projection.uAxis.reduce(
      (sum, component, index) =>
        sum + component * reparsed.projection.uAxis[index]!,
      0,
    );
    expect(alignment).toBeGreaterThan(0.999999);
  });

  it("parses brush-only fragments through an explicit interchange contract", () => {
    const fragment = parseMapFragment(
      [
        "{",
        "( 0 0 0 ) ( 0 64 0 ) ( 0 0 64 ) STONE 0 0 0 1 1",
        "( 64 0 0 ) ( 64 0 64 ) ( 64 64 0 ) STONE 0 0 0 1 1",
        "( 0 0 0 ) ( 0 0 64 ) ( 64 0 0 ) STONE 0 0 0 1 1",
        "( 0 64 0 ) ( 64 64 0 ) ( 0 64 64 ) STONE 0 0 0 1 1",
        "( 0 0 0 ) ( 64 0 0 ) ( 0 64 0 ) STONE 0 0 0 1 1",
        "( 0 0 64 ) ( 0 64 64 ) ( 64 0 64 ) STONE 0 0 0 1 1",
        "}",
      ].join("\n"),
    );

    expect(fragment).toMatchObject({
      format: "quake-map",
      faceSyntax: "quake",
    });
    expect(fragment.primitives).toHaveLength(1);
  });

  it("parses and source-preserves idTech 3 patches semantically", () => {
    const source = [
      "{",
      '"classname" "worldspawn"',
      "{",
      "patchDef2",
      "{",
      "textures/common/caulk",
      "( 3 3 0 0 0 )",
      "(",
      "( ( 0 0 0 0 0 ) ( 64 0 0 1 0 ) ( 128 0 0 2 0 ) )",
      "( ( 0 64 0 0 1 ) ( 64 64 16 1 1 ) ( 128 64 0 2 1 ) )",
      "( ( 0 128 0 0 2 ) ( 64 128 0 1 2 ) ( 128 128 0 2 2 ) )",
      ")",
      "}",
      "}",
      '"message" "retained"',
      "}",
      "",
    ].join("\n");
    const parsed = parseMapSource(source);

    const primitive = parsed.document.entities[0]?.primitives[0];
    expect(primitive).toMatchObject({
      kind: "patch",
      material: "textures/common/caulk",
      dimensions: [3, 3],
    });
    expect(
      primitive?.kind === "patch" ? primitive.controlPoints[1]?.[1] : null,
    ).toEqual({
      position: [64, 64, 16],
      uv: [1, 1],
    });
    if (primitive?.kind !== "patch") throw new Error("Expected patch");
    const derived = derivePatch(primitive);
    expect(derived).toMatchObject({
      valid: true,
      bounds: { min: [0, 0, 0], max: [128, 128, 4] },
    });
    expect(derived.triangles).toHaveLength(96);
    expect(parsed.source.diagnostics).toEqual([]);
    expect(planMapSave(parsed.document, parsed.source)).toEqual({
      status: "safe",
      text: source,
      diagnostics: [],
    });
    const edited = replaceEntityProperties(parsed.document, 0, {
      ...parsed.document.entities[0]!.properties,
      message: "changed around patch",
    });
    const editedPlan = planMapSave(edited, parsed.source);
    expect(editedPlan.status).toBe("safe");
    if (editedPlan.status === "safe")
      expect(editedPlan.text).toContain("patchDef2");
    expect(
      parseMapSource(serializeMap(parsed.document)).document.entities[0]
        ?.primitives[0],
    ).toMatchObject(primitive);
  });

  it("parses structurally valid maps before reporting playable-world issues", () => {
    const parsed = parseMapSource(
      ["{", '"classname" "light"', '"origin" "0 0 64"', "}", ""].join("\n"),
    );

    expect(parsed.document.entities).toHaveLength(1);
    expect(
      deriveEditorIssues(parsed.document).map((issue) => issue.type),
    ).toContain("missing-worldspawn");
  });

  it("parses and normalizes idTech 3 brush definitions semantically", () => {
    const source = [
      "{",
      '"classname" "worldspawn"',
      "{",
      "brushDef",
      "{",
      "( 64 0 0 ) ( 64 0 64 ) ( 64 64 0 ) ( ( 0.5 0 8 ) ( 0 0.5 16 ) ) common/caulk 1 2 3",
      "}",
      "}",
      "}",
      "",
    ].join("\n");
    const parsed = parseMapSource(source);
    const primitive = parsed.document.entities[0]?.primitives[0];

    expect(primitive).toMatchObject({
      kind: "brush-def",
      faces: [
        {
          textureMatrix: [
            [0.5, 0, 8],
            [0, 0.5, 16],
          ],
          material: "common/caulk",
          surface: { contents: 1, flags: 2, value: 3 },
        },
      ],
    });
    expect(
      parseMapSource(serializeMap(parsed.document)).document.entities[0]
        ?.primitives[0],
    ).toMatchObject(primitive!);
  });

  it("preserves unknown nested primitives opaquely", () => {
    const source = [
      "{",
      '"classname" "worldspawn"',
      "{",
      "futureDef",
      "{",
      "( 1 2 3 )",
      "}",
      "}",
      "}",
      "",
    ].join("\n");
    const parsed = parseMapSource(source);

    expect(parsed.document.entities[0]?.primitives).toEqual([]);
    expect(parsed.source.entities[0]?.opaque).toMatchObject([
      { keyword: "futureDef" },
    ]);
    expect(planMapSave(parsed.document, parsed.source)).toMatchObject({
      status: "safe",
      text: source,
    });
  });

  it("uses source headers and QuArK comments as lexical metadata", () => {
    const parsed = parseMapSource(
      [
        "; generated by QuArK",
        "// Format: Valve",
        "{",
        '"classname" "worldspawn"',
        "}",
        "",
      ].join("\n"),
    );

    expect(parsed.document.faceSyntax).toBe("valve-220");
  });

  it("returns unedited source byte-for-byte", () => {
    const parsed = parseMapSource(SOURCE);
    const plan = planMapSave(parsed.document, parsed.source);

    expect(plan).toEqual({ status: "safe", text: SOURCE, diagnostics: [] });
    expect(parsed.source.diagnostics).toMatchObject([
      { code: "unsupported-construct", keyword: "editor_data" },
    ]);
  });

  it("patches changed properties while retaining comments and opaque blocks", () => {
    const parsed = parseMapSource(SOURCE);
    const worldspawn = parsed.document.entities[0]!;
    const edited = replaceEntityProperties(parsed.document, 0, {
      ...worldspawn.properties,
      message: "after",
      wad: "base.wad;mod.wad",
    });
    const plan = planMapSave(edited, parsed.source);

    expect(plan.status).toBe("safe");
    if (plan.status !== "safe") return;
    expect(plan.text).toContain("// retained header");
    expect(plan.text).toContain("// retained property comment");
    expect(plan.text).toContain('editor_data\n{\n  "future" "value"\n}');
    expect(plan.text).toContain('"message" "after"');
    expect(plan.text).toContain('"wad" "base.wad;mod.wad"');

    const rebased = rebaseMapSource(edited, plan.text);
    expect(rebased.originalDocument.entities[0]?.id).toBe(worldspawn.id);
    expect(planMapSave(edited, rebased)).toMatchObject({
      status: "safe",
      text: plan.text,
    });
  });

  it("blocks reordering existing entities and provides a normalized copy", () => {
    const parsed = parseMapSource(SOURCE);
    const reordered = {
      ...parsed.document,
      revision: 1,
      entities: [parsed.document.entities[1]!, parsed.document.entities[0]!],
    };
    const plan = planMapSave(reordered, parsed.source);

    expect(plan).toMatchObject({
      status: "blocked",
      diagnostics: [{ code: "unsafe-source-edit" }],
    });
    if (plan.status === "blocked")
      expect(plan.normalizedText).toContain('"classname" "light"');
  });

  it("blocks deletion when an entity owns opaque source that cannot be reanchored", () => {
    const parsed = parseMapSource(SOURCE);
    const removedOwner: MapDocument = {
      ...parsed.document,
      revision: 1,
      entities: parsed.document.entities.slice(1),
    };

    expect(planMapSave(removedOwner, parsed.source)).toMatchObject({
      status: "blocked",
      diagnostics: [
        {
          code: "unsafe-source-edit",
          message: expect.stringMatching(/cannot be reanchored/),
        },
      ],
    });
  });

  it("fingerprints the exact opened bytes", () => {
    expect(mapSourceFingerprint(`${SOURCE}\n`)).not.toBe(
      mapSourceFingerprint(SOURCE),
    );
  });

  it("keeps classic face syntax and CRLF bytes when an unrelated property changes", () => {
    const source = CLASSIC_SOURCE.replaceAll("\n", "\r\n");
    const parsed = parseMapSource(source);
    const edited = replaceEntityProperties(parsed.document, 0, {
      ...parsed.document.entities[0]!.properties,
      message: "after",
    });
    const plan = planMapSave(edited, parsed.source);

    expect(parsed.document.format).toBe("quake-map");
    expect(parsed.document.faceSyntax).toBe("quake");
    expect(plan.status).toBe("safe");
    if (plan.status !== "safe") return;
    expect(plan.text).toContain(
      "( 0 0 0 ) ( 0 64 0 ) ( 0 0 64 ) STONE 8 16 0 1 1\r\n",
    );
    expect(plan.text).not.toContain("[ 0 1 0");
    expect(plan.text.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("preserves alpha-test material tokens that begin with a structural brace", () => {
    const source = CLASSIC_SOURCE.replace("STONE 8 16", "{char_trans 8 16");
    const parsed = parseMapSource(source);
    const plan = planMapSave(parsed.document, parsed.source);

    const primitive = parsed.document.entities[0]?.primitives[0];
    expect(
      primitive?.kind === "brush" ? primitive.faces[0]?.material : null,
    ).toBe("{char_trans");
    expect(plan).toEqual({ status: "safe", text: source, diagnostics: [] });
  });

  it("converts classic faces only after the document format is explicitly changed", () => {
    const parsed = parseMapSource(CLASSIC_SOURCE);
    const converted = {
      ...parsed.document,
      revision: 1,
      faceSyntax: "valve-220" as const,
    };
    const plan = planMapSave(converted, parsed.source);

    expect(plan.status).toBe("safe");
    if (plan.status !== "safe") return;
    expect(plan.text).toContain("STONE [");
  });

  it("patches one changed face without normalizing sibling brushes or comments", () => {
    const starter = createStarterDocument();
    const source = serializeMap(starter).replace(
      '\n{\n"classname" "info_player_start"',
      '\n// untouched entity boundary\n{\n"classname" "info_player_start"',
    );
    const parsed = parseMapSource(source);
    const edited: MapDocument = {
      ...parsed.document,
      revision: 1,
      entities: parsed.document.entities.map((entity, entityIndex) =>
        entityIndex === 0
          ? {
              ...entity,
              primitives: entity.primitives.map((brush, brushIndex) =>
                brushIndex === 0 && brush.kind === "brush"
                  ? {
                      ...brush,
                      revision: brush.revision + 1,
                      faces: brush.faces.map((face, faceIndex) =>
                        faceIndex === 0
                          ? { ...face, material: "CHANGED_FACE" }
                          : face,
                      ),
                    }
                  : brush,
              ),
            }
          : entity,
      ),
    };
    const plan = planMapSave(edited, parsed.source);

    expect(plan.status).toBe("safe");
    if (plan.status !== "safe") return;
    expect(plan.text).toContain("CHANGED_FACE");
    expect(plan.text).toContain("// untouched entity boundary");
    const untouchedFace = serializeMap(starter).split("\n")[10]!;
    expect(plan.text).toContain(untouchedFace);
  });

  it("source-patches inserted and removed nodes but blocks retained brush reordering", () => {
    const parsed = parseMapSource(serializeMap(createStarterDocument()));
    const insertedIds = createSequentialIdFactory("source-insert");
    const worldspawn = parsed.document.entities[0]!;
    const withoutBrush: MapDocument = {
      ...parsed.document,
      revision: 1,
      entities: [
        { ...worldspawn, primitives: worldspawn.primitives.slice(1) },
        ...parsed.document.entities.slice(1),
      ],
    };
    const removed = planMapSave(withoutBrush, parsed.source);
    expect(removed.status).toBe("safe");

    const inserted: MapDocument = {
      ...parsed.document,
      revision: 1,
      entities: [
        ...parsed.document.entities,
        {
          id: insertedIds.entity(),
          properties: { classname: "info_null", targetname: "pasted" },
          primitives: [],
        },
      ],
    };
    const added = planMapSave(inserted, parsed.source);
    expect(added.status).toBe("safe");
    if (added.status === "safe")
      expect(added.text).toContain('"targetname" "pasted"');

    const reordered: MapDocument = {
      ...parsed.document,
      revision: 1,
      entities: [
        { ...worldspawn, primitives: worldspawn.primitives.toReversed() },
        ...parsed.document.entities.slice(1),
      ],
    };
    expect(planMapSave(reordered, parsed.source)).toMatchObject({
      status: "blocked",
      diagnostics: [{ code: "unsafe-source-edit" }],
    });
  });
});
