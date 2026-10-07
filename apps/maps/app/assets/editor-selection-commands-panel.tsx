import { clientEntry, css, on, type Handle } from "remix/component";
import type { EditorSelectionCommandsContext } from "./editor-selection-commands-bridge.ts";
import { EditorSelectionBrushes } from "./editor-selection-brushes-panel.tsx";

export const EditorSelectionCommands = clientEntry(
  `${import.meta.url}#EditorSelectionCommands`,
  function EditorSelectionCommandsComponent(handle: Handle) {
    let context: EditorSelectionCommandsContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-selection-commands-bridge-ready",
        () =>
          window.dispatchEvent(new Event("tea-maps-selection-commands-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-selection-commands-state",
        (event) => {
          context = (event as CustomEvent<EditorSelectionCommandsContext>)
            .detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-selection-commands-ready"));
    });

    return () => {
      const state = context?.state;
      const actions = context?.actions;
      return (
        <div mix={css({ display: "contents" })}>
          <button
            id="delete-selection"
            type="button"
            disabled={!state || state.deleteDisabled}
            mix={on("click", () => actions?.delete())}
          >
            Delete selection
          </button>
          <button
            id="duplicate-selection"
            type="button"
            disabled={!state || state.duplicateDisabled}
            mix={on("click", () => actions?.duplicate())}
          >
            Duplicate
          </button>
          <button
            id="select-all"
            type="button"
            disabled={!state}
            mix={on("click", () => actions?.selectAll())}
          >
            Select all
          </button>
          <button
            id="invert-selection"
            type="button"
            disabled={!state}
            mix={on("click", () => actions?.invert())}
          >
            Invert selection
          </button>
          <EditorSelectionBrushes />
          <button
            id="focus-selection"
            type="button"
            disabled={!state || state.focusDisabled}
            mix={on("click", () => actions?.focus())}
          >
            Focus selection
          </button>
          <button
            id="hide-selection"
            type="button"
            disabled={!state || state.hideDisabled}
            mix={on("click", () => actions?.hide())}
          >
            Hide selection
          </button>
          <button
            id="isolate-selection"
            type="button"
            disabled={!state || state.hideDisabled}
            mix={on("click", () => actions?.isolate())}
          >
            Isolate selection
          </button>
          <button
            id="show-all"
            type="button"
            disabled={!state || state.showAllDisabled}
            mix={on("click", () => actions?.showAll())}
          >
            Show all
          </button>
          <button
            id="lock-selection"
            type="button"
            disabled={!state || state.hideDisabled}
            mix={on("click", () => actions?.lock())}
          >
            Lock selection
          </button>
          <button
            id="unlock-all"
            type="button"
            disabled={!state || state.unlockAllDisabled}
            mix={on("click", () => actions?.unlockAll())}
          >
            Unlock all
          </button>
        </div>
      );
    };
  },
);
