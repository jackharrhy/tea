import { clientEntry, on, type Handle } from "remix/component";
import type { EditorWorkspaceState } from "./editor-workspace.ts";

export const EditorWorkspaceToggle = clientEntry(
  `${import.meta.url}#EditorWorkspaceToggle`,
  function EditorWorkspaceToggleComponent(handle: Handle) {
    let state: EditorWorkspaceState | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-workspace-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-workspace-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-workspace-state",
        (event) => {
          state = (event as CustomEvent<EditorWorkspaceState>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-workspace-ready"));
    });

    return () => (
      <button
        id="perspective-only"
        type="button"
        aria-pressed={state?.perspectiveOnly ?? false}
        aria-label={
          state?.perspectiveOnly
            ? "Restore four viewports"
            : "Show Perspective only"
        }
        disabled={!state?.ready}
        mix={on("click", () => state?.toggle())}
      >
        {state?.perspectiveOnly ? "Restore" : "Expand"}
      </button>
    );
  },
);
