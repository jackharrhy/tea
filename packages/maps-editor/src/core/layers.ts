import { combinedBounds } from "./math.js";
import { removeBrushes } from "./document.js";
import { deriveBrush } from "./geometry.js";
import {
  deriveEditorGroups,
  isEditorGroupEntity,
  selectedEditorGroup,
} from "./groups.js";
import { pointEntityBounds } from "./point-entities.js";
import {
  createObjectSelection,
  selectedBrushIds,
  selectedPointEntityIds,
} from "./selection.js";
import {
  brushesInDocument,
  type Bounds,
  type BrushId,
  type EditorSelection,
  type EntityId,
  type IdFactory,
  type MapDocument,
  type MapEntity,
} from "./types.js";

export const TRENCHBROOM_LAYER_TYPE = "_tb_layer";
export const TRENCHBROOM_LAYER_PROPERTY = "_tb_layer";
export const TRENCHBROOM_LAYER_SORT_INDEX = "_tb_layer_sort_index";
export const TRENCHBROOM_LAYER_HIDDEN = "_tb_layer_hidden";
export const TRENCHBROOM_LAYER_LOCKED = "_tb_layer_locked";
export const TRENCHBROOM_LAYER_OMIT_FROM_EXPORT = "_tb_layer_omit_from_export";

const LAYER_CLASSNAME = "func_group";
const TYPE_PROPERTY = "_tb_type";
const NAME_PROPERTY = "_tb_name";
const ID_PROPERTY = "_tb_id";
const GROUP_PROPERTY = "_tb_group";

export type EditorLayerId = string | null;

export interface EditorLayer {
  /** Null identifies TrenchBroom's implicit Default Layer. */
  readonly id: EditorLayerId;
  /** Null for the Default Layer, whose metadata and structural brushes live on worldspawn. */
  readonly entityId: EntityId | null;
  readonly name: string;
  readonly sortIndex: number;
  readonly hidden: boolean;
  readonly locked: boolean;
  readonly omitFromExport: boolean;
  readonly groupIds: readonly string[];
  /** Regular point and brush entities in this layer, excluding layer/group metadata entities. */
  readonly entityIds: readonly EntityId[];
  readonly brushIds: readonly BrushId[];
  readonly pointEntityIds: readonly EntityId[];
  readonly bounds: Bounds | null;
}

export interface LayerCreationResult {
  readonly document: MapDocument;
  readonly layerId: string;
}

function enabled(
  properties: Readonly<Record<string, string>>,
  key: string,
): boolean {
  return properties[key]?.trim() === "1";
}

export function isEditorLayerEntity(entity: MapEntity): boolean {
  return (
    entity.properties.classname === LAYER_CLASSNAME &&
    entity.properties[TYPE_PROPERTY] === TRENCHBROOM_LAYER_TYPE &&
    Boolean(entity.properties[ID_PROPERTY]?.trim())
  );
}

function normalizedLayerId(
  value: string | undefined,
  customLayerIds: ReadonlySet<string>,
): EditorLayerId {
  const id = value?.trim();
  return id && customLayerIds.has(id) ? id : null;
}

function groupEntityIds(
  groupId: string,
  groups: ReturnType<typeof deriveEditorGroups>,
): readonly EntityId[] {
  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group) return [];
  return [
    ...group.directEntityIds,
    ...group.childGroupIds.flatMap((childId) =>
      groupEntityIds(childId, groups),
    ),
  ];
}

function descendantGroupIds(
  groupId: string,
  groups: ReturnType<typeof deriveEditorGroups>,
): readonly string[] {
  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group) return [];
  return [
    group.id,
    ...group.childGroupIds.flatMap((childId) =>
      descendantGroupIds(childId, groups),
    ),
  ];
}

const editorLayersByDocument = new WeakMap<
  MapDocument,
  readonly EditorLayer[]
>();

/** Derives the implicit default layer and every TrenchBroom-compatible custom layer. */
export function deriveEditorLayers(
  document: MapDocument,
): readonly EditorLayer[] {
  const cached = editorLayersByDocument.get(document);
  if (cached) return cached;
  const worldspawn = document.entities.find(
    (entity) => entity.properties.classname?.toLowerCase() === "worldspawn",
  );
  if (!worldspawn) return [];
  const customEntities = document.entities.filter(isEditorLayerEntity);
  const customIds = new Set(
    customEntities.map((entity) => entity.properties[ID_PROPERTY]!.trim()),
  );
  const groups = deriveEditorGroups(document);
  const groupEntities = new Map(
    groups.map(
      (group) =>
        [
          group.id,
          document.entities.find((entity) => entity.id === group.entityId)!,
        ] as const,
    ),
  );
  const rootGroups = groups.filter((group) => !group.parentGroupId);
  const rootGroupLayer = new Map(
    rootGroups.map(
      (group) =>
        [
          group.id,
          normalizedLayerId(
            groupEntities.get(group.id)?.properties[TRENCHBROOM_LAYER_PROPERTY],
            customIds,
          ),
        ] as const,
    ),
  );
  const entityById = new Map(
    document.entities.map((entity) => [entity.id, entity] as const),
  );
  const brushById = new Map(
    brushesInDocument(document).map((brush) => [brush.id, brush] as const),
  );

  const buildLayer = (
    id: EditorLayerId,
    metadata: MapEntity,
    sortIndex: number,
  ): EditorLayer => {
    const layerGroups = rootGroups.filter(
      (group) => rootGroupLayer.get(group.id) === id,
    );
    const groupedEntityIds = new Set(
      layerGroups.flatMap((group) => groupEntityIds(group.id, groups)),
    );
    const directEntities = document.entities.filter((entity) => {
      if (
        entity.id === worldspawn.id ||
        isEditorLayerEntity(entity) ||
        isEditorGroupEntity(entity) ||
        entity.properties[GROUP_PROPERTY]?.trim()
      ) {
        return false;
      }
      return (
        normalizedLayerId(
          entity.properties[TRENCHBROOM_LAYER_PROPERTY],
          customIds,
        ) === id
      );
    });
    const regularEntityIds = [
      ...new Set([
        ...directEntities.map((entity) => entity.id),
        ...groupedEntityIds,
      ]),
    ];
    const regularEntities = regularEntityIds.flatMap((entityId) => {
      const entity = entityById.get(entityId);
      return entity ? [entity] : [];
    });
    const directStructuralBrushes =
      id === null ? worldspawn.primitives : metadata.primitives;
    const groupBrushes = layerGroups.flatMap((group) =>
      group.brushIds.flatMap((brushId) => {
        const brush = brushById.get(brushId);
        return brush ? [brush] : [];
      }),
    );
    const entityBrushes = regularEntities.flatMap(
      (entity) => entity.primitives,
    );
    const brushes = [
      ...new Map(
        [...directStructuralBrushes, ...groupBrushes, ...entityBrushes].map(
          (brush) => [brush.id, brush],
        ),
      ).values(),
    ];
    const points = regularEntities.filter(
      (entity) => pointEntityBounds(entity) !== null,
    );
    return {
      id,
      entityId: id === null ? null : metadata.id,
      name:
        id === null
          ? "Default Layer"
          : metadata.properties[NAME_PROPERTY] || "Layer",
      sortIndex,
      hidden: enabled(metadata.properties, TRENCHBROOM_LAYER_HIDDEN),
      locked: enabled(metadata.properties, TRENCHBROOM_LAYER_LOCKED),
      omitFromExport: enabled(
        metadata.properties,
        TRENCHBROOM_LAYER_OMIT_FROM_EXPORT,
      ),
      groupIds: layerGroups.flatMap((group) =>
        descendantGroupIds(group.id, groups),
      ),
      entityIds: regularEntityIds,
      brushIds: brushes.map((brush) => brush.id),
      pointEntityIds: points.map((entity) => entity.id),
      bounds: combinedBounds([
        ...brushes
          .filter((brush) => brush.kind === "brush")
          .flatMap((brush) => {
            const bounds = deriveBrush(brush).bounds;
            return bounds ? [bounds] : [];
          }),
        ...points.flatMap((entity) => {
          const bounds = pointEntityBounds(entity);
          return bounds ? [bounds] : [];
        }),
      ]),
    };
  };

  const defaultLayer = buildLayer(null, worldspawn, -1);
  const customLayers = customEntities.map((entity, fileIndex) => {
    const parsed = Number.parseInt(
      entity.properties[TRENCHBROOM_LAYER_SORT_INDEX] ?? "",
      10,
    );
    return {
      layer: buildLayer(
        entity.properties[ID_PROPERTY]!.trim(),
        entity,
        Number.isFinite(parsed) ? parsed : fileIndex,
      ),
      fileIndex,
    };
  });
  customLayers.sort(
    (left, right) =>
      left.layer.sortIndex - right.layer.sortIndex ||
      left.fileIndex - right.fileIndex,
  );
  const layers = [defaultLayer, ...customLayers.map(({ layer }) => layer)];
  editorLayersByDocument.set(document, layers);
  return layers;
}

export function findEditorLayer(
  document: MapDocument,
  layerId: EditorLayerId,
): EditorLayer | null {
  return (
    deriveEditorLayers(document).find((layer) => layer.id === layerId) ?? null
  );
}

export function editorLayerForSelection(
  document: MapDocument,
  selection: EditorSelection | null,
): EditorLayer | null {
  if (!selection || selection.faceId) return null;
  const brushIds = selectedBrushIds(selection);
  const entityIds = selectedPointEntityIds(selection);
  const layers = deriveEditorLayers(document).filter(
    (layer) =>
      brushIds.some((brushId) => layer.brushIds.includes(brushId)) ||
      entityIds.some((entityId) => layer.entityIds.includes(entityId)),
  );
  return layers.length === 1 ? layers[0]! : null;
}

function nextPersistentId(document: MapDocument): string {
  const ids = document.entities
    .filter(
      (entity) => isEditorLayerEntity(entity) || isEditorGroupEntity(entity),
    )
    .map((entity) => Number.parseInt(entity.properties[ID_PROPERTY] ?? "", 10))
    .filter(Number.isFinite);
  return String((ids.length > 0 ? Math.max(...ids) : 0) + 1);
}

export function createEditorLayer(
  document: MapDocument,
  name: string,
  ids: IdFactory,
): LayerCreationResult {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Enter a layer name");
  const layerId = nextPersistentId(document);
  const customLayers = deriveEditorLayers(document).filter(
    (layer) => layer.id !== null,
  );
  const sortIndex = customLayers.length
    ? Math.max(...customLayers.map((layer) => layer.sortIndex)) + 1
    : 0;
  const entity: MapEntity = {
    id: ids.entity(),
    properties: {
      classname: LAYER_CLASSNAME,
      [TYPE_PROPERTY]: TRENCHBROOM_LAYER_TYPE,
      [NAME_PROPERTY]: normalizedName,
      [ID_PROPERTY]: layerId,
      [TRENCHBROOM_LAYER_SORT_INDEX]: String(sortIndex),
    },
    primitives: [],
  };
  return {
    document: { ...document, entities: [...document.entities, entity] },
    layerId,
  };
}

function replaceLayerMetadata(
  document: MapDocument,
  layerId: EditorLayerId,
  update: (properties: Record<string, string>) => void,
): MapDocument {
  const worldspawn = document.entities.find(
    (entity) => entity.properties.classname?.toLowerCase() === "worldspawn",
  );
  const target =
    layerId === null
      ? worldspawn
      : document.entities.find(
          (entity) =>
            isEditorLayerEntity(entity) &&
            entity.properties[ID_PROPERTY]?.trim() === layerId,
        );
  if (!target)
    throw new Error(
      layerId === null ? "Worldspawn is missing" : `Unknown layer ${layerId}`,
    );
  const properties = { ...target.properties };
  update(properties);
  return {
    ...document,
    entities: document.entities.map((entity) =>
      entity.id === target.id ? { ...entity, properties } : entity,
    ),
  };
}

export function renameEditorLayer(
  document: MapDocument,
  layerId: string,
  name: string,
): MapDocument {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Enter a layer name");
  return replaceLayerMetadata(document, layerId, (properties) => {
    properties[NAME_PROPERTY] = normalizedName;
  });
}

export type EditorLayerFlag = "hidden" | "locked" | "omit-from-export";

export function setEditorLayerFlag(
  document: MapDocument,
  layerId: EditorLayerId,
  flag: EditorLayerFlag,
  value: boolean,
): MapDocument {
  const key =
    flag === "hidden"
      ? TRENCHBROOM_LAYER_HIDDEN
      : flag === "locked"
        ? TRENCHBROOM_LAYER_LOCKED
        : TRENCHBROOM_LAYER_OMIT_FROM_EXPORT;
  return replaceLayerMetadata(document, layerId, (properties) => {
    if (value) properties[key] = "1";
    else delete properties[key];
  });
}

export function reorderEditorLayer(
  document: MapDocument,
  layerId: string,
  direction: -1 | 1,
): MapDocument {
  const layers = deriveEditorLayers(document).filter(
    (layer): layer is EditorLayer & { readonly id: string } =>
      layer.id !== null,
  );
  const index = layers.findIndex((layer) => layer.id === layerId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= layers.length)
    return document;
  const current = layers[index]!;
  const target = layers[targetIndex]!;
  let result = replaceLayerMetadata(document, current.id, (properties) => {
    properties[TRENCHBROOM_LAYER_SORT_INDEX] = String(target.sortIndex);
  });
  result = replaceLayerMetadata(result, target.id, (properties) => {
    properties[TRENCHBROOM_LAYER_SORT_INDEX] = String(current.sortIndex);
  });
  return result;
}

function withLayer(
  properties: Readonly<Record<string, string>>,
  layerId: EditorLayerId,
) {
  const result: Record<string, string> = { ...properties };
  if (layerId === null) delete result[TRENCHBROOM_LAYER_PROPERTY];
  else result[TRENCHBROOM_LAYER_PROPERTY] = layerId;
  return result;
}

/** Moves top-level selected objects into one layer while retaining brush-entity/group ownership. */
export function moveSelectionToEditorLayer(
  document: MapDocument,
  selection: EditorSelection,
  layerId: EditorLayerId,
): MapDocument {
  if (selection.faceId)
    throw new Error("Faces cannot be moved between layers independently");
  const targetLayer = findEditorLayer(document, layerId);
  if (!targetLayer)
    throw new Error(
      layerId === null
        ? "Default Layer is missing"
        : `Unknown layer ${layerId}`,
    );
  const worldspawn = document.entities.find(
    (entity) => entity.properties.classname?.toLowerCase() === "worldspawn",
  );
  if (!worldspawn) throw new Error("Worldspawn is missing");
  const targetEntity =
    layerId === null
      ? worldspawn
      : document.entities.find((entity) => entity.id === targetLayer.entityId)!;
  const selectedGroup = selectedEditorGroup(document, selection);
  if (selectedGroup?.parentGroupId)
    throw new Error("Nested group members cannot move between layers");
  const selectedBrushes = new Set(selectedBrushIds(selection));
  const selectedPoints = new Set(selectedPointEntityIds(selection));
  const structuralBrushes: MapEntity["primitives"][number][] = [];
  const structuralBrushIds = new Set<BrushId>();
  const entityIds = new Set<EntityId>();
  if (selectedGroup) entityIds.add(selectedGroup.entityId);
  for (const entity of document.entities) {
    const selectedOwned = entity.primitives.filter((brush) =>
      selectedBrushes.has(brush.id),
    );
    if (selectedOwned.length === 0) continue;
    if (entity.id === worldspawn.id || isEditorLayerEntity(entity)) {
      for (const brush of selectedOwned) {
        structuralBrushes.push(brush);
        structuralBrushIds.add(brush.id);
      }
    } else if (isEditorGroupEntity(entity)) {
      if (!selectedGroup)
        throw new Error("Objects inside a group cannot move between layers");
    } else {
      if (entity.properties[GROUP_PROPERTY]?.trim()) {
        throw new Error("Objects inside a group cannot move between layers");
      }
      entityIds.add(entity.id);
    }
  }
  for (const entityId of selectedPoints) {
    const entity = document.entities.find(
      (candidate) => candidate.id === entityId,
    );
    if (!entity) continue;
    if (entity.properties[GROUP_PROPERTY]?.trim()) {
      throw new Error("Objects inside a group cannot move between layers");
    }
    entityIds.add(entityId);
  }
  let entities = document.entities.map((entity) => {
    let next = structuralBrushIds.size
      ? {
          ...entity,
          primitives: entity.primitives.filter(
            (brush) => !structuralBrushIds.has(brush.id),
          ),
        }
      : entity;
    if (entityIds.has(entity.id))
      next = { ...next, properties: withLayer(next.properties, layerId) };
    return next;
  });
  if (structuralBrushes.length > 0) {
    entities = entities.map((entity) =>
      entity.id === targetEntity.id
        ? {
            ...entity,
            primitives: [...entity.primitives, ...structuralBrushes],
          }
        : entity,
    );
  }
  return { ...document, entities };
}

/** Removes a custom layer container and reparents all of its top-level contents to Default. */
export function removeEditorLayer(
  document: MapDocument,
  layerId: string,
): MapDocument {
  const layer = findEditorLayer(document, layerId);
  if (!layer?.entityId) throw new Error(`Unknown custom layer ${layerId}`);
  const layerEntity = document.entities.find(
    (entity) => entity.id === layer.entityId,
  )!;
  const worldspawn = document.entities.find(
    (entity) => entity.properties.classname?.toLowerCase() === "worldspawn",
  );
  if (!worldspawn) throw new Error("Worldspawn is missing");
  return {
    ...document,
    entities: document.entities
      .filter((entity) => entity.id !== layer.entityId)
      .map((entity) => {
        let next = entity;
        if (entity.id === worldspawn.id && layerEntity.primitives.length > 0) {
          next = {
            ...next,
            primitives: [...next.primitives, ...layerEntity.primitives],
          };
        }
        if (entity.properties[TRENCHBROOM_LAYER_PROPERTY]?.trim() === layerId) {
          next = { ...next, properties: withLayer(next.properties, null) };
        }
        return next;
      }),
  };
}

/** Builds the compile/export view by removing all objects belonging to omitted layers. */
export function documentWithoutOmittedLayers(
  document: MapDocument,
): MapDocument {
  const omitted = deriveEditorLayers(document).filter(
    (layer) => layer.omitFromExport,
  );
  if (omitted.length === 0) return document;
  const brushIds = new Set(omitted.flatMap((layer) => layer.brushIds));
  const entityIds = new Set(omitted.flatMap((layer) => layer.entityIds));
  const groupIds = new Set(omitted.flatMap((layer) => layer.groupIds));
  const layerEntityIds = new Set(
    omitted.flatMap((layer) => (layer.entityId ? [layer.entityId] : [])),
  );
  let result =
    brushIds.size > 0 ? removeBrushes(document, [...brushIds]) : document;
  result = {
    ...result,
    revision: document.revision,
    entities: result.entities.filter((entity) => {
      if (layerEntityIds.has(entity.id) || entityIds.has(entity.id))
        return false;
      if (
        isEditorGroupEntity(entity) &&
        groupIds.has(entity.properties[ID_PROPERTY] ?? "")
      ) {
        return false;
      }
      return true;
    }),
  };
  return result;
}

export function selectionForEditorLayer(
  layer: EditorLayer,
): EditorSelection | null {
  return createObjectSelection(layer.brushIds, layer.pointEntityIds);
}
