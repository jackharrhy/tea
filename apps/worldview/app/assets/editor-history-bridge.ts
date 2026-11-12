export interface EditorHistoryState {
  readonly undoDisabled: boolean;
  readonly redoDisabled: boolean;
  readonly undoTitle: string;
  readonly redoTitle: string;
}

export interface EditorHistoryContext {
  readonly state: EditorHistoryState;
  readonly undo: () => void;
  readonly redo: () => void;
}

export function initEditorHistory(actions: {
  readonly undo: () => void;
  readonly redo: () => void;
}) {
  let state: EditorHistoryState = {
    undoDisabled: true,
    redoDisabled: true,
    undoTitle: "Undo",
    redoTitle: "Redo",
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorHistoryContext>("tea-maps-history-state", {
        detail: { state, undo: actions.undo, redo: actions.redo },
      }),
    );
  }

  window.addEventListener("tea-maps-history-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-history-bridge-ready"));

  return {
    get state() {
      return state;
    },
    update(patch: Partial<EditorHistoryState>) {
      state = { ...state, ...patch };
      publish();
    },
  };
}
