import {
  BoundsSpatialIndex,
  brushesInDocument,
  deriveBrush,
  pointEntitiesInDocument,
  pointEntityBounds,
  type BoundsSpatialEntry,
  type EntityDefinitionCatalog,
  type MapBrush,
  type MapDocument,
  type MapEntity,
} from "../core/index.js";

export type IndexedEditorObject =
  | { readonly kind: "brush"; readonly brush: MapBrush }
  | { readonly kind: "entity"; readonly entity: MapEntity };

export function buildEditorObjectSpatialIndex(
  document: MapDocument,
  definitions?: EntityDefinitionCatalog,
): BoundsSpatialIndex<IndexedEditorObject> {
  const entries: BoundsSpatialEntry<IndexedEditorObject>[] = [];
  for (const brush of brushesInDocument(document)) {
    const bounds = deriveBrush(brush).bounds;
    if (bounds) entries.push({ bounds, value: { kind: "brush", brush } });
  }
  for (const entity of pointEntitiesInDocument(document, definitions)) {
    const bounds = pointEntityBounds(entity, definitions);
    if (bounds) entries.push({ bounds, value: { kind: "entity", entity } });
  }
  return new BoundsSpatialIndex(entries);
}
