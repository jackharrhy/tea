import { describe, expect, it } from "vitest";

import {
  EditorSession,
  brushesInDocument,
  createBoxBrush,
  createObjectClipboardDocument,
  createObjectSelection,
  createBrushSelection,
  createSequentialIdFactory,
  createStarterDocument,
  deriveBrush,
  deriveEditorGroups,
  deriveEntityLinks,
  editorGroupForObject,
  findBrush,
  formatEntityOrigin,
  flipPointEntity,
  intersectPointEntityRay,
  parseEntityOrigin,
  pointEntityBounds,
  pointEntityYawDegrees,
  protectedEntityProperties,
  rotatePointEntity,
  selectedBrushIds,
  selectedEntityIdsForLinks,
  selectedEditorGroup,
  selectedPointEntityIds,
  selectionForEditorGroup,
  visibleEntityLinks,
  type MapDocument,
} from "../src/core/index.js";

describe("point and brush entities", () => {
  it("formats, bounds, and ray-picks point entities without renderer dependencies", () => {
    const entity = {
      id: createSequentialIdFactory("point-helper").entity(),
      properties: {
        classname: "light",
        origin: formatEntityOrigin([16, -32, 48]),
      },
      primitives: [],
    };

    expect(parseEntityOrigin(entity)).toEqual([16, -32, 48]);
    expect(pointEntityBounds(entity)).toEqual({
      min: [8, -40, 40],
      max: [24, -24, 56],
    });
    expect(
      intersectPointEntityRay(entity, [16, -32, 100], [0, 0, -1]),
    ).toMatchObject({
      entityId: entity.id,
      distance: 44,
      point: [16, -32, 56],
    });
    expect(
      intersectPointEntityRay(entity, [100, 100, 100], [0, 0, -1]),
    ).toBeNull();
  });

  it("derives and filters directed entity links across point and brush entity anchors", () => {
    const ids = createSequentialIdFactory("entity-links");
    const starter = createStarterDocument();
    const doorBrush = createBoxBrush([48, -16, 0], [80, 16, 64], "DOOR", ids);
    const trigger = {
      id: ids.entity(),
      properties: {
        classname: "trigger_once",
        origin: "0 0 32",
        target: "door_a",
        killtarget: "unused_a",
      },
      primitives: [],
    };
    const door = {
      id: ids.entity(),
      properties: {
        classname: "func_door",
        targetname: "door_a",
        target: "relay_a",
      },
      primitives: [doorBrush],
    };
    const relay = {
      id: ids.entity(),
      properties: {
        classname: "trigger_relay",
        origin: "128 0 32",
        targetname: "relay_a",
        target: "unused_a",
      },
      primitives: [],
    };
    const unused = {
      id: ids.entity(),
      properties: {
        classname: "info_null",
        origin: "192 0 32",
        targetname: "unused_a",
      },
      primitives: [],
    };
    const document = {
      ...starter,
      entities: [starter.entities[0]!, trigger, door, relay, unused],
    };

    const links = deriveEntityLinks(document);
    expect(deriveEntityLinks(document)).toBe(links);
    expect(links).toHaveLength(4);
    expect(links[0]).toMatchObject({
      sourceEntityId: trigger.id,
      targetEntityId: door.id,
      property: "target",
      sourceAnchor: [0, 0, 32],
      targetAnchor: [64, 0, 32],
    });
    expect(visibleEntityLinks(links, [trigger.id], "direct")).toHaveLength(2);
    expect(visibleEntityLinks(links, [trigger.id], "transitive")).toHaveLength(
      4,
    );
    expect(visibleEntityLinks(links, [], "all")).toHaveLength(4);
    expect(visibleEntityLinks(links, [trigger.id], "none")).toHaveLength(0);
    expect(
      selectedEntityIdsForLinks(document, { brushId: doorBrush.id }),
    ).toEqual([door.id]);
    expect(
      selectedEntityIdsForLinks(document, {
        brushId: doorBrush.id,
        faceId: doorBrush.faces[0]!.id,
      }),
    ).toEqual([door.id]);
  });

  it("groups mixed objects as one recursive selection and ungroups them without losing ownership", () => {
    const ids = createSequentialIdFactory("editor-groups");
    const starter = createStarterDocument();
    const worldBrush = createBoxBrush(
      [-96, -24, 0],
      [-48, 24, 48],
      "WORLD",
      ids,
    );
    const detailBrush = createBoxBrush(
      [16, -24, 0],
      [64, 24, 48],
      "DETAIL",
      ids,
    );
    const light = {
      id: ids.entity(),
      properties: { classname: "light", origin: "112 0 24" },
      primitives: [],
    };
    const detail = {
      id: ids.entity(),
      properties: { classname: "func_detail" },
      primitives: [detailBrush],
    };
    const document: MapDocument = {
      ...starter,
      entities: [
        { ...starter.entities[0]!, primitives: [worldBrush] },
        detail,
        light,
      ],
    };
    const session = new EditorSession(document);
    session.select(
      createObjectSelection([worldBrush.id, detailBrush.id], [light.id]),
    );
    const groupId = session.groupSelected("Door assembly", ids)!;

    const [group] = deriveEditorGroups(session.document);
    expect(group).toMatchObject({
      id: groupId,
      name: "Door assembly",
      directBrushIds: [worldBrush.id],
      directEntityIds: [detail.id, light.id],
      brushIds: [worldBrush.id, detailBrush.id],
      pointEntityIds: [light.id],
      bounds: { min: [-96, -24, 0], max: [120, 24, 48] },
    });
    expect(
      session.document.entities.find((entity) => entity.id === detail.id)!
        .properties["_tb_group"],
    ).toBe(groupId);
    expect(
      editorGroupForObject(session.document, { brushId: detailBrush.id }),
    ).toMatchObject({
      id: groupId,
    });
    expect(
      editorGroupForObject(
        session.document,
        { brushId: detailBrush.id },
        groupId,
      ),
    ).toBeNull();
    expect(
      selectedEditorGroup(session.document, session.selection),
    ).toMatchObject({ id: groupId });

    expect(session.translateSelected([16, 0, 0])).toBe(true);
    expect(
      deriveBrush(findBrush(session.document, worldBrush.id)!).bounds?.min[0],
    ).toBe(-80);
    expect(
      deriveBrush(findBrush(session.document, detailBrush.id)!).bounds?.min[0],
    ).toBe(32);
    expect(
      parseEntityOrigin(
        session.document.entities.find((entity) => entity.id === light.id)!,
      ),
    ).toEqual([128, 0, 24]);
    expect(session.renameGroup(groupId, "Moved assembly")).toBe(true);
    expect(deriveEditorGroups(session.document)[0]!.name).toBe(
      "Moved assembly",
    );

    expect(session.ungroupSelected(groupId)).toBe(true);
    expect(deriveEditorGroups(session.document)).toHaveLength(0);
    expect(
      session.document.entities[0]!.primitives.some(
        (brush) => brush.id === worldBrush.id,
      ),
    ).toBe(true);
    expect(
      session.document.entities.find((entity) => entity.id === detail.id)!
        .properties["_tb_group"],
    ).toBeUndefined();
    expect(selectedBrushIds(session.selection)).toEqual([
      worldBrush.id,
      detailBrush.id,
    ]);
    expect(selectedPointEntityIds(session.selection)).toEqual([light.id]);
    expect(session.undo()).toBe(true);
    expect(deriveEditorGroups(session.document)[0]!.name).toBe(
      "Moved assembly",
    );
  });

  it("copies, pastes, and duplicates point-only groups with fresh persistent group IDs", () => {
    const ids = createSequentialIdFactory("point-groups");
    const starter = createStarterDocument();
    const pointIds = starter.entities.slice(1).map((entity) => entity.id);
    const session = new EditorSession(starter);
    session.select(createObjectSelection([], pointIds));
    const sourceGroupId = session.groupSelected("Signals", ids)!;
    const clipboard = createObjectClipboardDocument(
      session.document,
      session.selection,
    )!;
    expect(deriveEditorGroups(clipboard)).toHaveLength(1);
    expect(
      clipboard.entities.find(
        (entity) => entity.properties["_tb_id"] === sourceGroupId,
      )?.primitives,
    ).toEqual([]);

    const pasted = session.createPasteCandidate(
      clipboard,
      createSequentialIdFactory("point-group-paste"),
      [256, 0, 0],
    )!;
    const pastedGroups = deriveEditorGroups(pasted.document);
    expect(pastedGroups).toHaveLength(2);
    expect(new Set(pastedGroups.map((group) => group.id)).size).toBe(2);
    expect(
      selectedEditorGroup(pasted.document, pasted.selectionAfter)?.id,
    ).not.toBe(sourceGroupId);
    session.commitDocumentCandidate(pasted);

    expect(
      session.duplicateSelected(
        createSequentialIdFactory("point-group-duplicate"),
        [0, 128, 0],
      ),
    ).toBe(true);
    expect(deriveEditorGroups(session.document)).toHaveLength(3);
    expect(
      selectedEditorGroup(session.document, session.selection),
    ).not.toBeNull();
  });

  it("creates and resolves nested groups inside an open parent editing context", () => {
    const ids = createSequentialIdFactory("nested-groups");
    const starter = createStarterDocument();
    const first = createBoxBrush([-64, -16, 0], [-32, 16, 32], "FIRST", ids);
    const second = createBoxBrush([32, -16, 0], [64, 16, 32], "SECOND", ids);
    const document: MapDocument = {
      ...starter,
      entities: [{ ...starter.entities[0]!, primitives: [first, second] }],
    };
    const session = new EditorSession(document);
    session.select(createObjectSelection([first.id, second.id], []));
    const outerId = session.groupSelected("Outer", ids)!;
    session.select({ brushId: first.id });
    const innerId = session.groupSelected("Inner", ids, outerId)!;
    const groups = deriveEditorGroups(session.document);
    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.id === innerId)).toMatchObject({
      parentGroupId: outerId,
      brushIds: [first.id],
    });
    expect(groups.find((group) => group.id === outerId)).toMatchObject({
      childGroupIds: [innerId],
      brushIds: [second.id, first.id],
    });
    expect(
      editorGroupForObject(session.document, { brushId: first.id }, outerId)
        ?.id,
    ).toBe(innerId);
    expect(
      editorGroupForObject(session.document, { brushId: second.id }, outerId),
    ).toBeNull();

    expect(session.ungroupSelected(innerId)).toBe(true);
    expect(deriveEditorGroups(session.document)).toHaveLength(1);
    expect(deriveEditorGroups(session.document)[0]!.brushIds).toEqual([
      second.id,
      first.id,
    ]);
  });

  it("keeps transformed linked duplicates synchronized while preserving protected properties", () => {
    const ids = createSequentialIdFactory("linked-groups");
    const starter = createStarterDocument();
    const doorway = createBoxBrush([-32, -16, 0], [32, 16, 64], "DOORWAY", ids);
    const marker = {
      id: ids.entity(),
      properties: {
        classname: "info_target",
        origin: "0 0 32",
        angle: "90",
        targetname: "door_a",
      },
      primitives: [],
    };
    const document: MapDocument = {
      ...starter,
      entities: [{ ...starter.entities[0]!, primitives: [doorway] }, marker],
    };
    const session = new EditorSession(document);
    session.select(createObjectSelection([doorway.id], [marker.id]));
    const sourceId = session.groupSelected("Doorway", ids)!;
    const duplicateId = session.linkedDuplicateSelected(ids, [128, 0, 0])!;
    let groups = deriveEditorGroups(session.document);
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((group) => group.linkedGroupId)).size).toBe(1);
    expect(groups.find((group) => group.id === sourceId)?.transformation).toBe(
      "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1",
    );
    expect(
      groups.find((group) => group.id === duplicateId)?.transformation,
    ).toBe("1 0 0 128 0 1 0 0 0 0 1 0 0 0 0 1");

    session.setEditingGroup(sourceId);
    session.select({ brushId: doorway.id });
    expect(session.translateSelected([0, 0, 16])).toBe(true);
    groups = deriveEditorGroups(session.document);
    const duplicate = groups.find((group) => group.id === duplicateId)!;
    const duplicateBrush = findBrush(session.document, duplicate.brushIds[0]!)!;
    expect(deriveBrush(duplicateBrush).bounds).toEqual({
      min: [96, -16, 16],
      max: [160, 16, 80],
    });
    const duplicateMarker = session.document.entities.find(
      (entity) => entity.id === duplicate.pointEntityIds[0],
    )!;
    expect(parseEntityOrigin(duplicateMarker)).toEqual([128, 0, 32]);

    session.setEditingGroup(null);
    session.select(selectionForEditorGroup(duplicate));
    expect(session.rotateSelected([128, 0, 0], 2, 90)).toBe(true);
    expect(
      deriveEditorGroups(session.document).find(
        (group) => group.id === duplicateId,
      )?.transformation,
    ).toBe("0 -1 0 128 1 0 0 0 0 0 1 0 0 0 0 1");
    session.setEditingGroup(sourceId);
    session.select({ brushId: doorway.id });
    expect(session.translateSelected([16, 0, 0])).toBe(true);
    const rotatedDuplicate = deriveEditorGroups(session.document).find(
      (group) => group.id === duplicateId,
    )!;
    expect(
      deriveBrush(findBrush(session.document, rotatedDuplicate.brushIds[0]!)!)
        .bounds,
    ).toEqual({ min: [112, -16, 16], max: [144, 48, 80] });

    session.setEditingGroup(duplicateId);
    const rotatedDuplicateMarker = session.document.entities.find(
      (entity) => entity.id === rotatedDuplicate.pointEntityIds[0],
    )!;
    session.select({ entityId: rotatedDuplicateMarker.id });
    expect(
      session.setEntityPropertyProtected(
        rotatedDuplicateMarker.id,
        "angle",
        true,
      ),
    ).toBe(true);
    expect(
      session.setEntityProperty(rotatedDuplicateMarker.id, "angle", "270"),
    ).toBe(true);
    const sourceMarker = session.document.entities.find(
      (entity) =>
        entity.id ===
        deriveEditorGroups(session.document).find(
          (group) => group.id === sourceId,
        )!.pointEntityIds[0],
    )!;
    expect(sourceMarker.properties.angle).toBe("90");

    session.setEditingGroup(sourceId);
    session.select({ entityId: sourceMarker.id });
    expect(
      session.setEntityProperty(sourceMarker.id, "targetname", "door_shared"),
    ).toBe(true);
    const refreshedDuplicate = deriveEditorGroups(session.document).find(
      (group) => group.id === duplicateId,
    )!;
    const refreshedMarker = session.document.entities.find(
      (entity) => entity.id === refreshedDuplicate.pointEntityIds[0],
    )!;
    expect(refreshedMarker.properties.targetname).toBe("door_shared");
    expect(refreshedMarker.properties.angle).toBe("270");
    expect(refreshedMarker.properties["_tb_protected_properties"]).toBe(
      "angle",
    );

    session.setEditingGroup(duplicateId);
    session.select({ entityId: refreshedMarker.id });
    expect(
      session.setEntityPropertyProtected(refreshedMarker.id, "angle", false),
    ).toBe(true);
    expect(
      session.document.entities.find(
        (entity) => entity.id === refreshedMarker.id,
      )?.properties.angle,
    ).toBe("90");
    expect(session.unlinkGroup(duplicateId)).toBe(true);
    expect(
      deriveEditorGroups(session.document).every(
        (group) => group.linkedGroupId === null,
      ),
    ).toBe(true);
    expect(session.undo()).toBe(true);
    expect(
      deriveEditorGroups(session.document).every(
        (group) => group.linkedGroupId !== null,
      ),
    ).toBe(true);
  });

  it("rebuilds nested group trees in every linked copy after component edits", () => {
    const ids = createSequentialIdFactory("nested-linked-groups");
    const starter = createStarterDocument();
    const frame = createBoxBrush([-64, -16, 0], [-32, 16, 64], "FRAME", ids);
    const inset = createBoxBrush([-16, -16, 0], [16, 16, 32], "INSET", ids);
    const document: MapDocument = {
      ...starter,
      entities: [{ ...starter.entities[0]!, primitives: [frame, inset] }],
    };
    const session = new EditorSession(document);
    session.select(createObjectSelection([frame.id, inset.id], []));
    const outerId = session.groupSelected("Door module", ids)!;
    session.select({ brushId: inset.id });
    const innerId = session.groupSelected("Inset", ids, outerId)!;
    session.select(
      selectionForEditorGroup(
        deriveEditorGroups(session.document).find(
          (group) => group.id === outerId,
        )!,
      ),
    );
    const duplicateId = session.linkedDuplicateSelected(ids, [256, 0, 0])!;

    session.setEditingGroup(outerId);
    session.select({ brushId: inset.id, faceId: inset.faces[0]!.id });
    expect(session.applyMaterial("UPDATED_INSET")).toBe(true);
    const groups = deriveEditorGroups(session.document);
    const duplicate = groups.find((group) => group.id === duplicateId)!;
    expect(duplicate.childGroupIds).toHaveLength(1);
    const duplicateInner = groups.find(
      (group) => group.id === duplicate.childGroupIds[0],
    )!;
    expect(duplicateInner.parentGroupId).toBe(duplicateId);
    expect(duplicateInner.brushIds).toHaveLength(1);
    const copiedInset = findBrush(
      session.document,
      duplicateInner.brushIds[0]!,
    )!;
    expect(copiedInset.faces[0]!.material).toBe("UPDATED_INSET");
    expect(deriveBrush(copiedInset).bounds).toEqual({
      min: [240, -16, 0],
      max: [272, 16, 32],
    });
    expect(groups.find((group) => group.id === innerId)).not.toBeNull();
    expect(session.undo()).toBe(true);
    const restoredDuplicate = deriveEditorGroups(session.document).find(
      (group) => group.id === duplicateId,
    )!;
    const restoredInner = deriveEditorGroups(session.document).find(
      (group) => group.id === restoredDuplicate.childGroupIds[0],
    )!;
    expect(
      findBrush(session.document, restoredInner.brushIds[0]!)!.faces[0]!
        .material,
    ).toBe("INSET");
  });

  it("decodes TrenchBroom protected-property lists including escaped delimiters", () => {
    const ids = createSequentialIdFactory("protected-property-list");
    expect(
      protectedEntityProperties({
        id: ids.entity(),
        properties: {
          classname: "info_target",
          _tb_protected_properties: String.raw`origin;target;with\;semicolon;path\\name`,
        },
        primitives: [],
      }),
    ).toEqual(["origin", "target", "with;semicolon", "path\\name"]);
  });

  it("rotates point origins and adapts angle, angles, and light mangle conventions", () => {
    const ids = createSequentialIdFactory("point-rotation");
    const player = {
      id: ids.entity(),
      properties: {
        classname: "info_player_start",
        origin: "16 0 8",
        angle: "30",
      },
      primitives: [],
    };
    const rotatedPlayer = rotatePointEntity(player, [0, 0, 0], 2, 90);
    expect(parseEntityOrigin(rotatedPlayer)).toEqual([0, 16, 8]);
    expect(rotatedPlayer.properties.angle).toBe("120");
    expect(pointEntityYawDegrees(rotatedPlayer)).toBe(120);
    expect(
      rotatePointEntity(player, [0, 0, 0], 2, 90, false).properties.angle,
    ).toBe("30");

    const angled = {
      id: ids.entity(),
      properties: {
        classname: "monster_ogre",
        origin: "0 0 0",
        angles: "0 0 0",
      },
      primitives: [],
    };
    expect(rotatePointEntity(angled, [0, 0, 0], 0, 15).properties.angles).toBe(
      "0 0 15",
    );
    expect(rotatePointEntity(angled, [0, 0, 0], 1, 15).properties.angles).toBe(
      "15 0 0",
    );
    expect(rotatePointEntity(angled, [0, 0, 0], 2, 15).properties.angles).toBe(
      "0 15 0",
    );

    const spotlight = {
      id: ids.entity(),
      properties: { classname: "light_spot", origin: "0 0 0", mangle: "0 0 0" },
      primitives: [],
    };
    expect(
      rotatePointEntity(spotlight, [0, 0, 0], 1, 15).properties.mangle,
    ).toBe("0 -15 0");
    expect(
      rotatePointEntity(spotlight, [0, 0, 0], 2, 15).properties.mangle,
    ).toBe("15 0 0");
  });

  it("mirrors point origins and horizontal headings using world-axis planes", () => {
    const entity = {
      id: createSequentialIdFactory("point-flip").entity(),
      properties: {
        classname: "info_player_start",
        origin: "32 16 8",
        angle: "45",
      },
      primitives: [],
    };

    const flippedX = flipPointEntity(entity, [0, 0, 0], 0);
    expect(parseEntityOrigin(flippedX)).toEqual([-32, 16, 8]);
    expect(flippedX.properties.angle).toBe("135");
    const flippedY = flipPointEntity(entity, [0, 0, 0], 1);
    expect(parseEntityOrigin(flippedY)).toEqual([32, -16, 8]);
    expect(flippedY.properties.angle).toBe("315");
    expect(flipPointEntity(entity, [0, 0, 0], 1, false).properties.angle).toBe(
      "45",
    );

    const vertical = {
      ...entity,
      properties: { ...entity.properties, angle: "-1" },
    };
    expect(flipPointEntity(vertical, [0, 0, 0], 2).properties.angle).toBe("-2");

    const euler = {
      ...entity,
      properties: {
        classname: "monster_ogre",
        origin: "0 0 0",
        angles: "45 0 10",
      },
    };
    expect(flipPointEntity(euler, [0, 0, 0], 0).properties.angles).toBe(
      "45 180 -10",
    );
  });

  it("rotates and flips mixed brush/entity selections as atomic document edits", () => {
    const document = createStarterDocument();
    const brush = brushesInDocument(document)[1]!;
    const player = document.entities.find(
      (entity) => entity.properties.classname === "info_player_start",
    )!;
    const selection = createObjectSelection([brush.id], [player.id], {
      kind: "entity",
      entityId: player.id,
    })!;
    const session = new EditorSession(document);
    session.select(selection);

    const rotation = session.createObjectRotationCandidate(
      selection,
      [0, 0, 0],
      2,
      90,
    );
    expect(rotation?.label).toBe("Rotate objects");
    expect(rotation?.document.revision).toBe(1);
    expect(
      parseEntityOrigin(
        rotation!.document.entities.find((entity) => entity.id === player.id)!,
      ),
    ).toEqual([96, 0, 24]);
    expect(
      rotation!.document.entities.find((entity) => entity.id === player.id)!
        .properties.angle,
    ).toBe("180");
    expect(deriveBrush(findBrush(rotation!.document, brush.id)!).valid).toBe(
      true,
    );

    session.commitDocumentCandidate(rotation!);
    expect(session.document.revision).toBe(1);
    expect(session.undo()).toBe(true);
    expect(
      parseEntityOrigin(
        session.document.entities.find((entity) => entity.id === player.id)!,
      ),
    ).toEqual([0, -96, 24]);
    expect(session.redo()).toBe(true);

    const flipped = session.createObjectFlipCandidate(
      session.selection!,
      [0, 0, 0],
      0,
    );
    expect(flipped?.label).toBe("Flip objects");
    expect(deriveBrush(findBrush(flipped!.document, brush.id)!).valid).toBe(
      true,
    );
    expect(
      parseEntityOrigin(
        flipped!.document.entities.find((entity) => entity.id === player.id)!,
      ),
    ).toEqual([-96, 0, 24]);
  });

  it("creates, moves, duplicates, deletes, and restores point entities transactionally", () => {
    const session = new EditorSession(createStarterDocument());
    const ids = createSequentialIdFactory("point-session");

    expect(session.createPointEntity("light", [32, 48, 64], ids)).toBe(true);
    const createdId = session.selection!.entityId!;
    expect(selectedPointEntityIds(session.selection)).toEqual([createdId]);
    expect(
      parseEntityOrigin(
        session.document.entities.find((entity) => entity.id === createdId)!,
      ),
    ).toEqual([32, 48, 64]);

    const move = session.createObjectTranslationCandidate(
      session.selection!,
      [16, -16, 32],
    );
    expect(move).not.toBeNull();
    expect(
      parseEntityOrigin(
        move!.document.entities.find((entity) => entity.id === createdId)!,
      ),
    ).toEqual([48, 32, 96]);
    session.commitDocumentCandidate(move!);
    expect(session.undo()).toBe(true);
    expect(
      parseEntityOrigin(
        session.document.entities.find((entity) => entity.id === createdId)!,
      ),
    ).toEqual([32, 48, 64]);
    expect(session.redo()).toBe(true);

    expect(session.duplicateSelected(ids, [16, 0, 0])).toBe(true);
    const duplicateId = session.selection!.entityId!;
    expect(duplicateId).not.toBe(createdId);
    expect(
      parseEntityOrigin(
        session.document.entities.find((entity) => entity.id === duplicateId)!,
      ),
    ).toEqual([64, 32, 96]);
    expect(session.deleteSelected()).toBe(true);
    expect(
      session.document.entities.some((entity) => entity.id === duplicateId),
    ).toBe(false);
    expect(session.undo()).toBe(true);
    expect(
      session.document.entities.some((entity) => entity.id === duplicateId),
    ).toBe(true);
  });

  it("converts selected brushes into a brush entity and makes them structural again", () => {
    const base = createStarterDocument();
    const sourceBrushes = brushesInDocument(base)
      .slice(0, 2)
      .map((brush) =>
        Object.assign({}, brush, {
          faces: brush.faces.map((face) =>
            Object.assign({}, face, {
              surface: { ...face.surface, contents: 1 },
            }),
          ),
        }),
      );
    const selectedById = new Map(
      sourceBrushes.map((brush) => [brush.id, brush] as const),
    );
    const document = Object.assign({}, base, {
      entities: base.entities.map((entity) => ({
        id: entity.id,
        properties: entity.properties,
        primitives: entity.primitives.map(
          (brush) => selectedById.get(brush.id) ?? brush,
        ),
      })),
    });
    const session = new EditorSession(document);
    session.select(
      createBrushSelection(sourceBrushes.map((brush) => brush.id)),
    );

    expect(
      session.createBrushEntity(
        "func_detail",
        createSequentialIdFactory("brush-entity"),
      ),
    ).toBe(true);
    const detail = session.document.entities.find(
      (entity) => entity.properties.classname === "func_detail",
    );
    expect(detail?.primitives.map((brush) => brush.id)).toEqual(
      sourceBrushes.map((brush) => brush.id),
    );
    expect(session.undo()).toBe(true);
    expect(
      session.document.entities.some(
        (entity) => entity.properties.classname === "func_detail",
      ),
    ).toBe(false);
    expect(session.redo()).toBe(true);

    expect(session.makeSelectedStructural()).toBe(true);
    const worldspawn = session.document.entities.find(
      (entity) => entity.properties.classname === "worldspawn",
    )!;
    expect(worldspawn.primitives.map((brush) => brush.id)).toEqual(
      expect.arrayContaining(sourceBrushes.map((brush) => brush.id)),
    );
    expect(
      worldspawn.primitives
        .filter((brush) => brush.kind === "brush")
        .filter((brush) => selectedById.has(brush.id))
        .every((brush) =>
          brush.faces.every((face) => face.surface.contents === undefined),
        ),
    ).toBe(true);
    expect(
      session.document.entities.some(
        (entity) => entity.properties.classname === "func_detail",
      ),
    ).toBe(false);
    expect(session.undo()).toBe(true);
    expect(
      session.document.entities.find(
        (entity) => entity.properties.classname === "func_detail",
      )?.primitives,
    ).toHaveLength(2);
  });
});
