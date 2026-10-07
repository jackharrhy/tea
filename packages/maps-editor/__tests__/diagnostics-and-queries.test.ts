import { describe, expect, it } from "vitest";

import {
  EditorSession,
  brushesInDocument,
  createFaceSelection,
  createSequentialIdFactory,
  createStarterDocument,
  deriveBrush,
  deriveEditorIssues,
  entityClassFiltersInDocument,
  findBrush,
  materialUsageInDocument,
  selectedBrushIds,
  selectedFaceReferences,
  selectedPointEntityIds,
  type MapDocument,
} from "../src/core/index.js";
import {
  repetitionFixture,
  issueFixture,
  viewFilterFixture,
  materialUsageFixture,
} from "./support/core-fixtures.js";

describe("command repetition", () => {
  it("replays a staircase-style duplicate, move, and rotate sequence as one undo step", () => {
    const { document, first } = repetitionFixture();
    const session = new EditorSession(document);
    session.selectBrush(first.id);

    expect(
      session.duplicateSelected(
        createSequentialIdFactory("repeat-first-copy"),
        [0, 0, 0],
      ),
    ).toBe(true);
    expect(session.translateSelected([64, 0, 16])).toBe(true);
    expect(session.rotateSelected([0, 0, 0], 2, 90)).toBe(true);
    expect(session.repeatCommandLabels).toEqual([
      "Duplicate",
      "Move",
      "Rotate",
    ]);
    expect(session.canRepeatCommands).toBe(true);
    expect(brushesInDocument(session.document)).toHaveLength(3);
    expect(session.document.revision).toBe(3);

    expect(session.repeatLastCommands()).toBe(true);
    expect(brushesInDocument(session.document)).toHaveLength(4);
    expect(session.document.revision).toBe(4);
    expect(session.undoLabel).toBe("Repeat 3 commands");
    expect(session.repeatCommandCount).toBe(3);
    const repeated = findBrush(
      session.document,
      selectedBrushIds(session.selection)[0]!,
    )!;
    const repeatedBounds = deriveBrush(repeated).bounds!;
    expect(repeatedBounds.min[0]).toBeCloseTo(-80);
    expect(repeatedBounds.min[1]).toBeCloseTo(48);
    expect(repeatedBounds.min[2]).toBeCloseTo(32);
    expect(repeatedBounds.max[0]).toBeCloseTo(-64);
    expect(repeatedBounds.max[1]).toBeCloseTo(64);
    expect(repeatedBounds.max[2]).toBeCloseTo(48);

    expect(session.undo()).toBe(true);
    expect(brushesInDocument(session.document)).toHaveLength(3);
    expect(session.canRepeatCommands).toBe(false);
    expect(session.repeatCommandCount).toBe(0);
    expect(session.redo()).toBe(true);
    expect(brushesInDocument(session.document)).toHaveLength(4);
  });

  it("records only committed candidates and resets after a manual selection change or clear", () => {
    const { document, first, second } = repetitionFixture();
    const session = new EditorSession(document);
    session.selectBrush(first.id);
    expect(session.translateSelected([16, 0, 0])).toBe(true);
    expect(session.repeatCommandLabels).toEqual(["Move"]);

    session.selectBrush(second.id);
    expect(session.repeatCommandCount).toBe(0);
    expect(session.repeatLastCommands()).toBe(false);
    const candidate = session.createObjectRotationCandidate(
      session.selection!,
      [0, 0, 0],
      2,
      45,
    )!;
    expect(session.repeatCommandCount).toBe(0);
    session.commitDocumentCandidate(candidate);
    expect(session.repeatCommandLabels).toEqual(["Rotate"]);
    expect(session.clearRepeatableCommands()).toBe(true);
    expect(session.canRepeatCommands).toBe(false);
    expect(session.clearRepeatableCommands()).toBe(false);
  });
});

describe("live issue diagnostics", () => {
  it("derives stable geometry, entity, link, and structure findings", () => {
    const { document, invalid, invalidOrigin, missingOrigin, unresolved } =
      issueFixture();
    const issues = deriveEditorIssues(document);
    expect(deriveEditorIssues(document).map((issue) => issue.id)).toEqual(
      issues.map((issue) => issue.id),
    );
    expect(
      issues.find((issue) => issue.type === "invalid-brush")?.brushIds,
    ).toEqual([invalid.id]);
    expect(
      issues.find((issue) => issue.type === "invalid-origin")?.entityIds,
    ).toEqual([invalidOrigin.id]);
    expect(
      issues.find((issue) => issue.type === "missing-origin")?.entityIds,
    ).toEqual([missingOrigin.id]);
    expect(
      issues.find((issue) => issue.type === "unresolved-target")?.entityIds,
    ).toEqual([unresolved.id]);
    expect(issues.some((issue) => issue.type === "empty-brush-entity")).toBe(
      true,
    );
    expect(
      issues.some(
        (issue) =>
          issue.type === "empty-brush-entity" &&
          issue.entityIds.includes(unresolved.id),
      ),
    ).toBe(false);
    expect(issues.some((issue) => issue.type === "empty-group")).toBe(true);
  });

  it("does not flag engine, wildcard, sentinel, or generated target references as unresolved", () => {
    const ids = createSequentialIdFactory("dynamic-targets");
    const starter = createStarterDocument();
    const document: MapDocument = {
      ...starter,
      entities: [
        starter.entities[0]!,
        {
          id: ids.entity(),
          properties: {
            classname: "trigger_relay",
            origin: "0 0 0",
            target: "!activator",
            killtarget: "temporary_*",
          },
          primitives: [],
        },
        {
          id: ids.entity(),
          properties: {
            classname: "multi_watcher",
            origin: "16 0 0",
            target: "<rotatable_brush.1",
          },
          primitives: [],
        },
        {
          id: ids.entity(),
          properties: {
            classname: "monstermaker",
            origin: "32 0 0",
            netname: "spawned_monster",
          },
          primitives: [],
        },
        {
          id: ids.entity(),
          properties: {
            classname: "trigger_changekeyvalue",
            origin: "64 0 0",
            target: "spawned_monster",
          },
          primitives: [],
        },
        {
          id: ids.entity(),
          properties: {
            classname: "trigger_relay",
            origin: "96 0 0",
            target: "nothing",
          },
          primitives: [],
        },
      ],
    };

    expect(
      deriveEditorIssues(document).some(
        (issue) => issue.type === "unresolved-target",
      ),
    ).toBe(false);
  });

  it("selects an invalid brush and applies its quick fix as one undoable edit", () => {
    const { document, invalid } = issueFixture();
    const session = new EditorSession(document);
    const invalidIssue = session.issues.find(
      (issue) => issue.type === "invalid-brush",
    )!;

    expect(session.selectIssue(invalidIssue.id)).toEqual({
      brushId: invalid.id,
    });
    expect(session.fixIssue(invalidIssue.id)).toBe(true);
    expect(findBrush(session.document, invalid.id)).toBeNull();
    expect(session.issues.some((issue) => issue.id === invalidIssue.id)).toBe(
      false,
    );
    expect(session.document.revision).toBe(1);
    expect(session.undoLabel).toBe("Delete invalid brush");

    expect(session.undo()).toBe(true);
    expect(findBrush(session.document, invalid.id)).not.toBeNull();
    expect(session.issues.some((issue) => issue.id === invalidIssue.id)).toBe(
      true,
    );
  });

  it("repairs invalid properties without disturbing the selected object", () => {
    const { document, invalidOrigin, unresolved } = issueFixture();
    const session = new EditorSession(document);
    const invalidOriginIssue = session.issues.find(
      (issue) => issue.type === "invalid-origin",
    )!;
    session.selectIssue(invalidOriginIssue.id);

    expect(session.fixIssue(invalidOriginIssue.id)).toBe(true);
    expect(
      session.document.entities.find(
        (entity) => entity.id === invalidOrigin.id,
      )!.properties.origin,
    ).toBe("0 0 0");
    expect(session.selection).toEqual({ entityId: invalidOrigin.id });

    const unresolvedIssue = session.issues.find(
      (issue) =>
        issue.type === "unresolved-target" &&
        issue.entityIds.includes(unresolved.id),
    )!;
    expect(session.fixIssue(unresolvedIssue.id)).toBe(true);
    expect(
      session.document.entities.find((entity) => entity.id === unresolved.id)!
        .properties.target,
    ).toBeUndefined();
  });
});

describe("live viewport filters", () => {
  it("summarizes entity definitions and filters classnames without document history", () => {
    const { document, light, monster } = viewFilterFixture();
    expect(entityClassFiltersInDocument(document)).toEqual([
      { classname: "func_detail", pointEntityCount: 0, brushEntityCount: 1 },
      { classname: "func_wall", pointEntityCount: 0, brushEntityCount: 1 },
      { classname: "light", pointEntityCount: 1, brushEntityCount: 0 },
      { classname: "monster_army", pointEntityCount: 1, brushEntityCount: 0 },
      { classname: "trigger_once", pointEntityCount: 0, brushEntityCount: 1 },
    ]);

    const session = new EditorSession(document);
    session.selectPointEntity(light.id);
    expect(session.setEntityClassVisible("LIGHT", false)).toBe(true);
    expect(session.objectViewState.hiddenEntityIds).toEqual([light.id]);
    expect(session.selection).toBeNull();
    expect(session.document).toBe(document);
    expect(session.document.revision).toBe(0);
    expect(session.canUndo).toBe(false);

    session.selectPointEntity(monster.id);
    expect(session.setEntityClassVisible("light", true)).toBe(true);
    expect(session.selection).toEqual({ entityId: monster.id });
    expect(session.objectViewState.hiddenEntityIds).toEqual([]);
  });

  it("combines special-material, entity-class, and world-brush filters for picking", () => {
    const { document, world, detail, trigger, clip, light, monster } =
      viewFilterFixture();
    const session = new EditorSession(document);

    expect(session.setSpecialBrushFilterVisible("trigger", false)).toBe(true);
    expect(session.setSpecialBrushFilterVisible("clip", false)).toBe(true);
    expect(session.setEntityClassVisible("func_detail", false)).toBe(true);
    expect(session.setEntityClassVisible("light", false)).toBe(true);
    expect(session.setWorldBrushesVisible(false)).toBe(true);
    expect(session.objectViewState.hiddenBrushIds).toEqual(
      [clip.id, detail.id, trigger.id, world.id].toSorted(),
    );
    expect(session.objectViewState.hiddenEntityIds).toEqual([light.id]);

    const selection = session.selectAllEditable();
    expect(selectedBrushIds(selection)).toEqual([]);
    expect(selectedPointEntityIds(selection)).toEqual([monster.id]);
    expect(() => session.selectBrush(trigger.id)).toThrow("hidden or locked");
    expect(() => session.selectPointEntity(light.id)).toThrow(
      "hidden or locked",
    );

    expect(session.setAllEntityClassesVisible(true)).toBe(true);
    expect(session.setSpecialBrushFilterVisible("trigger", true)).toBe(true);
    expect(session.setSpecialBrushFilterVisible("clip", true)).toBe(true);
    expect(session.setWorldBrushesVisible(true)).toBe(true);
    expect(session.filteredObjectIds).toEqual({ brushIds: [], entityIds: [] });
  });

  it("applies persistent filter settings to preview documents with new objects", () => {
    const { document } = viewFilterFixture();
    const session = new EditorSession(document);
    session.setEntityClassVisible("light", false);
    const ids = createSequentialIdFactory("filtered-preview");
    const previewLight = {
      id: ids.entity(),
      properties: { classname: "light", origin: "256 0 32" },
      primitives: [],
    };
    const preview = {
      ...document,
      entities: [...document.entities, previewLight],
    };
    expect(session.objectViewStateFor(preview).hiddenEntityIds).toContain(
      previewLight.id,
    );
  });
});

describe("material usage queries and replacement", () => {
  it("groups usage case-insensitively and selects matching visible faces or brushes", () => {
    const { document, first, second } = materialUsageFixture();
    expect(materialUsageInDocument(document)).toEqual([
      { material: "BRICK", faceCount: 10, brushCount: 2 },
      { material: "METAL", faceCount: 2, brushCount: 1 },
    ]);

    const session = new EditorSession(document);
    expect(
      selectedFaceReferences(session.selectFacesUsingMaterial("brick")),
    ).toHaveLength(10);
    expect(
      selectedBrushIds(session.selectBrushesUsingMaterial("BRICK")),
    ).toEqual([first.id, second.id]);

    session.selectBrush(first.id);
    expect(session.hideSelected()).toBe(true);
    expect(
      selectedFaceReferences(session.selectFacesUsingMaterial("brick")),
    ).toHaveLength(6);
    expect(
      selectedBrushIds(session.selectBrushesUsingMaterial("brick")),
    ).toEqual([second.id]);
    expect(session.document).toBe(document);
  });

  it("replaces a material globally and selects every changed face in one undo step", () => {
    const { document } = materialUsageFixture();
    const session = new EditorSession(document);

    expect(session.replaceMaterial("brick", "STONE", null)).toBe(10);
    expect(materialUsageInDocument(session.document)).toEqual([
      { material: "METAL", faceCount: 2, brushCount: 1 },
      { material: "STONE", faceCount: 10, brushCount: 2 },
    ]);
    expect(selectedFaceReferences(session.selection)).toHaveLength(10);
    expect(session.document.revision).toBe(1);
    expect(session.undoLabel).toBe("Replace material brick → STONE");

    expect(session.undo()).toBe(true);
    expect(materialUsageInDocument(session.document)).toEqual([
      { material: "BRICK", faceCount: 10, brushCount: 2 },
      { material: "METAL", faceCount: 2, brushCount: 1 },
    ]);
  });

  it("limits replacement to selected faces or all faces of selected brushes", () => {
    const { document, first, second } = materialUsageFixture();
    const session = new EditorSession(document);
    const selectedFace = first.faces.find((face) => face.material === "BRICK")!;
    session.select(
      createFaceSelection([{ brushId: first.id, faceId: selectedFace.id }]),
    );
    expect(session.replaceMaterial("brick", "FACE_ONLY")).toBe(1);
    expect(
      materialUsageInDocument(session.document).find(
        (usage) => usage.material === "FACE_ONLY",
      ),
    ).toEqual({ material: "FACE_ONLY", faceCount: 1, brushCount: 1 });

    session.selectBrush(second.id);
    expect(session.replaceMaterial("brick", "BRUSH_ONLY")).toBe(6);
    expect(
      materialUsageInDocument(session.document).find(
        (usage) => usage.material === "BRUSH_ONLY",
      ),
    ).toEqual({ material: "BRUSH_ONLY", faceCount: 6, brushCount: 1 });
    expect(selectedFaceReferences(session.selection)).toHaveLength(6);
  });
});
