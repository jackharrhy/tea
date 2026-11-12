export interface EditorEditActionState {
  readonly snapDisabled: boolean;
  readonly repeatDisabled: boolean;
  readonly repeatLabel: string;
  readonly repeatTitle: string;
  readonly clearRepeatDisabled: boolean;
  readonly clearRepeatTitle: string;
  readonly copyDisabled: boolean;
  readonly pastePointerDisabled: boolean;
  readonly pasteOriginalDisabled: boolean;
}

export interface EditorEditActionCommands {
  readonly snap: () => void;
  readonly repeat: () => void;
  readonly clearRepeat: () => void;
  readonly copy: () => void;
  readonly pastePointer: () => void;
  readonly pasteOriginal: () => void;
}

export interface EditorEditActionsContext {
  readonly state: EditorEditActionState;
  readonly commands: EditorEditActionCommands;
}

export function initEditorEditActions(commands: EditorEditActionCommands) {
  let state: EditorEditActionState = {
    snapDisabled: true,
    repeatDisabled: true,
    repeatLabel: "Repeat",
    repeatTitle:
      "Record duplicate, move, rotate, flip, scale, or shear commands first",
    clearRepeatDisabled: true,
    clearRepeatTitle: "No recorded command sequence",
    copyDisabled: true,
    pastePointerDisabled: true,
    pasteOriginalDisabled: true,
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorEditActionsContext>("tea-maps-edit-actions-state", {
        detail: { state, commands },
      }),
    );
  }

  window.addEventListener("tea-maps-edit-actions-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-edit-actions-bridge-ready"));

  return {
    get state() {
      return state;
    },
    update(patch: Partial<EditorEditActionState>) {
      state = { ...state, ...patch };
      publish();
    },
  };
}
