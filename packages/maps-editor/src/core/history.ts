import {
  insertBrush,
  insertBrushes,
  removeBrush,
  removeBrushes,
  replaceBrush,
  replaceBrushes,
  replaceBrushSequence,
  replaceBrushSequences,
  replaceEntityProperties,
  type BrushInsertion,
  type BrushSequenceReplacement,
} from "./document.js";
import { createBrushSelection } from "./selection.js";
import { findBrush } from "./types.js";
import type {
  BrushId,
  EditorObjectViewState,
  EditorSelection,
  EntityId,
  MapBrush,
  MapDocument,
} from "./types.js";

export interface BrushEdit {
  readonly brushId: BrushId;
  readonly baseBrushRevision: number;
  readonly before: MapBrush;
  readonly after: MapBrush;
}

export interface BrushClipEdit {
  readonly entityId: EntityId;
  readonly insertionIndex: number;
  readonly afterInsertionIndex: number;
  readonly baseBrushRevision: number;
  readonly before: MapBrush;
  readonly after: readonly MapBrush[];
}

interface BrushHistoryEntry {
  readonly kind: "replace-brush";
  readonly label: string;
  readonly brushId: BrushId;
  readonly before: MapBrush;
  readonly after: MapBrush;
}

interface BrushBatchHistoryEntry {
  readonly kind: "replace-brushes";
  readonly label: string;
  readonly edits: readonly BrushEdit[];
}

interface BrushCreationHistoryEntry {
  readonly kind: "create-brush";
  readonly label: string;
  readonly entityId: EntityId;
  readonly insertionIndex: number;
  readonly brush: MapBrush;
}

interface BrushDeletionHistoryEntry {
  readonly kind: "delete-brush";
  readonly label: string;
  readonly entityId: EntityId;
  readonly insertionIndex: number;
  readonly brush: MapBrush;
}

interface BrushBatchCreationHistoryEntry {
  readonly kind: "create-brushes";
  readonly label: string;
  readonly insertions: readonly BrushInsertion[];
  readonly selectionBefore?: EditorSelection | null;
  readonly selectionAfter?: readonly BrushId[];
}

interface BrushBatchDeletionHistoryEntry {
  readonly kind: "delete-brushes";
  readonly label: string;
  readonly insertions: readonly BrushInsertion[];
}

interface BrushClipHistoryEntry {
  readonly kind: "clip-brush";
  readonly label: string;
  readonly entityId: EntityId;
  readonly insertionIndex: number;
  readonly before: MapBrush;
  readonly after: readonly MapBrush[];
}

interface BrushBatchClipHistoryEntry {
  readonly kind: "clip-brushes";
  readonly label: string;
  readonly edits: readonly BrushClipEdit[];
  readonly selectionBefore: readonly BrushId[];
  readonly selectionAfter: readonly BrushId[];
}

interface BrushSequenceHistoryEntry {
  readonly kind: "replace-brush-sequences";
  readonly label: string;
  readonly edits: readonly BrushClipEdit[];
  readonly selectionBefore: readonly BrushId[];
  readonly selectionAfter: readonly BrushId[];
}

interface EntityPropertiesHistoryEntry {
  readonly kind: "replace-entity-properties";
  readonly label: string;
  readonly entityId: EntityId;
  readonly before: Readonly<Record<string, string>>;
  readonly after: Readonly<Record<string, string>>;
}

interface DocumentSnapshotHistoryEntry {
  readonly kind: "replace-document";
  readonly label: string;
  readonly before: MapDocument;
  readonly after: MapDocument;
  readonly selectionBefore: EditorSelection | null;
  readonly selectionAfter: EditorSelection | null;
}

interface ObjectViewStateHistoryEntry {
  readonly kind: "view-state";
  readonly label: string;
  readonly before: EditorObjectViewState;
  readonly after: EditorObjectViewState;
  readonly selectionBefore: EditorSelection | null;
  readonly selectionAfter: EditorSelection | null;
}

export type HistoryEntry =
  | BrushHistoryEntry
  | BrushBatchHistoryEntry
  | BrushCreationHistoryEntry
  | BrushDeletionHistoryEntry
  | BrushBatchCreationHistoryEntry
  | BrushBatchDeletionHistoryEntry
  | BrushClipHistoryEntry
  | BrushBatchClipHistoryEntry
  | BrushSequenceHistoryEntry
  | EntityPropertiesHistoryEntry
  | DocumentSnapshotHistoryEntry
  | ObjectViewStateHistoryEntry;

export interface EditorHistoryState {
  readonly document: MapDocument;
  readonly selection: EditorSelection | null;
  readonly objectViewState: EditorObjectViewState;
}

export type HistoryDirection = "undo" | "redo";

const MAX_HISTORY_ENTRIES = 100;

function revisionForApply(current: MapBrush, content: MapBrush): MapBrush {
  return { ...content, revision: current.revision + 1 };
}

function documentRevisionForApply(
  current: MapDocument,
  content: MapDocument,
): MapDocument {
  return { ...content, revision: current.revision + 1 };
}

function requiredBrush(
  document: MapDocument,
  brushId: BrushId,
  action: string,
): MapBrush {
  const brush = findBrush(document, brushId);
  if (!brush) throw new Error(`Cannot ${action} missing brush ${brushId}`);
  return brush;
}

function applyBrushSequenceEdits(
  document: MapDocument,
  edits: readonly BrushClipEdit[],
  direction: HistoryDirection,
): MapDocument {
  if (direction === "undo") {
    const sequences: BrushSequenceReplacement[] = edits
      .toReversed()
      .map((edit) => {
        const currentOriginal = edit.after
          .map((brush) => findBrush(document, brush.id))
          .find((brush) => brush?.id === edit.before.id);
        return {
          entityId: edit.entityId,
          insertionIndex: edit.afterInsertionIndex,
          expectedBrushIds: edit.after.map((brush) => brush.id),
          replacements: [
            {
              ...edit.before,
              revision: (currentOriginal?.revision ?? edit.before.revision) + 1,
            },
          ],
        };
      });
    return replaceBrushSequences(document, sequences);
  }

  const sequences: BrushSequenceReplacement[] = edits.map((edit) => {
    const current = requiredBrush(
      document,
      edit.before.id,
      "redo brush replacement of",
    );
    return {
      entityId: edit.entityId,
      insertionIndex: edit.insertionIndex,
      expectedBrushIds: [edit.before.id],
      replacements: edit.after.map((brush) =>
        brush.id === current.id ? revisionForApply(current, brush) : brush,
      ),
    };
  });
  return replaceBrushSequences(document, sequences);
}

/** Applies one history entry in either direction so undo and redo cannot drift apart. */
export function applyHistoryEntry(
  state: EditorHistoryState,
  entry: HistoryEntry,
  direction: HistoryDirection,
): EditorHistoryState {
  let { document, selection, objectViewState } = state;
  const undoing = direction === "undo";

  if (entry.kind === "replace-brush") {
    const current = requiredBrush(
      document,
      entry.brushId,
      `${direction} change to`,
    );
    document = replaceBrush(
      document,
      revisionForApply(current, undoing ? entry.before : entry.after),
    );
  } else if (entry.kind === "replace-brushes") {
    document = replaceBrushes(
      document,
      entry.edits.map((edit) => {
        const current = requiredBrush(
          document,
          edit.brushId,
          `${direction} change to`,
        );
        return revisionForApply(current, undoing ? edit.before : edit.after);
      }),
    );
  } else if (entry.kind === "create-brush" || entry.kind === "delete-brush") {
    const inserting = (entry.kind === "create-brush") !== undoing;
    document = inserting
      ? insertBrush(document, entry.entityId, entry.brush, entry.insertionIndex)
      : removeBrush(document, entry.brush.id);
    if (inserting) selection = { brushId: entry.brush.id };
    else if (selection?.brushId === entry.brush.id) selection = null;
  } else if (
    entry.kind === "create-brushes" ||
    entry.kind === "delete-brushes"
  ) {
    const inserting = (entry.kind === "create-brushes") !== undoing;
    document = inserting
      ? insertBrushes(document, entry.insertions)
      : removeBrushes(
          document,
          entry.insertions.map((insertion) => insertion.brush.id),
        );
    if (entry.kind === "create-brushes") {
      selection = undoing
        ? (entry.selectionBefore ?? null)
        : createBrushSelection(
            entry.selectionAfter ??
              entry.insertions.map((insertion) => insertion.brush.id),
          );
    } else {
      selection = undoing
        ? createBrushSelection(
            entry.insertions.map((insertion) => insertion.brush.id),
          )
        : null;
    }
  } else if (entry.kind === "clip-brush") {
    if (undoing) {
      const currentOriginal = entry.after
        .map((brush) => findBrush(document, brush.id))
        .find((brush) => brush?.id === entry.before.id);
      const restored = {
        ...entry.before,
        revision: (currentOriginal?.revision ?? entry.before.revision) + 1,
      };
      document = replaceBrushSequence(
        document,
        entry.entityId,
        entry.insertionIndex,
        entry.after.map((brush) => brush.id),
        [restored],
      );
      selection = { brushId: restored.id };
    } else {
      const current = requiredBrush(document, entry.before.id, "redo clip of");
      const reapplied = entry.after.map((brush) =>
        brush.id === current.id ? revisionForApply(current, brush) : brush,
      );
      document = replaceBrushSequence(
        document,
        entry.entityId,
        entry.insertionIndex,
        [entry.before.id],
        reapplied,
      );
      selection = reapplied[0] ? { brushId: reapplied[0].id } : null;
    }
  } else if (
    entry.kind === "clip-brushes" ||
    entry.kind === "replace-brush-sequences"
  ) {
    document = applyBrushSequenceEdits(document, entry.edits, direction);
    selection = createBrushSelection(
      undoing ? entry.selectionBefore : entry.selectionAfter,
    );
  } else if (entry.kind === "replace-entity-properties") {
    document = replaceEntityProperties(
      document,
      entry.entityId,
      undoing ? entry.before : entry.after,
    );
  } else if (entry.kind === "view-state") {
    objectViewState = undoing ? entry.before : entry.after;
    selection = undoing ? entry.selectionBefore : entry.selectionAfter;
  } else {
    document = documentRevisionForApply(
      document,
      undoing ? entry.before : entry.after,
    );
    selection = undoing ? entry.selectionBefore : entry.selectionAfter;
  }

  return { document, selection, objectViewState };
}

/** Owns stack limits and redo invalidation; EditorSession owns only domain mutations. */
export class EditorHistory {
  private readonly undoEntries: HistoryEntry[] = [];
  private readonly redoEntries: HistoryEntry[] = [];

  public get canUndo(): boolean {
    return this.undoEntries.length > 0;
  }

  public get canRedo(): boolean {
    return this.redoEntries.length > 0;
  }

  public get undoLabel(): string | null {
    return this.undoEntries.at(-1)?.label ?? null;
  }

  public get redoLabel(): string | null {
    return this.redoEntries.at(-1)?.label ?? null;
  }

  public clear(): void {
    this.undoEntries.length = 0;
    this.redoEntries.length = 0;
  }

  public record(entry: HistoryEntry): void {
    this.undoEntries.push(entry);
    if (this.undoEntries.length > MAX_HISTORY_ENTRIES) this.undoEntries.shift();
    this.redoEntries.length = 0;
  }

  public takeUndo(): HistoryEntry | null {
    return this.undoEntries.pop() ?? null;
  }

  public takeRedo(): HistoryEntry | null {
    return this.redoEntries.pop() ?? null;
  }

  public completeUndo(entry: HistoryEntry): void {
    this.redoEntries.push(entry);
  }

  public completeRedo(entry: HistoryEntry): void {
    this.undoEntries.push(entry);
  }
}
