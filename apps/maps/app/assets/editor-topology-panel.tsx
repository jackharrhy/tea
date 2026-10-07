import { clientEntry, on, type Handle } from "remix/component";
import type { EditorTopologyPanelContext } from "./editor-topology-bridge.ts";

export const EditorTopologyPanel = clientEntry(
  `${import.meta.url}#EditorTopologyPanel`,
  function EditorTopologyPanelComponent(handle: Handle) {
    let context: EditorTopologyPanelContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-topology-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-topology-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-topology-state",
        (event) => {
          context = (event as CustomEvent<EditorTopologyPanelContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-topology-ready"));
    });

    return () => {
      const state = context?.state;
      return (
        <div
          id="topology-tools"
          class="topology-tools"
          hidden={!state?.visible}
        >
          <strong id="topology-title">{state?.title ?? "Vertex edit"}</strong>
          <span>
            <b id="topology-count">{state?.count ?? 0}</b> handles selected
          </span>
          <button
            id="delete-topology"
            type="button"
            disabled={!state || state.deleteDisabled}
            mix={on("click", () => context?.deleteHandles())}
          >
            Delete handles
          </button>
          <p>
            Click or lasso handles on selected brushes. Ctrl/Command adds
            handles or changes snap mode; Shift+Alt-click a vertex to snap to
            it. Arrow keys nudge by one grid step. Shift-drag a green surface
            handle to add a vertex. Escape clears handles before leaving the
            tool.
          </p>
        </div>
      );
    };
  },
);
