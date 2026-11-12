export type EditorGroupCommand =
  | { readonly type: "create" | "rename"; readonly name: string }
  | {
      readonly type: "open" | "close" | "linked" | "unlink" | "ungroup";
    };

export interface EditorGroupsPanelState {
  readonly editing: boolean;
  readonly canGroupSelection: boolean;
  readonly selectedGroup: {
    readonly id: string;
    readonly name: string;
    readonly linked: boolean;
  } | null;
  readonly openGroupId: string | null;
  readonly run: (command: EditorGroupCommand) => void;
}

export function initEditorGroupsPanel(run: EditorGroupsPanelState["run"]) {
  let state: Omit<EditorGroupsPanelState, "run"> | null = null;
  let ready = false;

  function publish() {
    if (!ready || !state) return;
    window.dispatchEvent(
      new CustomEvent<EditorGroupsPanelState>("tea-maps-groups-state", {
        detail: { ...state, run },
      }),
    );
  }

  window.addEventListener("tea-maps-groups-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-groups-bridge-ready"));

  return {
    publish(next: Omit<EditorGroupsPanelState, "run">) {
      state = next;
      publish();
    },
  };
}
