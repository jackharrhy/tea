import { boundsCenter } from "./math.js";
import { deriveBrush } from "./geometry.js";
import { pointEntityBounds } from "./point-entities.js";
import type {
  EditorSelection,
  EntityId,
  MapDocument,
  MapEntity,
  Vec3,
} from "./types.js";

export type EntityLinkProperty = "target" | "killtarget";
export type EntityLinkMode = "all" | "transitive" | "direct" | "none";

export interface EntityLink {
  readonly sourceEntityId: EntityId;
  readonly targetEntityId: EntityId;
  readonly property: EntityLinkProperty;
  readonly targetName: string;
  readonly sourceAnchor: Vec3;
  readonly targetAnchor: Vec3;
}

const entityLinksByDocument = new WeakMap<MapDocument, readonly EntityLink[]>();

function entityAnchor(entity: MapEntity): Vec3 | null {
  if (entity.primitives.length === 0) {
    const bounds = pointEntityBounds(entity);
    return bounds ? boundsCenter(bounds) : null;
  }
  const bounds = entity.primitives.flatMap((brush) => {
    if (brush.kind !== "brush") return [];
    const derived = deriveBrush(brush);
    return derived.valid && derived.bounds ? [derived.bounds] : [];
  });
  if (bounds.length === 0) return null;
  return boundsCenter({
    min: [
      Math.min(...bounds.map((entry) => entry.min[0])),
      Math.min(...bounds.map((entry) => entry.min[1])),
      Math.min(...bounds.map((entry) => entry.min[2])),
    ],
    max: [
      Math.max(...bounds.map((entry) => entry.max[0])),
      Math.max(...bounds.map((entry) => entry.max[1])),
      Math.max(...bounds.map((entry) => entry.max[2])),
    ],
  });
}

/** Resolves Quake target and killtarget properties into directed, viewport-ready entity links. */
export function deriveEntityLinks(
  document: MapDocument,
): readonly EntityLink[] {
  const cached = entityLinksByDocument.get(document);
  if (cached) return cached;
  const targets = new Map<string, MapEntity[]>();
  const anchors = new Map<EntityId, Vec3>();
  for (const entity of document.entities) {
    const anchor = entityAnchor(entity);
    if (anchor) anchors.set(entity.id, anchor);
    const targetName = entity.properties.targetname?.trim();
    if (!targetName) continue;
    const matches = targets.get(targetName) ?? [];
    matches.push(entity);
    targets.set(targetName, matches);
  }

  const links: EntityLink[] = [];
  for (const source of document.entities) {
    const sourceAnchor = anchors.get(source.id);
    if (!sourceAnchor) continue;
    for (const property of ["target", "killtarget"] as const) {
      const targetName = source.properties[property]?.trim();
      if (!targetName) continue;
      for (const target of targets.get(targetName) ?? []) {
        const targetAnchor = anchors.get(target.id);
        if (!targetAnchor) continue;
        links.push({
          sourceEntityId: source.id,
          targetEntityId: target.id,
          property,
          targetName,
          sourceAnchor,
          targetAnchor,
        });
      }
    }
  }
  entityLinksByDocument.set(document, links);
  return links;
}

export function selectedEntityIdsForLinks(
  document: MapDocument,
  selection: EditorSelection | null,
): readonly EntityId[] {
  if (!selection) return [];
  const selected = new Set<EntityId>(
    selection.entityIds ?? (selection.entityId ? [selection.entityId] : []),
  );
  const brushIds = selection.faceId
    ? (
        selection.faces ?? [
          { brushId: selection.brushId, faceId: selection.faceId },
        ]
      ).map((face) => face.brushId)
    : (selection.brushIds ?? (selection.brushId ? [selection.brushId] : []));
  if (brushIds.length > 0) {
    const ids = new Set(brushIds);
    for (const entity of document.entities) {
      if (entity.primitives.some((brush) => ids.has(brush.id)))
        selected.add(entity.id);
    }
  }
  return [...selected];
}

/** Applies TrenchBroom's all, transitive-selected, direct-selected, and hidden link modes. */
export function visibleEntityLinks(
  links: readonly EntityLink[],
  selectedEntityIds: readonly EntityId[],
  mode: EntityLinkMode,
): readonly EntityLink[] {
  if (mode === "none") return [];
  if (mode === "all") return links;
  const selected = new Set(selectedEntityIds);
  if (selected.size === 0) return [];
  if (mode === "direct") {
    return links.filter(
      (link) =>
        selected.has(link.sourceEntityId) || selected.has(link.targetEntityId),
    );
  }
  const reachable = new Set(selected);
  let changed = true;
  while (changed) {
    changed = false;
    for (const link of links) {
      if (
        !reachable.has(link.sourceEntityId) &&
        !reachable.has(link.targetEntityId)
      )
        continue;
      const before = reachable.size;
      reachable.add(link.sourceEntityId);
      reachable.add(link.targetEntityId);
      changed ||= reachable.size !== before;
    }
  }
  return links.filter(
    (link) =>
      reachable.has(link.sourceEntityId) && reachable.has(link.targetEntityId),
  );
}
