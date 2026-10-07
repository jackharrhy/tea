import { combinedBounds } from "./math.js";
import { deriveBrush } from "./geometry.js";
import { pointEntityBounds } from "./point-entities.js";
import {
  createObjectSelection,
  selectedBrushIds,
  selectedPointEntityIds,
  type ObjectSelectionPrimary,
} from "./selection.js";
import type {
  Bounds,
  BrushId,
  EditorSelection,
  EntityId,
  IdFactory,
  MapDocument,
  MapEntity,
} from "./types.js";
import { brushesInDocument } from "./types.js";

export const TRENCHBROOM_GROUP_TYPE = "_tb_group";

const GROUP_CLASSNAME = "func_group";
const GROUP_TYPE_PROPERTY = "_tb_type";
const GROUP_NAME_PROPERTY = "_tb_name";
const GROUP_ID_PROPERTY = "_tb_id";
const GROUP_PARENT_PROPERTY = "_tb_group";
const GROUP_LINKED_ID_PROPERTY = "_tb_linked_group_id";
const GROUP_TRANSFORMATION_PROPERTY = "_tb_transformation";
const GROUP_LAYER_PROPERTY = "_tb_layer";
const TRENCHBROOM_LAYER_TYPE = "_tb_layer";

export interface EditorGroup {
  /** TrenchBroom-compatible persistent group identifier. */
  readonly id: string;
  /** Map entity carrying the group's metadata and direct structural brushes. */
  readonly entityId: EntityId;
  readonly name: string;
  readonly parentGroupId: string | null;
  /** Shared identifier for a TrenchBroom linked-group set, when this group is linked. */
  readonly linkedGroupId: string | null;
  /** Serialized TrenchBroom affine transform. Validation lives in linked-groups.ts. */
  readonly transformation: string | null;
  readonly childGroupIds: readonly string[];
  /** Regular map entities assigned directly to this group. */
  readonly directEntityIds: readonly EntityId[];
  /** Structural brushes stored directly on the group's metadata entity. */
  readonly directBrushIds: readonly BrushId[];
  /** Every descendant brush, including brushes owned by grouped brush entities. */
  readonly brushIds: readonly BrushId[];
  /** Every descendant point entity. Brush entities are represented by their brush IDs. */
  readonly pointEntityIds: readonly EntityId[];
  readonly bounds: Bounds | null;
}

export interface GroupDocumentResult {
  readonly document: MapDocument;
  readonly selection: EditorSelection | null;
  readonly groupId: string;
}

interface MutableGroup {
  readonly id: string;
  readonly entity: MapEntity;
  readonly name: string;
  readonly parentGroupId: string | null;
  readonly childGroupIds: string[];
  readonly directEntityIds: EntityId[];
  readonly directBrushIds: BrushId[];
}

function isGroupEntity(entity: MapEntity): boolean {
  return (
    entity.properties.classname === GROUP_CLASSNAME &&
    entity.properties[GROUP_TYPE_PROPERTY] === TRENCHBROOM_GROUP_TYPE &&
    Boolean(entity.properties[GROUP_ID_PROPERTY]?.trim())
  );
}

function isLayerEntity(entity: MapEntity): boolean {
  return (
    entity.properties.classname === GROUP_CLASSNAME &&
    entity.properties[GROUP_TYPE_PROPERTY] === TRENCHBROOM_LAYER_TYPE &&
    Boolean(entity.properties[GROUP_ID_PROPERTY]?.trim())
  );
}

export function isEditorGroupEntity(entity: MapEntity): boolean {
  return isGroupEntity(entity);
}

function entityWithParent(
  entity: MapEntity,
  parentGroupId: string | null,
): MapEntity {
  const properties = { ...entity.properties };
  if (parentGroupId) {
    properties[GROUP_PARENT_PROPERTY] = parentGroupId;
    delete properties[GROUP_LAYER_PROPERTY];
  } else delete properties[GROUP_PARENT_PROPERTY];
  return { ...entity, properties };
}

function entityWithLayer(entity: MapEntity, layerId: string | null): MapEntity {
  const properties = { ...entity.properties };
  delete properties[GROUP_PARENT_PROPERTY];
  if (layerId) properties[GROUP_LAYER_PROPERTY] = layerId;
  else delete properties[GROUP_LAYER_PROPERTY];
  return { ...entity, properties };
}

const editorGroupsByDocument = new WeakMap<
  MapDocument,
  readonly EditorGroup[]
>();

/** Reads regular and nested groups from TrenchBroom's documented func_group metadata. */
export function deriveEditorGroups(
  document: MapDocument,
): readonly EditorGroup[] {
  const cachedGroups = editorGroupsByDocument.get(document);
  if (cachedGroups) return cachedGroups;
  const mutable = new Map<string, MutableGroup>();
  for (const entity of document.entities) {
    if (!isGroupEntity(entity)) continue;
    const id = entity.properties[GROUP_ID_PROPERTY]!.trim();
    // Keep the first definition deterministic when malformed input repeats a persistent ID.
    if (mutable.has(id)) continue;
    mutable.set(id, {
      id,
      entity,
      name: entity.properties[GROUP_NAME_PROPERTY] ?? "Group",
      parentGroupId: entity.properties[GROUP_PARENT_PROPERTY]?.trim() || null,
      childGroupIds: [],
      directEntityIds: [],
      directBrushIds: entity.primitives.map((brush) => brush.id),
    });
  }

  for (const group of mutable.values()) {
    if (group.parentGroupId && mutable.has(group.parentGroupId)) {
      mutable.get(group.parentGroupId)!.childGroupIds.push(group.id);
    }
  }
  for (const entity of document.entities) {
    if (isGroupEntity(entity)) continue;
    const parentId = entity.properties[GROUP_PARENT_PROPERTY]?.trim();
    if (parentId && mutable.has(parentId))
      mutable.get(parentId)!.directEntityIds.push(entity.id);
  }

  const entityById = new Map(
    document.entities.map((entity) => [entity.id, entity] as const),
  );
  const brushById = new Map(
    brushesInDocument(document).map((brush) => [brush.id, brush] as const),
  );
  const resolved = new Map<string, EditorGroup>();
  const resolve = (
    groupId: string,
    ancestors: ReadonlySet<string>,
  ): EditorGroup => {
    const cached = resolved.get(groupId);
    if (cached) return cached;
    const source = mutable.get(groupId)!;
    const nextAncestors = new Set(ancestors).add(groupId);
    const children = source.childGroupIds
      .filter((childId) => !nextAncestors.has(childId))
      .map((childId) => resolve(childId, nextAncestors));
    const directEntities = source.directEntityIds.flatMap((entityId) => {
      const entity = entityById.get(entityId);
      return entity ? [entity] : [];
    });
    const brushes = [
      ...source.entity.primitives,
      ...directEntities.flatMap((entity) => entity.primitives),
      ...children.flatMap((child) =>
        child.brushIds.flatMap((brushId) => {
          const brush = brushById.get(brushId);
          return brush ? [brush] : [];
        }),
      ),
    ];
    const pointEntities = [
      ...directEntities.filter((entity) => pointEntityBounds(entity) !== null),
      ...children.flatMap((child) =>
        child.pointEntityIds.flatMap((entityId) => {
          const entity = entityById.get(entityId);
          return entity ? [entity] : [];
        }),
      ),
    ];
    const group: EditorGroup = {
      id: source.id,
      entityId: source.entity.id,
      name: source.name,
      parentGroupId:
        source.parentGroupId && mutable.has(source.parentGroupId)
          ? source.parentGroupId
          : null,
      linkedGroupId:
        source.entity.properties[GROUP_LINKED_ID_PROPERTY]?.trim() || null,
      transformation:
        source.entity.properties[GROUP_TRANSFORMATION_PROPERTY]?.trim() || null,
      childGroupIds: [...source.childGroupIds],
      directEntityIds: [...source.directEntityIds],
      directBrushIds: [...source.directBrushIds],
      brushIds: [...new Set(brushes.map((brush) => brush.id))],
      pointEntityIds: [...new Set(pointEntities.map((entity) => entity.id))],
      bounds: combinedBounds([
        ...brushes
          .filter((brush) => brush.kind === "brush")
          .flatMap((brush) => {
            const bounds = deriveBrush(brush).bounds;
            return bounds ? [bounds] : [];
          }),
        ...pointEntities.flatMap((entity) => {
          const bounds = pointEntityBounds(entity);
          return bounds ? [bounds] : [];
        }),
      ]),
    };
    resolved.set(groupId, group);
    return group;
  };

  const groups = [...mutable.keys()].map((groupId) =>
    resolve(groupId, new Set()),
  );
  editorGroupsByDocument.set(document, groups);
  return groups;
}

function groupPrimary(
  selection: EditorSelection | null,
): ObjectSelectionPrimary | null {
  if (selection?.brushId) return { kind: "brush", brushId: selection.brushId };
  if (selection?.entityId)
    return { kind: "entity", entityId: selection.entityId };
  return null;
}

export function selectionForEditorGroup(
  group: EditorGroup,
  primary: ObjectSelectionPrimary | null = null,
): EditorSelection | null {
  const selection = createObjectSelection(
    group.brushIds,
    group.pointEntityIds,
    primary,
  );
  return selection ? { ...selection, groupId: group.id } : null;
}

function setEquals<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return right.every((value) => values.has(value));
}

/** Returns the group represented exactly by the current aggregate object selection. */
export function selectedEditorGroup(
  document: MapDocument,
  selection: EditorSelection | null,
): EditorGroup | null {
  if (!selection || selection.faceId) return null;
  if (selection.groupId) {
    return (
      deriveEditorGroups(document).find(
        (group) => group.id === selection.groupId,
      ) ?? null
    );
  }
  const brushes = selectedBrushIds(selection);
  const entities = selectedPointEntityIds(selection);
  const matches = deriveEditorGroups(document).filter(
    (group) =>
      setEquals(group.brushIds, brushes) &&
      setEquals(group.pointEntityIds, entities),
  );
  if (matches.length === 0) return null;
  return matches.find((group) => !group.parentGroupId) ?? matches[0]!;
}

function directContainingGroupId(
  document: MapDocument,
  selection: EditorSelection,
): string | null {
  if (selection.brushId) {
    const owner = document.entities.find((entity) =>
      entity.primitives.some((brush) => brush.id === selection.brushId),
    );
    if (!owner) return null;
    return isGroupEntity(owner)
      ? owner.properties[GROUP_ID_PROPERTY]!.trim()
      : owner.properties[GROUP_PARENT_PROPERTY]?.trim() || null;
  }
  if (selection.entityId) {
    const entity = document.entities.find(
      (candidate) => candidate.id === selection.entityId,
    );
    return entity?.properties[GROUP_PARENT_PROPERTY]?.trim() || null;
  }
  return null;
}

/**
 * Resolves which closed group should absorb a viewport hit. Inside an open group, direct members
 * remain individually editable while a nested child group still selects as one object.
 */
export function editorGroupForObject(
  document: MapDocument,
  selection: EditorSelection,
  openGroupId: string | null = null,
): EditorGroup | null {
  const groups = deriveEditorGroups(document);
  const byId = new Map(groups.map((group) => [group.id, group] as const));
  let group =
    byId.get(directContainingGroupId(document, selection) ?? "") ?? null;
  if (!group) return null;
  if (!openGroupId) {
    while (group.parentGroupId && byId.has(group.parentGroupId)) {
      group = byId.get(group.parentGroupId)!;
    }
    return group;
  }
  if (group.id === openGroupId) return null;
  let child = group;
  while (child.parentGroupId && child.parentGroupId !== openGroupId) {
    const parent = byId.get(child.parentGroupId);
    if (!parent) return null;
    child = parent;
  }
  return child.parentGroupId === openGroupId ? child : null;
}

function nextPersistentGroupId(document: MapDocument): string {
  const ids = deriveEditorGroups(document)
    .map((group) => Number.parseInt(group.id, 10))
    .filter(Number.isFinite);
  return String((ids.length > 0 ? Math.max(...ids) : 0) + 1);
}

/** Creates a named group around the selected objects, retaining existing closed groups as children. */
export function groupObjects(
  document: MapDocument,
  selection: EditorSelection,
  name: string,
  ids: IdFactory,
  openGroupId: string | null = null,
  layerId: string | null = null,
): GroupDocumentResult {
  if (selection.faceId)
    throw new Error(
      "Faces must be converted to an object selection before grouping",
    );
  const selectedBrushes = new Set(selectedBrushIds(selection));
  const selectedPoints = new Set(selectedPointEntityIds(selection));
  if (selectedBrushes.size + selectedPoints.size === 0)
    throw new Error("Select objects to group");
  const existingGroups = deriveEditorGroups(document);
  const fullySelected = new Set(
    existingGroups
      .filter(
        (group) =>
          group.id !== openGroupId &&
          group.brushIds.every((brushId) => selectedBrushes.has(brushId)) &&
          group.pointEntityIds.every((entityId) =>
            selectedPoints.has(entityId),
          ) &&
          group.brushIds.length + group.pointEntityIds.length > 0,
      )
      .map((group) => group.id),
  );
  const selectedGroups = existingGroups.filter(
    (group) =>
      fullySelected.has(group.id) &&
      (!group.parentGroupId || !fullySelected.has(group.parentGroupId)),
  );
  const consumedBrushes = new Set(
    selectedGroups.flatMap((group) => group.brushIds),
  );
  const consumedPoints = new Set(
    selectedGroups.flatMap((group) => group.pointEntityIds),
  );
  const groupId = nextPersistentGroupId(document);
  const groupEntityId = ids.entity();
  const brushOwners = new Map<BrushId, MapEntity>();
  for (const entity of document.entities) {
    for (const brush of entity.primitives) brushOwners.set(brush.id, entity);
  }
  const groupedRegularEntityIds = new Set<EntityId>();
  const movedBrushIds = new Set<BrushId>();
  for (const brushId of selectedBrushes) {
    if (consumedBrushes.has(brushId)) continue;
    const owner = brushOwners.get(brushId);
    if (!owner) continue;
    if (
      owner.properties.classname === "worldspawn" ||
      isGroupEntity(owner) ||
      isLayerEntity(owner)
    ) {
      movedBrushIds.add(brushId);
    } else {
      groupedRegularEntityIds.add(owner.id);
    }
  }
  for (const entityId of selectedPoints) {
    if (!consumedPoints.has(entityId)) groupedRegularEntityIds.add(entityId);
  }
  for (const group of selectedGroups)
    groupedRegularEntityIds.add(group.entityId);

  const movedBrushes = document.entities.flatMap((entity) =>
    entity.primitives.filter((brush) => movedBrushIds.has(brush.id)),
  );
  const entities = document.entities.map((entity) => {
    const withoutMoved =
      movedBrushIds.size > 0
        ? {
            ...entity,
            primitives: entity.primitives.filter(
              (brush) => !movedBrushIds.has(brush.id),
            ),
          }
        : entity;
    return groupedRegularEntityIds.has(entity.id)
      ? entityWithParent(withoutMoved, groupId)
      : withoutMoved;
  });
  const normalizedName = name.trim() || "Group";
  const groupProperties: Record<string, string> = {
    classname: GROUP_CLASSNAME,
    [GROUP_TYPE_PROPERTY]: TRENCHBROOM_GROUP_TYPE,
    [GROUP_NAME_PROPERTY]: normalizedName,
    [GROUP_ID_PROPERTY]: groupId,
  };
  if (openGroupId) groupProperties[GROUP_PARENT_PROPERTY] = openGroupId;
  else if (layerId) groupProperties[GROUP_LAYER_PROPERTY] = layerId;
  const groupEntity: MapEntity = {
    id: groupEntityId,
    properties: groupProperties,
    primitives: movedBrushes,
  };
  const after: MapDocument = {
    ...document,
    entities: [...entities, groupEntity],
  };
  const group = deriveEditorGroups(after).find(
    (candidate) => candidate.id === groupId,
  )!;
  return {
    document: after,
    selection: selectionForEditorGroup(group, groupPrimary(selection)),
    groupId,
  };
}

/** Removes one group container without deleting any of its objects or nested child groups. */
export function ungroupObjects(
  document: MapDocument,
  groupId: string,
): GroupDocumentResult {
  const group = deriveEditorGroups(document).find(
    (candidate) => candidate.id === groupId,
  );
  if (!group) throw new Error(`Unknown group ${groupId}`);
  const groupEntity = document.entities.find(
    (entity) => entity.id === group.entityId,
  )!;
  const layerId = groupEntity.properties[GROUP_LAYER_PROPERTY]?.trim() || null;
  const parentEntity = group.parentGroupId
    ? document.entities.find(
        (entity) =>
          isGroupEntity(entity) &&
          entity.properties[GROUP_ID_PROPERTY] === group.parentGroupId,
      )
    : layerId
      ? document.entities.find(
          (entity) =>
            isLayerEntity(entity) &&
            entity.properties[GROUP_ID_PROPERTY]?.trim() === layerId,
        )
      : document.entities[0];
  if (!parentEntity) throw new Error("Worldspawn is missing");
  const directMemberIds = new Set(group.directEntityIds);
  const entities = document.entities
    .filter((entity) => entity.id !== group.entityId)
    .map((entity) => {
      let next = entity;
      if (entity.id === parentEntity.id && groupEntity.primitives.length > 0) {
        next = {
          ...next,
          primitives: [...next.primitives, ...groupEntity.primitives],
        };
      }
      if (
        directMemberIds.has(entity.id) ||
        (isGroupEntity(entity) &&
          entity.properties[GROUP_PARENT_PROPERTY] === groupId)
      ) {
        next = group.parentGroupId
          ? entityWithParent(next, group.parentGroupId)
          : entityWithLayer(next, layerId);
      }
      return next;
    });
  return {
    document: { ...document, entities },
    selection: createObjectSelection(
      group.brushIds,
      group.pointEntityIds,
      null,
    ),
    groupId,
  };
}

export function renameEditorGroup(
  document: MapDocument,
  groupId: string,
  name: string,
): MapDocument {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Enter a group name");
  let found = false;
  const entities = document.entities.map((entity) => {
    if (
      !isGroupEntity(entity) ||
      entity.properties[GROUP_ID_PROPERTY] !== groupId
    )
      return entity;
    found = true;
    return {
      ...entity,
      properties: {
        ...entity.properties,
        [GROUP_NAME_PROPERTY]: normalizedName,
      },
    };
  });
  if (!found) throw new Error(`Unknown group ${groupId}`);
  return { ...document, entities };
}

/** Moves an object selection into an existing group, preserving brush-entity ownership. */
export function moveObjectsIntoEditorGroup(
  document: MapDocument,
  selection: EditorSelection,
  groupId: string,
): MapDocument {
  if (selection.faceId)
    throw new Error("Faces cannot be moved into a group independently");
  const groups = deriveEditorGroups(document);
  const target = groups.find((group) => group.id === groupId);
  if (!target) throw new Error(`Unknown group ${groupId}`);
  const selectedGroup = selectedEditorGroup(document, selection);
  if (selectedGroup?.id === groupId) return document;
  if (selectedGroup) {
    let ancestor = target;
    while (ancestor.parentGroupId) {
      if (ancestor.parentGroupId === selectedGroup.id) {
        throw new Error("A group cannot be moved into one of its descendants");
      }
      const parent = groups.find(
        (group) => group.id === ancestor.parentGroupId,
      );
      if (!parent) break;
      ancestor = parent;
    }
  }
  const selectedBrushes = new Set(selectedBrushIds(selection));
  const selectedPoints = new Set(selectedPointEntityIds(selection));
  const movedBrushIds = new Set<BrushId>();
  const groupedEntityIds = new Set<EntityId>();
  if (selectedGroup) groupedEntityIds.add(selectedGroup.entityId);
  for (const entity of document.entities) {
    const selectedOwnedBrushes = entity.primitives.filter((brush) =>
      selectedBrushes.has(brush.id),
    );
    if (selectedOwnedBrushes.length === 0) continue;
    if (isGroupEntity(entity)) {
      if (entity.id !== target.entityId && !selectedGroup) {
        for (const brush of selectedOwnedBrushes) movedBrushIds.add(brush.id);
      }
    } else if (entity.properties.classname === "worldspawn") {
      for (const brush of selectedOwnedBrushes) movedBrushIds.add(brush.id);
    } else {
      groupedEntityIds.add(entity.id);
    }
  }
  for (const entityId of selectedPoints) groupedEntityIds.add(entityId);
  if (movedBrushIds.size === 0 && groupedEntityIds.size === 0) return document;
  const movedBrushes = document.entities.flatMap((entity) =>
    entity.primitives.filter((brush) => movedBrushIds.has(brush.id)),
  );
  const entities = document.entities.map((entity) => {
    let next = movedBrushIds.size
      ? {
          ...entity,
          primitives: entity.primitives.filter(
            (brush) => !movedBrushIds.has(brush.id),
          ),
        }
      : entity;
    if (entity.id === target.entityId && movedBrushes.length > 0) {
      next = { ...next, primitives: [...next.primitives, ...movedBrushes] };
    }
    if (groupedEntityIds.has(entity.id)) next = entityWithParent(next, groupId);
    return next;
  });
  return { ...document, entities };
}

/** Deletes a group container and every object and nested group it owns. */
export function deleteEditorGroup(
  document: MapDocument,
  groupId: string,
): MapDocument {
  const groups = deriveEditorGroups(document);
  const root = groups.find((group) => group.id === groupId);
  if (!root) throw new Error(`Unknown group ${groupId}`);
  const descendantGroupIds = new Set<string>();
  const collect = (id: string) => {
    if (descendantGroupIds.has(id)) return;
    descendantGroupIds.add(id);
    const group = groups.find((candidate) => candidate.id === id);
    for (const childId of group?.childGroupIds ?? []) collect(childId);
  };
  collect(groupId);
  const entities = document.entities.filter((entity) => {
    if (isGroupEntity(entity)) {
      return !descendantGroupIds.has(
        entity.properties[GROUP_ID_PROPERTY] ?? "",
      );
    }
    return !descendantGroupIds.has(
      entity.properties[GROUP_PARENT_PROPERTY] ?? "",
    );
  });
  return { ...document, entities };
}
