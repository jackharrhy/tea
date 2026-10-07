import {
  removeBrush,
  removeEntities,
  replaceEntityProperties,
} from "./document.js";
import { deriveBrush } from "./geometry.js";
import { deleteEditorGroup, isEditorGroupEntity } from "./groups.js";
import { isEditorLayerEntity, removeEditorLayer } from "./layers.js";
import { normalizeSingleLinkedGroups } from "./linked-groups.js";
import { parseEntityOrigin } from "./point-entities.js";
import { createObjectSelection } from "./selection.js";
import type {
  BrushId,
  EditorSelection,
  EntityId,
  IdFactory,
  MapDocument,
  MapEntity,
} from "./types.js";

export type EditorIssueSeverity = "error" | "warning";
export type EditorIssueCategory = "geometry" | "entity" | "link" | "structure";

export type EditorIssueType =
  | "missing-worldspawn"
  | "multiple-worldspawns"
  | "worldspawn-order"
  | "invalid-brush"
  | "missing-classname"
  | "invalid-origin"
  | "missing-origin"
  | "empty-brush-entity"
  | "empty-group"
  | "empty-layer"
  | "unresolved-target"
  | "orphan-group"
  | "orphan-layer"
  | "duplicate-persistent-id";

export const EDITOR_ISSUE_TYPE_INFO: readonly {
  readonly type: EditorIssueType;
  readonly label: string;
  readonly category: EditorIssueCategory;
}[] = [
  {
    type: "missing-worldspawn",
    label: "Missing worldspawn",
    category: "structure",
  },
  {
    type: "multiple-worldspawns",
    label: "Multiple worldspawns",
    category: "structure",
  },
  {
    type: "worldspawn-order",
    label: "Worldspawn order",
    category: "structure",
  },
  { type: "invalid-brush", label: "Invalid brushes", category: "geometry" },
  {
    type: "missing-classname",
    label: "Missing classnames",
    category: "entity",
  },
  { type: "invalid-origin", label: "Invalid origins", category: "entity" },
  { type: "missing-origin", label: "Missing origins", category: "entity" },
  {
    type: "empty-brush-entity",
    label: "Empty brush entities",
    category: "entity",
  },
  { type: "empty-group", label: "Empty groups", category: "structure" },
  { type: "empty-layer", label: "Empty layers", category: "structure" },
  {
    type: "unresolved-target",
    label: "Unresolved entity links",
    category: "link",
  },
  {
    type: "orphan-group",
    label: "Orphaned group members",
    category: "structure",
  },
  {
    type: "orphan-layer",
    label: "Orphaned layer members",
    category: "structure",
  },
  {
    type: "duplicate-persistent-id",
    label: "Duplicate group/layer IDs",
    category: "structure",
  },
];

type EditorIssueFix =
  | { readonly kind: "insert-worldspawn"; readonly label: string }
  | {
      readonly kind: "merge-worldspawn";
      readonly entityId: EntityId;
      readonly label: string;
    }
  | {
      readonly kind: "move-worldspawn-first";
      readonly entityId: EntityId;
      readonly label: string;
    }
  | {
      readonly kind: "delete-brush";
      readonly brushId: BrushId;
      readonly label: string;
    }
  | {
      readonly kind: "delete-entity";
      readonly entityId: EntityId;
      readonly label: string;
    }
  | {
      readonly kind: "set-entity-property";
      readonly entityId: EntityId;
      readonly key: string;
      readonly value: string;
      readonly label: string;
    }
  | {
      readonly kind: "remove-entity-property";
      readonly entityId: EntityId;
      readonly key: string;
      readonly label: string;
    }
  | {
      readonly kind: "delete-group";
      readonly groupId: string;
      readonly label: string;
    }
  | {
      readonly kind: "remove-layer";
      readonly layerId: string;
      readonly label: string;
    }
  | {
      readonly kind: "assign-persistent-id";
      readonly entityId: EntityId;
      readonly label: string;
    };

export interface EditorIssue {
  readonly id: string;
  readonly type: EditorIssueType;
  readonly category: EditorIssueCategory;
  readonly severity: EditorIssueSeverity;
  readonly message: string;
  readonly brushIds: readonly BrushId[];
  readonly entityIds: readonly EntityId[];
  readonly fix?: EditorIssueFix;
}

export interface EditorIssueFixResult {
  readonly label: string;
  readonly document: MapDocument;
  readonly removesObjects: boolean;
}

function issueCategory(type: EditorIssueType): EditorIssueCategory {
  return EDITOR_ISSUE_TYPE_INFO.find((entry) => entry.type === type)!.category;
}

function createEditorIssue(
  type: EditorIssueType,
  severity: EditorIssueSeverity,
  key: string,
  message: string,
  brushIds: readonly BrushId[] = [],
  entityIds: readonly EntityId[] = [],
  fix?: EditorIssueFix,
): EditorIssue {
  return {
    id: `${type}:${key}`,
    type,
    category: issueCategory(type),
    severity,
    message,
    brushIds,
    entityIds,
    ...(fix ? { fix } : {}),
  };
}

function isLikelyBrushEntity(classname: string): boolean {
  const normalized = classname.toLowerCase();
  return normalized.startsWith("func_") || normalized.startsWith("trigger_");
}

function isDynamicTargetReference(targetName: string): boolean {
  const normalized = targetName.toLowerCase();
  return (
    ["!", "<", ">"].some((prefix) => targetName.startsWith(prefix)) ||
    targetName.includes("*") ||
    targetName.includes("?") ||
    normalized === "none" ||
    normalized === "nothing"
  );
}

function entityLabel(entity: MapEntity): string {
  return (
    entity.properties.targetname?.trim() ||
    entity.properties.classname?.trim() ||
    entity.id
  );
}

function metadataPersistentId(entity: MapEntity): string | null {
  return isEditorGroupEntity(entity) || isEditorLayerEntity(entity)
    ? (entity.properties["_tb_id"]?.trim() ?? null)
    : null;
}

/** Derives deterministic, live diagnostics without mutating the source document. */
export function deriveEditorIssues(
  document: MapDocument,
): readonly EditorIssue[] {
  const issues: EditorIssue[] = [];
  const worldspawns = document.entities.filter(
    (entity) =>
      entity.properties.classname?.trim().toLowerCase() === "worldspawn",
  );
  if (worldspawns.length === 0) {
    issues.push(
      createEditorIssue(
        "missing-worldspawn",
        "error",
        "document",
        "The map has no worldspawn entity.",
        [],
        [],
        { kind: "insert-worldspawn", label: "Create worldspawn" },
      ),
    );
  } else {
    const primary = worldspawns[0]!;
    if (document.entities[0]?.id !== primary.id) {
      issues.push(
        createEditorIssue(
          "worldspawn-order",
          "warning",
          primary.id,
          "Worldspawn is not the first entity in the map.",
          [],
          [primary.id],
          {
            kind: "move-worldspawn-first",
            entityId: primary.id,
            label: "Move worldspawn first",
          },
        ),
      );
    }
    for (const duplicate of worldspawns.slice(1)) {
      issues.push(
        createEditorIssue(
          "multiple-worldspawns",
          "error",
          duplicate.id,
          "The map contains an extra worldspawn entity.",
          duplicate.primitives.map((brush) => brush.id),
          [duplicate.id],
          {
            kind: "merge-worldspawn",
            entityId: duplicate.id,
            label: "Merge duplicate worldspawn",
          },
        ),
      );
    }
  }

  for (const entity of document.entities) {
    for (const brush of entity.primitives) {
      if (brush.kind !== "brush") continue;
      const derived = deriveBrush(brush);
      if (derived.valid) continue;
      const messages = [
        ...new Set(derived.diagnostics.map((diagnostic) => diagnostic.message)),
      ];
      issues.push(
        createEditorIssue(
          "invalid-brush",
          "error",
          brush.id,
          `Invalid brush: ${messages.join("; ") || "geometry cannot form a closed convex solid"}.`,
          [brush.id],
          [],
          {
            kind: "delete-brush",
            brushId: brush.id,
            label: "Delete invalid brush",
          },
        ),
      );
    }
  }

  const metadataIds = new Map<string, MapEntity[]>();
  for (const entity of document.entities) {
    const persistentId = metadataPersistentId(entity);
    if (!persistentId) continue;
    const entries = metadataIds.get(persistentId) ?? [];
    entries.push(entity);
    metadataIds.set(persistentId, entries);
  }
  for (const [persistentId, entities] of metadataIds) {
    for (const duplicate of entities.slice(1)) {
      issues.push(
        createEditorIssue(
          "duplicate-persistent-id",
          "error",
          duplicate.id,
          `Group or layer ID ${persistentId} is used more than once.`,
          duplicate.primitives.map((brush) => brush.id),
          [duplicate.id],
          {
            kind: "assign-persistent-id",
            entityId: duplicate.id,
            label: "Assign unique group/layer ID",
          },
        ),
      );
    }
  }

  const groupIds = new Set(
    document.entities
      .filter(isEditorGroupEntity)
      .flatMap((entity) =>
        entity.properties["_tb_id"]?.trim()
          ? [entity.properties["_tb_id"].trim()]
          : [],
      ),
  );
  const layerIds = new Set(
    document.entities
      .filter(isEditorLayerEntity)
      .flatMap((entity) =>
        entity.properties["_tb_id"]?.trim()
          ? [entity.properties["_tb_id"].trim()]
          : [],
      ),
  );
  const targetNames = new Set(
    document.entities.flatMap((entity) => {
      const targetname = entity.properties.targetname?.trim();
      const generatedTargetname = entity.properties.netname?.trim();
      return [targetname, generatedTargetname].filter(
        (value): value is string => Boolean(value),
      );
    }),
  );

  for (const [index, entity] of document.entities.entries()) {
    const classname = entity.properties.classname?.trim() ?? "";
    const isWorldspawn = classname.toLowerCase() === "worldspawn";
    const isMetadata =
      isEditorGroupEntity(entity) || isEditorLayerEntity(entity);
    if (!classname) {
      issues.push(
        createEditorIssue(
          "missing-classname",
          "error",
          entity.id,
          `Entity ${index + 1} has no classname.`,
          entity.primitives.map((brush) => brush.id),
          [entity.id],
          {
            kind: "set-entity-property",
            entityId: entity.id,
            key: "classname",
            value: entity.primitives.length > 0 ? "func_detail" : "info_null",
            label: "Set fallback classname",
          },
        ),
      );
    }

    if (
      !isWorldspawn &&
      !isMetadata &&
      entity.primitives.length === 0 &&
      classname
    ) {
      const hasOrigin = "origin" in entity.properties;
      if (hasOrigin && !parseEntityOrigin(entity)) {
        issues.push(
          createEditorIssue(
            "invalid-origin",
            "error",
            entity.id,
            `${entityLabel(entity)} has an invalid origin: ${entity.properties.origin}.`,
            [],
            [entity.id],
            {
              kind: "set-entity-property",
              entityId: entity.id,
              key: "origin",
              value: "0 0 0",
              label: "Reset invalid origin",
            },
          ),
        );
      } else if (!hasOrigin && isLikelyBrushEntity(classname)) {
        issues.push(
          createEditorIssue(
            "empty-brush-entity",
            "warning",
            entity.id,
            `${entityLabel(entity)} has no brushes.`,
            [],
            [entity.id],
            {
              kind: "delete-entity",
              entityId: entity.id,
              label: "Delete empty brush entity",
            },
          ),
        );
      } else if (!hasOrigin) {
        issues.push(
          createEditorIssue(
            "missing-origin",
            "error",
            entity.id,
            `${entityLabel(entity)} has no origin.`,
            [],
            [entity.id],
            {
              kind: "set-entity-property",
              entityId: entity.id,
              key: "origin",
              value: "0 0 0",
              label: "Set origin to 0 0 0",
            },
          ),
        );
      }
    }

    const parentGroupId = entity.properties["_tb_group"]?.trim();
    if (parentGroupId && !groupIds.has(parentGroupId)) {
      issues.push(
        createEditorIssue(
          "orphan-group",
          "warning",
          entity.id,
          `${entityLabel(entity)} refers to missing group ${parentGroupId}.`,
          entity.primitives.map((brush) => brush.id),
          [entity.id],
          {
            kind: "remove-entity-property",
            entityId: entity.id,
            key: "_tb_group",
            label: "Move orphan to the current layer",
          },
        ),
      );
    }
    const layerId = entity.properties["_tb_layer"]?.trim();
    if (layerId && !layerIds.has(layerId)) {
      issues.push(
        createEditorIssue(
          "orphan-layer",
          "warning",
          entity.id,
          `${entityLabel(entity)} refers to missing layer ${layerId}.`,
          entity.primitives.map((brush) => brush.id),
          [entity.id],
          {
            kind: "remove-entity-property",
            entityId: entity.id,
            key: "_tb_layer",
            label: "Move orphan to Default Layer",
          },
        ),
      );
    }
    for (const property of ["target", "killtarget"] as const) {
      const targetName = entity.properties[property]?.trim();
      if (
        !targetName ||
        targetNames.has(targetName) ||
        isDynamicTargetReference(targetName)
      ) {
        continue;
      }
      issues.push(
        createEditorIssue(
          "unresolved-target",
          "warning",
          `${entity.id}:${property}`,
          `${entityLabel(entity)} has ${property} "${targetName}", but no entity has that targetname.`,
          entity.primitives.map((brush) => brush.id),
          [entity.id],
          {
            kind: "remove-entity-property",
            entityId: entity.id,
            key: property,
            label: `Remove unresolved ${property}`,
          },
        ),
      );
    }
  }

  for (const group of document.entities.filter(isEditorGroupEntity)) {
    const groupId = group.properties["_tb_id"]?.trim();
    if (!groupId) continue;
    const hasMembers = document.entities.some(
      (entity) =>
        entity.id !== group.id &&
        entity.properties["_tb_group"]?.trim() === groupId,
    );
    if (group.primitives.length > 0 || hasMembers) continue;
    issues.push(
      createEditorIssue(
        "empty-group",
        "warning",
        group.id,
        `Group ${group.properties["_tb_name"]?.trim() || groupId} is empty.`,
        [],
        [group.id],
        { kind: "delete-group", groupId, label: "Delete empty group" },
      ),
    );
  }

  for (const layer of document.entities.filter(isEditorLayerEntity)) {
    const layerId = layer.properties["_tb_id"]?.trim();
    if (!layerId) continue;
    const hasMembers = document.entities.some(
      (entity) =>
        entity.id !== layer.id &&
        entity.properties["_tb_layer"]?.trim() === layerId,
    );
    if (layer.primitives.length > 0 || hasMembers) continue;
    issues.push(
      createEditorIssue(
        "empty-layer",
        "warning",
        layer.id,
        `Layer ${layer.properties["_tb_name"]?.trim() || layerId} is empty.`,
        [],
        [layer.id],
        worldspawns.length > 0
          ? { kind: "remove-layer", layerId, label: "Delete empty layer" }
          : undefined,
      ),
    );
  }

  return issues.toSorted(
    (left, right) =>
      (left.severity === right.severity
        ? 0
        : left.severity === "error"
          ? -1
          : 1) ||
      left.type.localeCompare(right.type) ||
      left.id.localeCompare(right.id),
  );
}

export function selectionForEditorIssue(
  issue: EditorIssue,
): EditorSelection | null {
  return createObjectSelection(issue.brushIds, issue.entityIds);
}

function updatedProperties(
  document: MapDocument,
  entityId: EntityId,
  update: (properties: Record<string, string>) => void,
): MapDocument {
  const entity = document.entities.find(
    (candidate) => candidate.id === entityId,
  );
  if (!entity) throw new Error(`Unknown issue entity ${entityId}`);
  const properties = { ...entity.properties };
  update(properties);
  return replaceEntityProperties(document, entityId, properties);
}

function nextPersistentId(document: MapDocument): string {
  const used = new Set(
    document.entities.flatMap((entity) => {
      const value = metadataPersistentId(entity);
      return value ? [value] : [];
    }),
  );
  const numeric = [...used]
    .map(Number)
    .filter((value) => Number.isSafeInteger(value) && value >= 0);
  let next = Math.max(0, ...numeric) + 1;
  while (used.has(String(next))) next += 1;
  return String(next);
}

export function applyEditorIssueFix(
  document: MapDocument,
  issueId: string,
  ids: IdFactory,
): EditorIssueFixResult | null {
  const current = deriveEditorIssues(document).find(
    (candidate) => candidate.id === issueId,
  );
  const fix = current?.fix;
  if (!current || !fix) return null;
  if (fix.kind === "insert-worldspawn") {
    return {
      label: fix.label,
      document: {
        ...document,
        revision: document.revision + 1,
        entities: [
          {
            id: ids.entity(),
            properties: { classname: "worldspawn" },
            primitives: [],
          },
          ...document.entities,
        ],
      },
      removesObjects: false,
    };
  }
  if (fix.kind === "merge-worldspawn") {
    const primary = document.entities.find(
      (entity) =>
        entity.properties.classname?.trim().toLowerCase() === "worldspawn",
    );
    const duplicate = document.entities.find(
      (entity) => entity.id === fix.entityId,
    );
    if (!primary || !duplicate || primary.id === duplicate.id) return null;
    const properties = {
      ...duplicate.properties,
      ...primary.properties,
      classname: "worldspawn",
    };
    return {
      label: fix.label,
      document: {
        ...document,
        revision: document.revision + 1,
        entities: document.entities.flatMap((entity) => {
          if (entity.id === duplicate.id) return [];
          return entity.id === primary.id
            ? [
                {
                  ...entity,
                  properties,
                  primitives: [...entity.primitives, ...duplicate.primitives],
                },
              ]
            : [entity];
        }),
      },
      removesObjects: true,
    };
  }
  if (fix.kind === "move-worldspawn-first") {
    const worldspawn = document.entities.find(
      (entity) => entity.id === fix.entityId,
    );
    if (!worldspawn) return null;
    return {
      label: fix.label,
      document: {
        ...document,
        revision: document.revision + 1,
        entities: [
          worldspawn,
          ...document.entities.filter((entity) => entity.id !== worldspawn.id),
        ],
      },
      removesObjects: false,
    };
  }
  if (fix.kind === "delete-brush") {
    return {
      label: fix.label,
      document: removeBrush(document, fix.brushId),
      removesObjects: true,
    };
  }
  if (fix.kind === "delete-entity") {
    const entity = document.entities.find(
      (candidate) => candidate.id === fix.entityId,
    );
    if (
      !entity ||
      entity.properties.classname?.trim().toLowerCase() === "worldspawn"
    )
      return null;
    return {
      label: fix.label,
      document:
        document.entities[0]?.id === fix.entityId
          ? {
              ...document,
              revision: document.revision + 1,
              entities: document.entities.filter(
                (candidate) => candidate.id !== fix.entityId,
              ),
            }
          : removeEntities(document, [fix.entityId]),
      removesObjects: true,
    };
  }
  if (fix.kind === "set-entity-property") {
    return {
      label: fix.label,
      document: updatedProperties(document, fix.entityId, (properties) => {
        properties[fix.key] = fix.value;
      }),
      removesObjects: false,
    };
  }
  if (fix.kind === "remove-entity-property") {
    return {
      label: fix.label,
      document: updatedProperties(document, fix.entityId, (properties) => {
        delete properties[fix.key];
      }),
      removesObjects: false,
    };
  }
  if (fix.kind === "delete-group") {
    return {
      label: fix.label,
      document: normalizeSingleLinkedGroups(
        deleteEditorGroup(document, fix.groupId),
      ),
      removesObjects: true,
    };
  }
  if (fix.kind === "remove-layer") {
    return {
      label: fix.label,
      document: removeEditorLayer(document, fix.layerId),
      removesObjects: true,
    };
  }
  return {
    label: fix.label,
    document: updatedProperties(document, fix.entityId, (properties) => {
      properties["_tb_id"] = nextPersistentId(document);
    }),
    removesObjects: false,
  };
}
