import { describe, expect, it } from "vitest";

import {
  EditorSession,
  brushesInDocument,
  createBoxBrush,
  createObjectSelection,
  createSequentialIdFactory,
  createStarterDocument,
  deriveEditorLayers,
  documentWithoutOmittedLayers,
  findBrush,
  isEditorGroupEntity,
  isEditorLayerEntity,
  parseMap,
  querySelectionBrushes,
  serializeMap,
  selectedBrushIds,
  selectedPointEntityIds,
  type MapDocument,
} from "../src/core/index.js";
import {
  selectionQueryFixture,
  layerFixture,
} from "./support/core-fixtures.js";

describe("TrenchBroom-compatible layers", () => {
  it("derives recursive layer membership and preserves metadata through map serialization", () => {
    const fixture = layerFixture();
    const document: MapDocument = {
      ...fixture.document,
      entities: fixture.document.entities.map((entity) =>
        entity.id === fixture.layerEntity.id
          ? {
              ...entity,
              properties: {
                ...entity.properties,
                _tb_layer_hidden: "1",
                _tb_layer_locked: "1",
                _tb_layer_omit_from_export: "1",
              },
            }
          : entity,
      ),
    };

    expect(isEditorLayerEntity(fixture.layerEntity)).toBe(true);
    const layers = deriveEditorLayers(document);
    expect(layers.map((layer) => layer.name)).toEqual([
      "Default Layer",
      "Architecture",
    ]);
    expect(layers[0]).toMatchObject({
      id: null,
      brushIds: [fixture.defaultBrush.id],
    });
    expect(layers[1]).toMatchObject({
      id: "7",
      entityId: fixture.layerEntity.id,
      sortIndex: 3,
      hidden: true,
      locked: true,
      omitFromExport: true,
      groupIds: ["8", "9"],
      bounds: { min: [-32, -32, 0], max: [160, 104, 56] },
    });
    expect(new Set(layers[1]!.brushIds)).toEqual(
      new Set([
        fixture.layerBrush.id,
        fixture.detailBrush.id,
        fixture.groupBrush.id,
        fixture.nestedBrush.id,
      ]),
    );
    expect(new Set(layers[1]!.entityIds)).toEqual(
      new Set([fixture.detail.id, fixture.marker.id, fixture.groupedMarker.id]),
    );

    const reparsed = parseMap(
      serializeMap(document),
      createSequentialIdFactory("layers-reparsed"),
    );
    expect(deriveEditorLayers(reparsed)).toMatchObject([
      {
        name: "Default Layer",
        brushIds: expect.arrayContaining([expect.any(String)]),
      },
      {
        id: "7",
        name: "Architecture",
        hidden: true,
        locked: true,
        omitFromExport: true,
        groupIds: ["8", "9"],
        brushIds: expect.arrayContaining([
          expect.any(String),
          expect.any(String),
          expect.any(String),
          expect.any(String),
        ]),
      },
    ]);
  });

  it("uses the active layer for insertion and paste, and applies layer visibility to editing", () => {
    const fixture = layerFixture();
    const session = new EditorSession(fixture.document);
    const ids = createSequentialIdFactory("layer-session");
    const gameplayId = session.createLayer("Gameplay", ids);

    expect(session.activeLayerId).toBe(gameplayId);
    const createdBrush = createBoxBrush(
      [192, -32, 0],
      [224, 32, 32],
      "GAMEPLAY",
      ids,
    );
    session.commitCreationCandidate(session.createBrushCandidate(createdBrush));
    expect(session.createPointEntity("light", [208, 96, 32], ids)).toBe(true);
    const createdPointId = session.selection!.entityId!;
    expect(
      deriveEditorLayers(session.document).find(
        (layer) => layer.id === gameplayId,
      ),
    ).toMatchObject({
      brushIds: [createdBrush.id],
      pointEntityIds: [createdPointId],
    });
    expect(
      session.document.entities.find((entity) => entity.id === createdPointId)!
        .properties["_tb_layer"],
    ).toBe(gameplayId);

    const beforePaste = deriveEditorLayers(session.document).find(
      (layer) => layer.id === gameplayId,
    )!;
    expect(
      session.pasteObjects(
        createStarterDocument(),
        createSequentialIdFactory("layer-paste"),
      ),
    ).toBe(true);
    const afterPaste = deriveEditorLayers(session.document).find(
      (layer) => layer.id === gameplayId,
    )!;
    expect(afterPaste.brushIds.length).toBeGreaterThan(
      beforePaste.brushIds.length,
    );
    expect(afterPaste.pointEntityIds.length).toBeGreaterThan(
      beforePaste.pointEntityIds.length,
    );

    session.selectBrush(fixture.layerBrush.id);
    expect(session.moveSelectedToLayer(gameplayId)).toBe(true);
    expect(
      deriveEditorLayers(session.document)
        .find((layer) => layer.id === gameplayId)!
        .brushIds.includes(fixture.layerBrush.id),
    ).toBe(true);
    expect(session.setLayerFlag(gameplayId, "hidden", true)).toBe(true);
    expect(session.selection).toBeNull();
    expect(session.objectViewState.hiddenBrushIds).toContain(createdBrush.id);
    expect(() => session.selectBrush(createdBrush.id)).toThrow(
      /hidden or locked brush/,
    );
    expect(session.setLayerFlag(gameplayId, "hidden", false)).toBe(true);
    expect(session.setLayerFlag(gameplayId, "locked", true)).toBe(true);
    expect(() => session.selectPointEntity(createdPointId)).toThrow(
      /hidden or locked point entity/,
    );
    expect(session.setLayerFlag(gameplayId, "locked", false)).toBe(true);
    expect(session.selectAllInLayer(gameplayId)).not.toBeNull();
  });

  it("moves custom-layer contents to Default when removing a layer and restores them on undo", () => {
    const fixture = layerFixture();
    const session = new EditorSession(fixture.document);

    expect(session.removeLayer("7")).toBe(true);
    expect(deriveEditorLayers(session.document)).toHaveLength(1);
    expect(
      session.document.entities[0]!.primitives.some(
        (brush) => brush.id === fixture.layerBrush.id,
      ),
    ).toBe(true);
    expect(
      session.document.entities.find(
        (entity) => entity.id === fixture.detail.id,
      )!.properties["_tb_layer"],
    ).toBeUndefined();
    expect(
      session.document.entities.find(
        (entity) => entity.id === fixture.rootGroup.id,
      )!.properties["_tb_layer"],
    ).toBeUndefined();

    expect(session.undo()).toBe(true);
    expect(
      deriveEditorLayers(session.document).map((layer) => layer.id),
    ).toEqual([null, "7"]);
    expect(
      session.document.entities.find(
        (entity) => entity.id === fixture.rootGroup.id,
      )!.properties["_tb_layer"],
    ).toBe("7");
  });

  it("keeps grouping and ungrouping structural objects inside their custom layer", () => {
    const fixture = layerFixture();
    const session = new EditorSession(fixture.document);
    const ids = createSequentialIdFactory("layer-grouping");
    session.setActiveLayer("7");
    session.select(
      createObjectSelection([fixture.layerBrush.id], [fixture.marker.id]),
    );

    const groupId = session.groupSelected("Layer assembly", ids)!;
    const groupEntity = session.document.entities.find(
      (entity) => entity.properties["_tb_id"] === groupId,
    )!;
    expect(groupEntity.properties["_tb_layer"]).toBe("7");
    expect(groupEntity.primitives.map((brush) => brush.id)).toEqual([
      fixture.layerBrush.id,
    ]);
    expect(
      session.document.entities.find(
        (entity) => entity.id === fixture.marker.id,
      )!.properties["_tb_group"],
    ).toBe(groupId);

    expect(session.ungroupSelected(groupId)).toBe(true);
    expect(
      session.document.entities.find(
        (entity) => entity.id === fixture.layerEntity.id,
      )!.primitives,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: fixture.layerBrush.id }),
      ]),
    );
    expect(
      session.document.entities.find(
        (entity) => entity.id === fixture.marker.id,
      )!.properties,
    ).toMatchObject({ _tb_layer: "7" });
  });

  it("filters omitted default and custom layer contents only from the compile/export document", () => {
    const fixture = layerFixture();
    const customSession = new EditorSession(fixture.document);
    expect(customSession.setLayerFlag("7", "omit-from-export", true)).toBe(
      true,
    );
    const customExport = documentWithoutOmittedLayers(customSession.document);
    expect(brushesInDocument(customExport).map((brush) => brush.id)).toEqual([
      fixture.defaultBrush.id,
    ]);
    expect(customExport.entities.some(isEditorLayerEntity)).toBe(false);
    expect(customExport.entities.some(isEditorGroupEntity)).toBe(false);
    expect(customSession.document.entities.some(isEditorLayerEntity)).toBe(
      true,
    );

    const defaultSession = new EditorSession(fixture.document);
    expect(defaultSession.setLayerFlag(null, "omit-from-export", true)).toBe(
      true,
    );
    const defaultExport = documentWithoutOmittedLayers(defaultSession.document);
    expect(
      brushesInDocument(defaultExport).some(
        (brush) => brush.id === fixture.defaultBrush.id,
      ),
    ).toBe(false);
    expect(
      defaultExport.entities.some(
        (entity) => entity.id === fixture.layerEntity.id,
      ),
    ).toBe(true);
    expect(
      deriveEditorLayers(defaultExport).find((layer) => layer.id === "7")!
        .brushIds.length,
    ).toBe(4);
  });
});

describe("object visibility and locking", () => {
  it("hides a mixed selection without dirtying the map and restores it through history", () => {
    const document = createStarterDocument();
    const brush = brushesInDocument(document)[0]!;
    const entity = document.entities.find(
      (candidate) => candidate.primitives.length === 0,
    )!;
    const selection = createObjectSelection([brush.id], [entity.id], {
      kind: "entity",
      entityId: entity.id,
    })!;
    const session = new EditorSession(document);
    session.select(selection);

    expect(session.hideSelected()).toBe(true);
    expect(session.document).toBe(document);
    expect(session.document.revision).toBe(0);
    expect(session.selection).toBeNull();
    expect(session.objectViewState).toEqual({
      hiddenBrushIds: [brush.id],
      hiddenEntityIds: [entity.id],
      lockedBrushIds: [],
      lockedEntityIds: [],
    });
    expect(() => session.selectBrush(brush.id)).toThrow(
      /hidden or locked brush/,
    );

    expect(session.undo()).toBe(true);
    expect(session.objectViewState.hiddenBrushIds).toEqual([]);
    expect(session.objectViewState.hiddenEntityIds).toEqual([]);
    expect(session.selection).toEqual(selection);
    expect(session.document.revision).toBe(0);
    expect(session.redo()).toBe(true);
    expect(session.selection).toBeNull();
    expect(session.objectViewState.hiddenBrushIds).toEqual([brush.id]);
  });

  it("isolates selected objects, shows all, and keeps both operations undoable", () => {
    const document = createStarterDocument();
    const brushes = brushesInDocument(document);
    const entity = document.entities.find(
      (candidate) => candidate.primitives.length === 0,
    )!;
    const selection = createObjectSelection([brushes[0]!.id], [entity.id], {
      kind: "brush",
      brushId: brushes[0]!.id,
    })!;
    const session = new EditorSession(document);
    session.select(selection);

    expect(session.isolateSelected()).toBe(true);
    expect(session.selection).toEqual(selection);
    expect(session.objectViewState.hiddenBrushIds).toEqual(
      brushes.slice(1).map((brush) => brush.id),
    );
    expect(session.objectViewState.hiddenEntityIds).toEqual(
      document.entities
        .filter(
          (candidate) =>
            candidate.primitives.length === 0 && candidate.id !== entity.id,
        )
        .map((candidate) => candidate.id),
    );
    expect(session.canShowAll).toBe(true);

    expect(session.showAll()).toBe(true);
    expect(session.canShowAll).toBe(false);
    expect(session.undo()).toBe(true);
    expect(session.objectViewState.hiddenBrushIds).toEqual(
      brushes.slice(1).map((brush) => brush.id),
    );
    expect(session.redo()).toBe(true);
    expect(session.objectViewState.hiddenBrushIds).toEqual([]);
  });

  it("locks mixed objects against selection and unlocks them without changing source data", () => {
    const document = createStarterDocument();
    const brush = brushesInDocument(document)[1]!;
    const entity = document.entities.find(
      (candidate) => candidate.primitives.length === 0,
    )!;
    const session = new EditorSession(document);
    session.select(createObjectSelection([brush.id], [entity.id])!);

    expect(session.lockSelected()).toBe(true);
    expect(session.selection).toBeNull();
    expect(session.objectViewState.lockedBrushIds).toEqual([brush.id]);
    expect(session.objectViewState.lockedEntityIds).toEqual([entity.id]);
    expect(session.document).toBe(document);
    expect(() => session.selectPointEntity(entity.id)).toThrow(
      /hidden or locked point entity/,
    );

    expect(session.unlockAll()).toBe(true);
    expect(session.canUnlockAll).toBe(false);
    expect(session.undo()).toBe(true);
    expect(session.objectViewState.lockedBrushIds).toEqual([brush.id]);
    expect(session.undo()).toBe(true);
    expect(session.selection).not.toBeNull();
    expect(session.objectViewState.lockedBrushIds).toEqual([]);
  });
});

describe("selection brush queries", () => {
  it("distinguishes touching, enclosed, and orthographically enclosed objects", () => {
    const { document, query, inside, crossing, elevated, marker } =
      selectionQueryFixture();

    expect(
      querySelectionBrushes(document, [query.id], { mode: "touching" }),
    ).toEqual({
      brushIds: [inside.id, crossing.id],
      entityIds: [marker.id],
    });
    expect(
      querySelectionBrushes(document, [query.id], { mode: "inside" }),
    ).toEqual({
      brushIds: [inside.id],
      entityIds: [marker.id],
    });
    expect(
      querySelectionBrushes(document, [query.id], {
        mode: "inside-projected",
        projection: "xy",
      }),
    ).toEqual({
      brushIds: [inside.id, elevated.id],
      entityIds: [marker.id],
    });
    expect(() =>
      querySelectionBrushes(document, [query.id], { mode: "inside-projected" }),
    ).toThrow(/orthographic projection/);
  });

  it("consumes selection brushes atomically, excludes locked targets, and restores through undo", () => {
    const { document, query, inside, crossing, marker } =
      selectionQueryFixture();
    const session = new EditorSession(document);
    session.selectBrush(crossing.id);
    expect(session.lockSelected()).toBe(true);
    session.selectBrush(query.id);

    const result = session.selectWithSelectionBrushes("inside");

    expect(result).toMatchObject({
      removedBrushCount: 1,
      selectedBrushCount: 1,
      selectedEntityCount: 1,
    });
    expect(findBrush(session.document, query.id)).toBeNull();
    expect(selectedBrushIds(session.selection)).toEqual([inside.id]);
    expect(selectedPointEntityIds(session.selection)).toEqual([marker.id]);
    expect(session.document.revision).toBe(1);
    expect(session.undoLabel).toBe("Select enclosed objects");

    expect(session.undo()).toBe(true);
    expect(findBrush(session.document, query.id)).not.toBeNull();
    expect(session.selection).toEqual({ brushId: query.id });
    expect(session.objectViewState.lockedBrushIds).toEqual([crossing.id]);
    expect(session.redo()).toBe(true);
    expect(findBrush(session.document, query.id)).toBeNull();
    expect(selectedBrushIds(session.selection)).toEqual([inside.id]);
  });

  it("selects all and inverts only within the editable visibility set", () => {
    const {
      document,
      query,
      inside,
      crossing,
      outside,
      elevated,
      marker,
      remoteMarker,
    } = selectionQueryFixture();
    const session = new EditorSession(document);
    session.selectBrush(outside.id);
    expect(session.hideSelected()).toBe(true);
    session.selectBrush(crossing.id);
    expect(session.lockSelected()).toBe(true);

    session.selectBrush(inside.id);
    session.invertObjectSelection();
    expect(selectedBrushIds(session.selection)).toEqual([
      query.id,
      elevated.id,
    ]);
    expect(selectedPointEntityIds(session.selection)).toEqual([
      marker.id,
      remoteMarker.id,
    ]);
    session.selectAllEditable();
    expect(selectedBrushIds(session.selection)).toEqual([
      query.id,
      inside.id,
      elevated.id,
    ]);
    expect(selectedPointEntityIds(session.selection)).toEqual([
      marker.id,
      remoteMarker.id,
    ]);
    expect(session.document).toBe(document);
  });
});
