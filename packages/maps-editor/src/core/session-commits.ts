import {
  insertBrush,
  insertBrushes,
  replaceBrush,
  replaceBrushes,
} from "./document.js";
import { deriveBrush } from "./geometry.js";
import { applyHistoryEntry } from "./history.js";
import {
  applyCollaborationOperation,
  type CollaborationApplyResult,
  type CollaborationOperation,
} from "./collaboration.js";
import { createBrushSelection } from "./selection.js";
import type {
  EditorObjectViewState,
  EditorSelection,
  MapDocument,
} from "./types.js";
import { findBrush } from "./types.js";
import {
  documentRevisionForApply,
  type BrushBatchCreationCandidate,
  type BrushBatchEditCandidate,
  type BrushCreationCandidate,
  type BrushEditCandidate,
  type DocumentEditCandidate,
  type SessionCommitMutation,
} from "./session-common.js";
import type { SessionKernel } from "./session-kernel.js";

type SessionCommitKernel = Pick<
  SessionKernel,
  | "applyObjectViewState"
  | "discardRepeatableCommands"
  | "document"
  | "history"
  | "notify"
  | "recordRepeatableCommand"
  | "selection"
  | "snapshotObjectViewState"
>;

export interface SessionCommitPorts {
  readonly hasLinkedEditingGroup: (document?: MapDocument) => boolean;
  readonly synchronizeEditingGroup: (document: MapDocument) => MapDocument;
}

export class SessionCommitCommands {
  public constructor(
    private readonly kernel: SessionCommitKernel,
    private readonly ports: SessionCommitPorts,
  ) {}

  /** The only generic document/history mutation point used by command domains. */
  public commitMutation(mutation: SessionCommitMutation): void {
    this.kernel.document = mutation.document;
    this.kernel.selection = mutation.selection;
    this.kernel.history.record(mutation.historyEntry);
    this.kernel.notify(
      mutation.changeKind ?? "document",
      mutation.historyEntry.label,
    );
  }

  /** Applies an already sequenced remote commit without adding it to this actor's undo stack. */
  public applyRemoteCollaborationOperation(
    operation: CollaborationOperation,
  ): CollaborationApplyResult {
    const result = applyCollaborationOperation(this.kernel.document, operation);
    if (result.status !== "applied") return result;
    this.kernel.document = result.document;
    this.kernel.discardRepeatableCommands();
    this.kernel.notify("document", operation.label);
    return result;
  }

  public commitCandidate(
    candidate: BrushEditCandidate | BrushBatchEditCandidate,
  ): void {
    if ("edits" in candidate) {
      this.commitBatchCandidate(candidate);
      return;
    }
    if (this.kernel.document.revision !== candidate.baseDocumentRevision) {
      throw new Error(
        "Cannot commit an edit candidate created from a stale document revision",
      );
    }
    const current = findBrush(this.kernel.document, candidate.brushId);
    if (!current || current.revision !== candidate.baseBrushRevision) {
      throw new Error(
        "Cannot commit an edit candidate created from a stale brush revision",
      );
    }
    const derived = deriveBrush(candidate.after);
    if (!derived.valid) {
      throw new Error(
        derived.diagnostics.map((diagnostic) => diagnostic.message).join("; "),
      );
    }
    if (this.ports.hasLinkedEditingGroup(candidate.document)) {
      this.commitDocumentCandidate({
        label: candidate.label,
        baseDocumentRevision: candidate.baseDocumentRevision,
        before: this.kernel.document,
        after: candidate.document,
        selectionBefore: this.kernel.selection,
        selectionAfter: this.kernel.selection,
        document: candidate.document,
      });
      return;
    }
    this.commitMutation({
      document: replaceBrush(this.kernel.document, candidate.after),
      selection: this.kernel.selection,
      historyEntry: {
        kind: "replace-brush",
        label: candidate.label,
        brushId: candidate.brushId,
        before: candidate.before,
        after: candidate.after,
      },
    });
  }

  private commitBatchCandidate(candidate: BrushBatchEditCandidate): void {
    if (this.kernel.document.revision !== candidate.baseDocumentRevision) {
      throw new Error(
        "Cannot commit an edit candidate created from a stale document revision",
      );
    }
    for (const edit of candidate.edits) {
      const current = findBrush(this.kernel.document, edit.brushId);
      if (!current || current.revision !== edit.baseBrushRevision) {
        throw new Error(
          "Cannot commit an edit candidate created from a stale brush revision",
        );
      }
      const derived = deriveBrush(edit.after);
      if (!derived.valid) {
        throw new Error(
          derived.diagnostics
            .map((diagnostic) => diagnostic.message)
            .join("; "),
        );
      }
    }
    if (this.ports.hasLinkedEditingGroup(candidate.document)) {
      this.commitDocumentCandidate({
        label: candidate.label,
        baseDocumentRevision: candidate.baseDocumentRevision,
        before: this.kernel.document,
        after: candidate.document,
        selectionBefore: this.kernel.selection,
        selectionAfter: this.kernel.selection,
        document: candidate.document,
      });
      return;
    }
    this.commitMutation({
      document: replaceBrushes(
        this.kernel.document,
        candidate.edits.map((edit) => edit.after),
      ),
      selection: this.kernel.selection,
      historyEntry: {
        kind: "replace-brushes",
        label: candidate.label,
        edits: candidate.edits,
      },
    });
  }

  public commitCreationCandidate(candidate: BrushCreationCandidate): void {
    if (this.kernel.document.revision !== candidate.baseDocumentRevision) {
      throw new Error(
        "Cannot commit a creation candidate from a stale document revision",
      );
    }
    const derived = deriveBrush(candidate.brush);
    if (!derived.valid) {
      throw new Error(
        derived.diagnostics.map((diagnostic) => diagnostic.message).join("; "),
      );
    }
    if (this.ports.hasLinkedEditingGroup(candidate.document)) {
      this.commitDocumentCandidate({
        label: candidate.label,
        baseDocumentRevision: candidate.baseDocumentRevision,
        before: this.kernel.document,
        after: candidate.document,
        selectionBefore: this.kernel.selection,
        selectionAfter: { brushId: candidate.brush.id },
        document: candidate.document,
      });
      return;
    }
    this.commitMutation({
      document: insertBrush(
        this.kernel.document,
        candidate.entityId,
        candidate.brush,
        candidate.insertionIndex,
      ),
      selection: { brushId: candidate.brush.id },
      historyEntry: {
        kind: "create-brush",
        label: candidate.label,
        entityId: candidate.entityId,
        insertionIndex: candidate.insertionIndex,
        brush: candidate.brush,
      },
    });
  }

  public commitBatchCreationCandidate(
    candidate: BrushBatchCreationCandidate,
  ): void {
    if (this.kernel.document.revision !== candidate.baseDocumentRevision) {
      throw new Error(
        "Cannot commit a batch creation candidate from a stale document revision",
      );
    }
    for (const insertion of candidate.insertions) {
      const derived = deriveBrush(insertion.brush);
      if (!derived.valid) {
        throw new Error(
          derived.diagnostics
            .map((diagnostic) => diagnostic.message)
            .join("; "),
        );
      }
    }
    if (this.ports.hasLinkedEditingGroup(candidate.document)) {
      this.commitDocumentCandidate({
        label: candidate.label,
        baseDocumentRevision: candidate.baseDocumentRevision,
        before: this.kernel.document,
        after: candidate.document,
        selectionBefore: candidate.selectionBefore,
        selectionAfter: createBrushSelection(candidate.selectionAfter),
        document: candidate.document,
      });
      return;
    }
    this.commitMutation({
      document: insertBrushes(this.kernel.document, candidate.insertions),
      selection: createBrushSelection(candidate.selectionAfter),
      historyEntry: {
        kind: "create-brushes",
        label: candidate.label,
        insertions: candidate.insertions,
        selectionBefore: candidate.selectionBefore,
        selectionAfter: candidate.selectionAfter,
      },
    });
  }

  public commitDocumentCandidate(candidate: DocumentEditCandidate): void {
    if (this.kernel.document.revision !== candidate.baseDocumentRevision) {
      throw new Error(
        "Cannot commit a document candidate from a stale document revision",
      );
    }
    const synchronizedAfter = this.ports.synchronizeEditingGroup(
      candidate.after,
    );
    this.kernel.recordRepeatableCommand(candidate.repeatable);
    this.commitMutation({
      document: documentRevisionForApply(
        this.kernel.document,
        synchronizedAfter,
      ),
      selection: candidate.selectionAfter,
      historyEntry: {
        kind: "replace-document",
        label: candidate.label,
        before: candidate.before,
        after: synchronizedAfter,
        selectionBefore: candidate.selectionBefore,
        selectionAfter: candidate.selectionAfter,
      },
    });
  }

  public commitObjectViewState(
    label: string,
    state: EditorObjectViewState,
    selectionAfter: EditorSelection | null,
  ): boolean {
    const before = this.kernel.snapshotObjectViewState();
    this.kernel.applyObjectViewState(state);
    const after = this.kernel.snapshotObjectViewState();
    const unchanged =
      before.hiddenBrushIds.join("\u0000") ===
        after.hiddenBrushIds.join("\u0000") &&
      before.hiddenEntityIds.join("\u0000") ===
        after.hiddenEntityIds.join("\u0000") &&
      before.lockedBrushIds.join("\u0000") ===
        after.lockedBrushIds.join("\u0000") &&
      before.lockedEntityIds.join("\u0000") ===
        after.lockedEntityIds.join("\u0000");
    if (unchanged) return false;
    this.commitMutation({
      document: this.kernel.document,
      selection: selectionAfter,
      historyEntry: {
        kind: "view-state",
        label,
        before,
        after,
        selectionBefore: this.kernel.selection,
        selectionAfter,
      },
      changeKind: "view",
    });
    return true;
  }

  private applyHistory(direction: "undo" | "redo"): boolean {
    const entry =
      direction === "undo"
        ? this.kernel.history.takeUndo()
        : this.kernel.history.takeRedo();
    if (!entry) return false;

    this.kernel.discardRepeatableCommands();
    const next = applyHistoryEntry(
      {
        document: this.kernel.document,
        selection: this.kernel.selection,
        objectViewState: this.kernel.snapshotObjectViewState(),
      },
      entry,
      direction,
    );
    this.kernel.document = next.document;
    this.kernel.selection = next.selection;
    this.kernel.applyObjectViewState(next.objectViewState);

    if (direction === "undo") this.kernel.history.completeUndo(entry);
    else this.kernel.history.completeRedo(entry);
    const changeKind = entry.kind === "view-state" ? "view" : "history";
    const action = direction === "undo" ? "Undo" : "Redo";
    this.kernel.notify(changeKind, `${action} ${entry.label}`);
    return true;
  }

  public undo(): boolean {
    return this.applyHistory("undo");
  }

  public redo(): boolean {
    return this.applyHistory("redo");
  }
}
