import type { BrushClipMode } from "@tea/maps-editor/core";

export interface EditorClipHullState {
  readonly clipVisible: boolean;
  readonly clipPoints: string;
  readonly clipMode: BrushClipMode;
  readonly clipApplyDisabled: boolean;
  readonly clipResetDisabled: boolean;
  readonly hullVisible: boolean;
  readonly hullPoints: string;
  readonly hullCreateDisabled: boolean;
  readonly hullDiscardDisabled: boolean;
}

export interface EditorClipHullContext {
  readonly state: EditorClipHullState;
  readonly setClipMode: (mode: BrushClipMode) => void;
  readonly applyClip: () => void;
  readonly resetClip: () => void;
  readonly createHull: () => void;
  readonly discardHull: () => void;
}

export function initEditorClipHull(
  actions: Omit<EditorClipHullContext, "state">,
) {
  let state: EditorClipHullState = {
    clipVisible: false,
    clipPoints: "Place two or three points",
    clipMode: "back",
    clipApplyDisabled: true,
    clipResetDisabled: true,
    hullVisible: false,
    hullPoints: "0 points",
    hullCreateDisabled: true,
    hullDiscardDisabled: true,
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorClipHullContext>("tea-maps-clip-hull-state", {
        detail: { state, ...actions },
      }),
    );
  }

  function update(patch: Partial<EditorClipHullState>) {
    state = { ...state, ...patch };
    publish();
  }

  window.addEventListener("tea-maps-clip-hull-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-clip-hull-bridge-ready"));

  return { update };
}
