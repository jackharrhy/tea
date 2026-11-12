export interface EditorTransformToolState {
  readonly visible: boolean;
  readonly title: string;
  readonly pivot: readonly [string, string, string];
  readonly updateAngles: boolean;
  readonly updateAnglesDisabled: boolean;
  readonly applyDisabled: boolean;
}

export interface EditorTransformToolContext {
  readonly state: EditorTransformToolState;
  readonly setPivotDraft: (axis: 0 | 1 | 2, value: string) => void;
  readonly commitPivot: () => void;
  readonly resetPivot: () => void;
  readonly setUpdateAngles: (value: boolean) => void;
  readonly apply: () => void;
}

export function initEditorTransformTool(actions: {
  readonly commitPivot: () => void;
  readonly resetPivot: () => void;
  readonly apply: () => void;
}) {
  let state: EditorTransformToolState = {
    visible: false,
    title: "Rotate",
    pivot: ["0", "0", "0"],
    updateAngles: true,
    updateAnglesDisabled: true,
    applyDisabled: true,
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorTransformToolContext>(
        "tea-maps-transform-tool-state",
        {
          detail: { state, setPivotDraft, setUpdateAngles, ...actions },
        },
      ),
    );
  }

  function update(patch: Partial<EditorTransformToolState>) {
    state = { ...state, ...patch };
    publish();
  }

  function setPivotDraft(axis: 0 | 1 | 2, value: string) {
    const pivot = [...state.pivot] as [string, string, string];
    pivot[axis] = value;
    update({ pivot });
  }

  function setUpdateAngles(updateAngles: boolean) {
    update({ updateAngles });
  }

  window.addEventListener("tea-maps-transform-tool-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-transform-tool-bridge-ready"));

  return {
    get state() {
      return state;
    },
    update,
  };
}
