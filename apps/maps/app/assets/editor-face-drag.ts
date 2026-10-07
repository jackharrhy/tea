import {
  createSequentialIdFactory,
  extrudableBrushFaces,
  selectedBrushIds,
  selectedFaceReferences,
  type EditorSession,
  type FaceSelection,
} from "@tea/maps-editor/core";
import {
  type EditorFaceDragEvent,
  type EditorSourceRenderer,
} from "@tea/maps-editor/render";

type FaceCandidate =
  | NonNullable<ReturnType<EditorSession["createFaceSetTranslationCandidate"]>>
  | NonNullable<ReturnType<EditorSession["createFaceSetSplitCandidate"]>>
  | NonNullable<ReturnType<EditorSession["createFaceStampCandidate"]>>;

function candidateBrushIds(candidate: FaceCandidate): readonly string[] {
  if ("insertions" in candidate)
    return candidate.insertions.map((insertion) => insertion.brush.id);
  if ("mode" in candidate)
    return candidate.edits.flatMap((edit) => [
      edit.before.id,
      ...edit.after.map((brush) => brush.id),
    ]);
  return "edits" in candidate
    ? candidate.edits.map((edit) => edit.brushId)
    : [candidate.brushId];
}

function gestureKind(event: EditorFaceDragEvent): string {
  return event.mode === "translate"
    ? "translate"
    : event.stamp
      ? "stamp"
      : event.split
        ? "split"
        : "extrude";
}

export function createFaceDragController(options: {
  session(): EditorSession;
  renderer(): EditorSourceRenderer | null;
  textureLock(): boolean;
  canEdit(): boolean;
  status(message: string): void;
}) {
  let candidate: FaceCandidate | null = null;
  let candidateKind: string | null = null;
  let gesturePrefix: string | null = null;

  function reset() {
    candidate = null;
    candidateKind = null;
    gesturePrefix = null;
  }

  function restore() {
    options
      .renderer()
      ?.setDocument(options.session().document, options.session().selection);
  }

  function createCandidate(event: EditorFaceDragEvent): FaceCandidate | null {
    const session = options.session();
    const primary = {
      brushId: event.selection.brushId,
      faceId: event.selection.faceId,
    };
    const selectedFaces = selectedFaceReferences(session.selection);
    const selectedBrushes = selectedBrushIds(session.selection);
    let faces: readonly FaceSelection[] = [primary];
    if (
      selectedFaces.some(
        (face) =>
          face.brushId === primary.brushId && face.faceId === primary.faceId,
      )
    ) {
      faces = selectedFaces;
    } else if (
      event.mode === "normal" &&
      !event.stamp &&
      selectedBrushes.includes(primary.brushId)
    ) {
      faces = extrudableBrushFaces(session.document, primary, selectedBrushes);
    }
    gesturePrefix ??= `tea-face-${crypto.randomUUID()}`;
    const ids = createSequentialIdFactory(gesturePrefix);
    if (event.mode === "translate")
      return session.createFaceSetTranslationCandidate(
        faces,
        event.delta,
        ids,
        options.textureLock(),
      );
    if (event.stamp)
      return session.createFaceStampCandidate(
        faces,
        primary,
        event.distance,
        ids,
        options.textureLock(),
      );
    if (event.split)
      return session.createFaceSetSplitCandidate(
        faces,
        primary,
        event.distance,
        ids,
      );
    return session.createFaceSetExtrusionCandidate(
      faces,
      primary,
      event.distance,
    );
  }

  function handle(event: EditorFaceDragEvent) {
    const moved =
      event.mode === "translate"
        ? event.delta.some((value) => Math.abs(value) > Number.EPSILON)
        : Math.abs(event.distance) > Number.EPSILON;
    if (event.phase === "cancel" || !moved) {
      reset();
      restore();
      return;
    }
    if (!options.canEdit()) return;
    try {
      const kind = gestureKind(event);
      let next: FaceCandidate | null;
      try {
        next = createCandidate(event);
      } catch (error) {
        if (
          !candidate ||
          candidateKind !== kind ||
          candidate.baseDocumentRevision !== options.session().document.revision
        ) {
          throw error;
        }
        next = candidate;
        if (event.phase === "preview") {
          options.status(
            "Face limit reached; release to keep the last valid shape",
          );
          return;
        }
      }
      if (!next) return;
      if (event.phase === "preview") {
        candidate = next;
        candidateKind = kind;
        options
          .renderer()
          ?.setPreviewDocument(
            next.document,
            options.session().selection,
            candidateBrushIds(next),
          );
        return;
      }
      if ("insertions" in next)
        options.session().commitBatchCreationCandidate(next);
      else if ("mode" in next) options.session().commitClipCandidate(next);
      else options.session().commitCandidate(next);
      reset();
    } catch (error) {
      reset();
      restore();
      options.status(error instanceof Error ? error.message : String(error));
    }
  }

  return { handle, reset };
}
