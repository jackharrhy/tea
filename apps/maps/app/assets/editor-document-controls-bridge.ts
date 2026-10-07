export interface EditorDocumentControlState {
  readonly saveDisabled: boolean;
  readonly checkpointDisabled: boolean;
  readonly downloadLabel: string;
}

export interface EditorDocumentControlActions {
  readonly newMap: () => Promise<void>;
  readonly exampleMap: () => Promise<void>;
  readonly openPicker: () => Promise<void>;
  readonly openFile: (file: File) => Promise<void>;
  readonly openProject: () => Promise<void>;
  readonly save: () => Promise<boolean>;
  readonly exportNormalized: () => void;
  readonly checkpoint: (label: string) => Promise<boolean>;
  readonly showVersions: () => Promise<void>;
  readonly download: () => void;
}

export interface EditorDocumentControlsContext {
  readonly state: EditorDocumentControlState;
  readonly actions: EditorDocumentControlActions;
}

export function initEditorDocumentControls(
  actions: EditorDocumentControlActions,
) {
  let state: EditorDocumentControlState = {
    saveDisabled: true,
    checkpointDisabled: true,
    downloadLabel: "Download .map",
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorDocumentControlsContext>(
        "tea-maps-document-controls-state",
        { detail: { state, actions } },
      ),
    );
  }

  window.addEventListener("tea-maps-document-controls-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-document-controls-bridge-ready"));

  return {
    update(patch: Partial<EditorDocumentControlState>) {
      state = { ...state, ...patch };
      publish();
    },
  };
}
