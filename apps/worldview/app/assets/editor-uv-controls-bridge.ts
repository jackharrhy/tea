export interface EditorUvControlsState {
  readonly status: string;
  readonly disabled: boolean;
  readonly gridX: string;
  readonly gridY: string;
}

export interface EditorUvControlsContext {
  readonly state: EditorUvControlsState;
  readonly frame: () => void;
  readonly resetPivot: () => void;
  readonly setGridDraft: (axis: 0 | 1, value: string) => void;
  readonly commitGrid: (axis: 0 | 1, value: number) => void;
}

export function initEditorUvControls(actions: {
  readonly frame: () => void;
  readonly resetPivot: () => void;
  readonly commitGrid: (axis: 0 | 1, value: number) => void;
}) {
  let state: EditorUvControlsState = {
    status: "Select a brush face",
    disabled: true,
    gridX: "1",
    gridY: "1",
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorUvControlsContext>("tea-maps-uv-controls-state", {
        detail: { state, setGridDraft, ...actions },
      }),
    );
  }

  function update(patch: Partial<EditorUvControlsState>) {
    state = { ...state, ...patch };
    publish();
  }

  function setGridDraft(axis: 0 | 1, value: string) {
    update(axis === 0 ? { gridX: value } : { gridY: value });
  }

  window.addEventListener("tea-maps-uv-controls-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-uv-controls-bridge-ready"));

  return { update };
}
