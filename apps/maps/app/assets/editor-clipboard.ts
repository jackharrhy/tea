import {
  collaborationEditsBetween,
  createSequentialIdFactory,
  inverseCollaborationEdits,
  objectClipboardPasteOffset,
  parseFaceAttributeClipboard,
  parseMap,
  selectedFaceReferences,
  serializeFaceAttributeClipboard,
  serializeMap,
  serializeObjectClipboard,
  type EditorSession,
  type MapDocument,
} from "@tea/maps-editor/core";
import type { EditorPointerPositionEvent } from "@tea/maps-editor/render";

type PastePlacement = "pointer" | "original";

export function createEditorClipboard(options: {
  session(): EditorSession;
  pointer(): EditorPointerPositionEvent | null;
  gridSize(): number;
  textureLock(): boolean;
  canPaste(): boolean;
  hosted(): boolean;
  prepare(): boolean;
  status(message: string): void;
}) {
  let fallbackText: string | null = null;

  function preflightHostedCandidate(
    session: EditorSession,
    after: MapDocument,
  ) {
    if (!options.hosted()) return;
    const edits = collaborationEditsBetween(session.document, after);
    const inverse = inverseCollaborationEdits(session.document, after);
    if (edits.length > 1_000 || inverse.length > 1_000)
      throw new Error(
        "A hosted paste may contain at most 1,000 semantic edits",
      );
    if (
      new TextEncoder().encode(serializeMap(after)).byteLength >
      2 * 1024 * 1024
    )
      throw new Error("Hosted map source is limited to 2 MiB");
  }

  function copyText(): string | null {
    const session = options.session();
    try {
      const text = session.selection?.faceId
        ? serializeFaceAttributeClipboard(session.document, session.selection)
        : serializeObjectClipboard(session.document, session.selection);
      if (!text) {
        options.status("Select objects or a face before copying");
        return null;
      }
      fallbackText = text;
      options.status(
        session.selection?.faceId
          ? "Copied face material and attributes"
          : "Copied selected objects as map text",
      );
      return text;
    } catch (error) {
      options.status(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  async function copy(): Promise<void> {
    const text = copyText();
    if (!text) return;
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      options.status("Copied inside Maps; system clipboard is unavailable");
    }
  }

  function pasteText(text: string, placement: PastePlacement): boolean {
    if (!options.canPaste()) {
      options.status("Open a local copy before pasting into a hosted map");
      return false;
    }
    if (!text.trim()) return false;
    try {
      const face = parseFaceAttributeClipboard(text);
      if (face) {
        if (!options.prepare()) return false;
        const session = options.session();
        const count = selectedFaceReferences(session.selection).length;
        const candidate = session.createFaceAttributePasteCandidate(face);
        if (!candidate) {
          options.status("Select a target face before pasting face attributes");
          return false;
        }
        preflightHostedCandidate(session, candidate.document);
        session.commitCandidate(candidate);
        fallbackText = text;
        options.status(
          `Pasted ${face.material} onto ${count} ${count === 1 ? "face" : "faces"}`,
        );
        return true;
      }
      const clipboard = parseMap(
        text,
        createSequentialIdFactory(
          `tea-clipboard-source-${crypto.randomUUID()}`,
        ),
      );
      const pointer = placement === "pointer" ? options.pointer() : null;
      if (placement === "pointer" && !pointer) {
        options.status("Move the pointer over a viewport before pasting");
        return false;
      }
      const offset = pointer
        ? objectClipboardPasteOffset(
            clipboard,
            pointer.point,
            pointer.surfaceNormal,
            options.gridSize(),
          )
        : ([0, 0, 0] as const);
      if (!offset) {
        options.status("The clipboard has no pasteable objects");
        return false;
      }
      if (!options.prepare()) return false;
      const session = options.session();
      const candidate = session.createPasteCandidate(
        clipboard,
        createSequentialIdFactory(`tea-clipboard-paste-${crypto.randomUUID()}`),
        offset,
        options.textureLock(),
      );
      if (!candidate) {
        options.status("The clipboard has no pasteable objects");
        return false;
      }
      preflightHostedCandidate(session, candidate.document);
      session.commitDocumentCandidate(candidate);
      fallbackText = text;
      options.status(
        pointer
          ? `Pasted objects at the ${pointer.viewport.toUpperCase()} pointer`
          : "Pasted objects at their original coordinates",
      );
      return true;
    } catch (error) {
      options.status(
        `Clipboard: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async function paste(placement: PastePlacement): Promise<boolean> {
    let text: string | null = null;
    try {
      text = (await navigator.clipboard?.readText()) || null;
    } catch {
      // Copies made inside Maps remain available when clipboard access is denied.
    }
    text ??= fallbackText;
    if (!text) {
      options.status("The clipboard has no map text or face attributes");
      return false;
    }
    return pasteText(text, placement);
  }

  return { copy, copyText, paste, pasteText };
}
