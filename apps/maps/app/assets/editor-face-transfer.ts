import type { EditorSession } from "@tea/maps-editor/core";
import type {
  EditorFaceTransferEvent,
  EditorSourceRenderer,
} from "@tea/maps-editor/render";

export function handleFaceTransfer(
  event: EditorFaceTransferEvent,
  options: {
    session: EditorSession;
    renderer: EditorSourceRenderer | null;
    canEdit(): boolean;
    status(message: string): void;
  },
) {
  if (event.phase === "cancel") {
    options.renderer?.setDocument(
      options.session.document,
      options.session.selection,
    );
    return;
  }
  if (!options.canEdit()) return;
  try {
    const candidate = options.session.createFaceAttributeTransferCandidate(
      event.source,
      event.targets,
      event.mode,
    );
    if (!candidate) return;
    if (event.phase === "preview") {
      options.renderer?.setPreviewDocument(
        candidate.document,
        options.session.selection,
        "edits" in candidate
          ? candidate.edits.map((edit) => edit.brushId)
          : [candidate.brushId],
      );
      return;
    }
    options.session.commitCandidate(candidate);
  } catch (error) {
    options.renderer?.setDocument(
      options.session.document,
      options.session.selection,
    );
    options.status(error instanceof Error ? error.message : String(error));
  }
}
