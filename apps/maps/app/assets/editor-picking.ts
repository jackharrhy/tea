import {
  createBrushSelection,
  createObjectSelection,
  editorGroupForObject,
  selectedBrushIds,
  selectedFaceReferences,
  selectedPointEntityIds,
  selectionForEditorGroup,
  type EditorGroup,
  type EditorSelection,
  type EditorSession,
} from "@tea/maps-editor/core";
import type { EditorPickIntent } from "@tea/maps-editor/render";

export type EditorPickResult =
  | { readonly kind: "open-group"; readonly group: EditorGroup }
  | { readonly kind: "close-group" }
  | { readonly kind: "selected"; readonly status?: string };

export function applyViewportPick(options: {
  readonly session: EditorSession;
  readonly selection: EditorSelection | null;
  readonly intent: EditorPickIntent;
  readonly openGroupId: string | null;
  readonly activeTool: string;
}): EditorPickResult {
  const { session, selection, intent, openGroupId, activeTool } = options;
  const selectedObjects = selectedBrushIds(session.selection);
  if (!selection?.faceId) {
    if (!selection && intent.objectExpansion === "activate" && openGroupId)
      return { kind: "close-group" };
    if (!selection && intent.objectAdditive) return { kind: "selected" };
    const group = selection
      ? editorGroupForObject(session.document, selection, openGroupId)
      : null;
    if (group && selection && intent.objectExpansion === "activate")
      return { kind: "open-group", group };
    if (group && selection) {
      const primary = selection.brushId
        ? { kind: "brush" as const, brushId: selection.brushId }
        : selection.entityId
          ? { kind: "entity" as const, entityId: selection.entityId }
          : null;
      if (intent.objectAdditive) {
        const brushes = new Set(selectedObjects);
        const entities = new Set(selectedPointEntityIds(session.selection));
        const allSelected =
          group.brushIds.every((id) => brushes.has(id)) &&
          group.pointEntityIds.every((id) => entities.has(id));
        for (const id of group.brushIds) {
          if (allSelected) brushes.delete(id);
          else brushes.add(id);
        }
        for (const id of group.pointEntityIds) {
          if (allSelected) entities.delete(id);
          else entities.add(id);
        }
        session.select(
          createObjectSelection([...brushes], [...entities], primary),
        );
      } else session.select(selectionForEditorGroup(group, primary));
    } else if (selection?.entityId) {
      session.selectPointEntity(selection.entityId, intent.objectAdditive);
    } else if (
      selection?.brushId &&
      (intent.objectExpansion === "siblings" ||
        intent.objectExpansion === "activate")
    ) {
      const owner = session.document.entities.find((entity) =>
        entity.primitives.some((brush) => brush.id === selection.brushId),
      );
      const siblings =
        owner &&
        owner.properties.classname !== "worldspawn" &&
        owner.primitives.length > 1
          ? owner.primitives.map((brush) => brush.id)
          : [selection.brushId];
      session.select(
        createBrushSelection(
          intent.objectAdditive ? [...selectedObjects, ...siblings] : siblings,
          selection.brushId,
        ),
      );
    } else if (selection?.brushId) {
      session.selectBrush(selection.brushId, intent.objectAdditive);
    } else session.select(selection);
  } else if (selection.brushId) {
    const face = { brushId: selection.brushId, faceId: selection.faceId };
    if (intent.expansion === "brush")
      session.selectBrushFaces(face.brushId, intent.additive, face.faceId);
    else if (intent.expansion === "coplanar")
      session.selectConnectedCoplanarFaces(face, intent.additive);
    else if (
      activeTool === "face" &&
      !intent.additive &&
      selectedObjects.length > 1
    )
      session.selectMatchingBrushFaces(face, selectedObjects);
    else session.selectFace(face, intent.additive);
  }
  if (!intent.paint) return { kind: "selected" };
  const faces = selectedFaceReferences(session.selection);
  const brushes = selectedBrushIds(session.selection);
  const entities = selectedPointEntityIds(session.selection);
  const count = faces.length || brushes.length + entities.length;
  const subject = faces.length
    ? count === 1
      ? "face"
      : "faces"
    : brushes.length && !entities.length
      ? count === 1
        ? "brush"
        : "brushes"
      : entities.length && !brushes.length
        ? count === 1
          ? "entity"
          : "entities"
        : count === 1
          ? "object"
          : "objects";
  return { kind: "selected", status: `Paint selected ${count} ${subject}` };
}
