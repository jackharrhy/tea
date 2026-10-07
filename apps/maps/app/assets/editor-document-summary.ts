import {
  brushesInDocument,
  deriveBrush,
  deriveEditorGroups,
  isEditorGroupEntity,
  isEditorLayerEntity,
  type EditorObjectViewState,
  type MapDocument,
} from "@tea/maps-editor/core";

export interface EditorDocumentSummaryState {
  readonly revision: number;
  readonly entityCount: number;
  readonly brushCount: number;
  readonly groupCount: number;
  readonly hiddenObjectCount: number;
  readonly lockedObjectCount: number;
  readonly geometryErrorCount: number;
}

type DocumentCounts = Omit<
  EditorDocumentSummaryState,
  "hiddenObjectCount" | "lockedObjectCount"
>;

const counts = new WeakMap<MapDocument, DocumentCounts>();

export function summarizeEditorDocument(
  document: MapDocument,
  view: EditorObjectViewState,
): EditorDocumentSummaryState {
  let base = counts.get(document);
  if (!base) {
    const brushes = brushesInDocument(document);
    base = {
      revision: document.revision,
      entityCount: document.entities.filter(
        (entity) =>
          !isEditorGroupEntity(entity) && !isEditorLayerEntity(entity),
      ).length,
      brushCount: brushes.length,
      groupCount: deriveEditorGroups(document).length,
      geometryErrorCount: brushes.reduce(
        (total, brush) =>
          total +
          deriveBrush(brush).diagnostics.filter(
            (diagnostic) => diagnostic.severity === "error",
          ).length,
        0,
      ),
    };
    counts.set(document, base);
  }
  return {
    ...base,
    hiddenObjectCount: view.hiddenBrushIds.length + view.hiddenEntityIds.length,
    lockedObjectCount: view.lockedBrushIds.length + view.lockedEntityIds.length,
  };
}
