import { isEditorGroupEntity } from "./groups.js";
import { isEditorLayerEntity } from "./layers.js";
import { parseEntityOrigin } from "./point-entities.js";
import type {
  BrushId,
  EntityId,
  MapBrush,
  MapDocument,
  MapEntity,
} from "./types.js";

export type EditorSpecialBrushFilter =
  | "detail"
  | "trigger"
  | "clip"
  | "hint-skip"
  | "liquid"
  | "sky";

export const EDITOR_SPECIAL_BRUSH_FILTER_INFO: readonly {
  readonly type: EditorSpecialBrushFilter;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    type: "detail",
    label: "Detail brushes",
    description: "Brushes owned by func_detail entities",
  },
  {
    type: "trigger",
    label: "Trigger brushes",
    description: "trigger_* brush entities or brushes using a TRIGGER material",
  },
  {
    type: "clip",
    label: "Clip brushes",
    description: "Brushes using CLIP, PLAYERCLIP, or MONSTERCLIP materials",
  },
  {
    type: "hint-skip",
    label: "Hint / skip",
    description: "Brushes containing HINT or SKIP faces",
  },
  {
    type: "liquid",
    label: "Liquids",
    description: "Brushes using Quake or GoldSrc liquid material prefixes",
  },
  {
    type: "sky",
    label: "Sky",
    description: "Brushes containing SKY faces",
  },
];

export interface EditorViewFilterState {
  readonly worldBrushesVisible: boolean;
  readonly hiddenEntityClassnames: readonly string[];
  readonly hiddenSpecialBrushTypes: readonly EditorSpecialBrushFilter[];
}

export interface EditorEntityClassFilter {
  readonly classname: string;
  readonly pointEntityCount: number;
  readonly brushEntityCount: number;
}

export interface EditorViewFilterObjectIds {
  readonly brushIds: readonly BrushId[];
  readonly entityIds: readonly EntityId[];
}

export const DEFAULT_EDITOR_VIEW_FILTER_STATE: EditorViewFilterState = {
  worldBrushesVisible: true,
  hiddenEntityClassnames: [],
  hiddenSpecialBrushTypes: [],
};

function normalizedClassname(entity: MapEntity): string {
  return entity.properties.classname?.trim().toLowerCase() ?? "";
}

function isStructuralOwner(entity: MapEntity): boolean {
  return (
    normalizedClassname(entity) === "worldspawn" ||
    isEditorGroupEntity(entity) ||
    isEditorLayerEntity(entity)
  );
}

function normalizedMaterials(brush: MapBrush): readonly string[] {
  return brush.faces.map((face) => face.material.trim().toLowerCase());
}

function brushMatchesSpecialFilter(
  entity: MapEntity,
  brush: MapBrush,
  type: EditorSpecialBrushFilter,
): boolean {
  const classname = normalizedClassname(entity);
  const materials = normalizedMaterials(brush);
  if (type === "detail") return classname.startsWith("func_detail");
  if (type === "trigger") {
    return (
      classname.startsWith("trigger_") ||
      materials.some((material) => material === "trigger")
    );
  }
  if (type === "clip")
    return materials.some((material) => material.includes("clip"));
  if (type === "hint-skip") {
    return materials.some(
      (material) => material === "hint" || material === "skip",
    );
  }
  if (type === "liquid") {
    return materials.some(
      (material) => material.startsWith("*") || material.startsWith("!"),
    );
  }
  return materials.some((material) => material.startsWith("sky"));
}

export function entityClassFiltersInDocument(
  document: MapDocument,
): readonly EditorEntityClassFilter[] {
  const summaries = new Map<string, EditorEntityClassFilter>();
  for (const entity of document.entities) {
    if (isStructuralOwner(entity)) continue;
    const classname = normalizedClassname(entity);
    if (!classname) continue;
    const current = summaries.get(classname) ?? {
      classname,
      pointEntityCount: 0,
      brushEntityCount: 0,
    };
    summaries.set(classname, {
      classname,
      pointEntityCount:
        current.pointEntityCount + (parseEntityOrigin(entity) ? 1 : 0),
      brushEntityCount:
        current.brushEntityCount + (entity.primitives.length > 0 ? 1 : 0),
    });
  }
  return [...summaries.values()].toSorted((left, right) =>
    left.classname.localeCompare(right.classname),
  );
}

/** Resolves non-serialized filter settings into the same hidden-ID contract used by rendering. */
export function deriveEditorViewFilterObjectIds(
  document: MapDocument,
  state: EditorViewFilterState,
): EditorViewFilterObjectIds {
  const hiddenClassnames = new Set(
    state.hiddenEntityClassnames.map((classname) =>
      classname.trim().toLowerCase(),
    ),
  );
  const hiddenSpecialTypes = new Set(state.hiddenSpecialBrushTypes);
  const brushIds = new Set<BrushId>();
  const entityIds = new Set<EntityId>();
  for (const entity of document.entities) {
    const classname = normalizedClassname(entity);
    if (!isStructuralOwner(entity) && hiddenClassnames.has(classname)) {
      for (const brush of entity.primitives) brushIds.add(brush.id);
      if (parseEntityOrigin(entity)) entityIds.add(entity.id);
    }
    for (const brush of entity.primitives) {
      if (brush.kind !== "brush") continue;
      if (!state.worldBrushesVisible && isStructuralOwner(entity))
        brushIds.add(brush.id);
      if (
        EDITOR_SPECIAL_BRUSH_FILTER_INFO.some(
          ({ type }) =>
            hiddenSpecialTypes.has(type) &&
            brushMatchesSpecialFilter(entity, brush, type),
        )
      ) {
        brushIds.add(brush.id);
      }
    }
  }
  return {
    brushIds: [...brushIds].toSorted(),
    entityIds: [...entityIds].toSorted(),
  };
}
