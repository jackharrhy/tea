import { EditorHistory } from "./history.js";
import { type EditorLayerId } from "./layers.js";
import {
  DEFAULT_EDITOR_VIEW_FILTER_STATE,
  type EditorViewFilterState,
} from "./view-filters.js";
import type {
  BrushId,
  EditorObjectViewState,
  EditorSelection,
  EntityId,
  IdFactory,
  MapDocument,
} from "./types.js";
import { createSequentialIdFactory } from "./types.js";
import type {
  ChangeListener,
  EditorRepeatableCommand,
  EditorSessionChange,
} from "./session-common.js";

/** Shared session state; document/history mutations belong to the commit coordinator. */
export class SessionKernel {
  public document: MapDocument;
  public selection: EditorSelection | null = null;
  public readonly history = new EditorHistory();
  public hiddenBrushIds = new Set<BrushId>();
  public hiddenEntityIds = new Set<EntityId>();
  public lockedBrushIds = new Set<BrushId>();
  public lockedEntityIds = new Set<EntityId>();
  public editingGroupId: string | null = null;
  public layerId: EditorLayerId = null;
  public viewFilters: EditorViewFilterState = DEFAULT_EDITOR_VIEW_FILTER_STATE;
  public repeatableCommands: EditorRepeatableCommand[] = [];
  public repeatSequence = 0;
  public suppressRepeatRecording = false;
  public readonly linkedSyncIds: IdFactory =
    createSequentialIdFactory("maps-linked-sync");
  public readonly issueFixIds: IdFactory =
    createSequentialIdFactory("maps-issue-fix");

  private readonly listeners = new Set<ChangeListener>();

  public constructor(document: MapDocument) {
    this.document = document;
  }

  public subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public notify(kind: EditorSessionChange["kind"], label: string): void {
    const change = {
      kind,
      label,
      documentRevision: this.document.revision,
    } as const;
    for (const listener of this.listeners) listener(change);
  }

  public snapshotObjectViewState(): EditorObjectViewState {
    return {
      hiddenBrushIds: [...this.hiddenBrushIds].toSorted(),
      hiddenEntityIds: [...this.hiddenEntityIds].toSorted(),
      lockedBrushIds: [...this.lockedBrushIds].toSorted(),
      lockedEntityIds: [...this.lockedEntityIds].toSorted(),
    };
  }

  public applyObjectViewState(state: EditorObjectViewState): void {
    this.hiddenBrushIds = new Set(state.hiddenBrushIds);
    this.hiddenEntityIds = new Set(state.hiddenEntityIds);
    this.lockedBrushIds = new Set(state.lockedBrushIds);
    this.lockedEntityIds = new Set(state.lockedEntityIds);
  }

  public discardRepeatableCommands(): void {
    this.repeatableCommands = [];
  }

  public recordRepeatableCommand(
    command: EditorRepeatableCommand | undefined,
  ): void {
    if (!command || this.suppressRepeatRecording) return;
    this.repeatableCommands.push(command);
  }

  public replaceDocument(document: MapDocument): void {
    this.document = document;
    this.selection = null;
    this.editingGroupId = null;
    this.layerId = null;
    this.discardRepeatableCommands();
    this.repeatSequence = 0;
    this.applyObjectViewState({
      hiddenBrushIds: [],
      hiddenEntityIds: [],
      lockedBrushIds: [],
      lockedEntityIds: [],
    });
    this.history.clear();
  }
}
