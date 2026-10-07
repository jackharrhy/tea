import type { EditorLayer, EditorLayerFlag } from "@tea/maps-editor/core";

export type EditorLayerCommand =
  | { readonly type: "choose"; readonly id: string | null }
  | { readonly type: "create" | "rename"; readonly name: string }
  | {
      readonly type:
        | "activate"
        | "move"
        | "select"
        | "isolate"
        | "remove"
        | "up"
        | "down";
    }
  | {
      readonly type: "flag";
      readonly flag: EditorLayerFlag;
      readonly value: boolean;
    }
  | {
      readonly type: "all";
      readonly flag: "hidden" | "locked";
      readonly value: boolean;
    };

export interface EditorLayersPanelState {
  readonly layers: readonly EditorLayer[];
  readonly selectedLayerId: string | null;
  readonly activeLayerId: string | null;
  readonly editing: boolean;
  readonly hasObjectSelection: boolean;
  readonly run: (command: EditorLayerCommand) => void;
}

export function initEditorLayersPanel(run: EditorLayersPanelState["run"]) {
  let state: Omit<EditorLayersPanelState, "run"> | null = null;
  let ready = false;

  function publish() {
    if (!ready || !state) return;
    window.dispatchEvent(
      new CustomEvent<EditorLayersPanelState>("tea-maps-layers-state", {
        detail: { ...state, run },
      }),
    );
  }

  window.addEventListener("tea-maps-layers-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-layers-bridge-ready"));

  return {
    publish(next: Omit<EditorLayersPanelState, "run">) {
      state = next;
      publish();
    },
  };
}
