export interface EditorSelectionCommandState {
  readonly deleteDisabled: boolean;
  readonly duplicateDisabled: boolean;
  readonly focusDisabled: boolean;
  readonly hideDisabled: boolean;
  readonly showAllDisabled: boolean;
  readonly unlockAllDisabled: boolean;
}

export interface EditorSelectionCommandActions {
  readonly delete: () => void;
  readonly duplicate: () => void;
  readonly selectAll: () => void;
  readonly invert: () => void;
  readonly focus: () => void;
  readonly hide: () => void;
  readonly isolate: () => void;
  readonly showAll: () => void;
  readonly lock: () => void;
  readonly unlockAll: () => void;
}

export interface EditorSelectionCommandsContext {
  readonly state: EditorSelectionCommandState;
  readonly actions: EditorSelectionCommandActions;
}

export function initEditorSelectionCommands(
  actions: EditorSelectionCommandActions,
) {
  let state: EditorSelectionCommandState = {
    deleteDisabled: true,
    duplicateDisabled: true,
    focusDisabled: true,
    hideDisabled: true,
    showAllDisabled: true,
    unlockAllDisabled: true,
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorSelectionCommandsContext>(
        "tea-maps-selection-commands-state",
        { detail: { state, actions } },
      ),
    );
  }

  window.addEventListener("tea-maps-selection-commands-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-selection-commands-bridge-ready"));

  return {
    get state() {
      return state;
    },
    update(patch: Partial<EditorSelectionCommandState>) {
      state = { ...state, ...patch };
      publish();
    },
  };
}
