export interface EditorTopologyPanelState {
  readonly visible: boolean;
  readonly title: string;
  readonly count: number;
  readonly deleteDisabled: boolean;
}

export interface EditorTopologyPanelContext {
  readonly state: EditorTopologyPanelState;
  readonly deleteHandles: () => void;
}

export function initEditorTopologyPanel(deleteHandles: () => void) {
  let state: EditorTopologyPanelState = {
    visible: false,
    title: "Vertex edit",
    count: 0,
    deleteDisabled: true,
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorTopologyPanelContext>("tea-maps-topology-state", {
        detail: { state, deleteHandles },
      }),
    );
  }

  function update(patch: Partial<EditorTopologyPanelState>) {
    state = { ...state, ...patch };
    publish();
  }

  window.addEventListener("tea-maps-topology-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-topology-bridge-ready"));

  return { update };
}
