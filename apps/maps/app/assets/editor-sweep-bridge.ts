import type { SweepPath } from "@tea/maps-editor/core";

export type SweepField =
  | "translateX"
  | "translateY"
  | "translateZ"
  | "rotateX"
  | "rotateY"
  | "rotateZ"
  | "scale"
  | "segments"
  | "iterations";

export type SweepFields = Readonly<Record<SweepField, string>>;

export const initialSweepFields: SweepFields = {
  translateX: "0",
  translateY: "0",
  translateZ: "64",
  rotateX: "0",
  rotateY: "0",
  rotateZ: "0",
  scale: "1",
  segments: "4",
  iterations: "1",
};

export interface EditorSweepPanelState {
  readonly visible: boolean;
  readonly count: string;
  readonly applyDisabled: boolean;
  readonly fields: SweepFields;
  readonly path: SweepPath;
  readonly snap: boolean;
}

export interface EditorSweepPanelContext {
  readonly state: EditorSweepPanelState;
  readonly setField: (field: SweepField, value: string) => void;
  readonly setPath: (path: SweepPath) => void;
  readonly setSnap: (value: boolean) => void;
  readonly apply: () => void;
  readonly reset: () => void;
}

export function initEditorSweepPanel(actions: {
  readonly inputChanged: () => void;
  readonly apply: () => void;
  readonly reset: () => void;
}) {
  let state: EditorSweepPanelState = {
    visible: false,
    count: "0 brushes",
    applyDisabled: true,
    fields: initialSweepFields,
    path: "straight",
    snap: false,
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorSweepPanelContext>("tea-maps-sweep-state", {
        detail: {
          state,
          setField,
          setPath,
          setSnap,
          apply: actions.apply,
          reset: actions.reset,
        },
      }),
    );
  }

  function update(patch: Partial<EditorSweepPanelState>) {
    state = { ...state, ...patch };
    publish();
  }

  function setField(field: SweepField, value: string) {
    update({ fields: { ...state.fields, [field]: value } });
    actions.inputChanged();
  }

  function setPath(path: SweepPath) {
    update({ path });
    actions.inputChanged();
  }

  function setSnap(snap: boolean) {
    update({ snap });
    actions.inputChanged();
  }

  window.addEventListener("tea-maps-sweep-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-sweep-bridge-ready"));

  return {
    get state() {
      return state;
    },
    update,
  };
}
