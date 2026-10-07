import { clientEntry, on, type Handle } from "remix/component";
import type { EditorWorkspaceState } from "./editor-workspace.ts";

function subscribeWorkspace(
  handle: Handle,
  update: (state: EditorWorkspaceState) => void,
) {
  handle.queueTask(() => {
    window.addEventListener(
      "tea-maps-workspace-bridge-ready",
      () => window.dispatchEvent(new Event("tea-maps-workspace-ready")),
      { signal: handle.signal },
    );
    window.addEventListener(
      "tea-maps-workspace-state",
      (event) => update((event as CustomEvent<EditorWorkspaceState>).detail),
      { signal: handle.signal },
    );
    window.dispatchEvent(new Event("tea-maps-workspace-ready"));
  });
}

export const EditorWorkspaceToggle = clientEntry(
  `${import.meta.url}#EditorWorkspaceToggle`,
  function EditorWorkspaceToggleComponent(handle: Handle) {
    let state: EditorWorkspaceState | null = null;

    subscribeWorkspace(handle, (next) => {
      state = next;
      handle.update();
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

export const EditorInspectorToggle = clientEntry(
  `${import.meta.url}#EditorInspectorToggle`,
  function EditorInspectorToggleComponent(handle: Handle) {
    let state: EditorWorkspaceState | null = null;
    subscribeWorkspace(handle, (next) => {
      state = next;
      handle.update();
    });

    return () => (
      <button
        id="toggle-inspector"
        type="button"
        aria-controls="editor-inspector"
        aria-expanded={state?.inspectorOpen ?? true}
        aria-label={
          state?.inspectorOpen === false ? "Show inspector" : "Hide inspector"
        }
        mix={on("click", () => state?.toggleInspector())}
      >
        Inspector
      </button>
    );
  },
);
