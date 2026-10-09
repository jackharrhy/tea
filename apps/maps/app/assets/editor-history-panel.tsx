import { clientEntry, css, on, type Handle } from "remix/component";
import type { EditorHistoryContext } from "./editor-history-bridge.ts";

export const EditorHistory = clientEntry(
  `file:///app/assets/editor-history-panel.tsx#EditorHistory`,
  function EditorHistoryComponent(handle: Handle) {
    let context: EditorHistoryContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-history-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-history-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-history-state",
        (event) => {
          context = (event as CustomEvent<EditorHistoryContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-history-ready"));
    });

    return () => {
      const state = context?.state;
      return (
        <div mix={css({ display: "contents" })}>
          <button
            id="undo"
            type="button"
            aria-label="Undo"
            disabled={!state || state.undoDisabled}
            title={state?.undoTitle ?? "Undo"}
            mix={on("click", () => context?.undo())}
          >
            <i class="ph ph-arrow-counter-clockwise" aria-hidden="true" />
          </button>
          <button
            id="redo"
            type="button"
            aria-label="Redo"
            disabled={!state || state.redoDisabled}
            title={state?.redoTitle ?? "Redo"}
            mix={on("click", () => context?.redo())}
          >
            <i class="ph ph-arrow-clockwise" aria-hidden="true" />
          </button>
          <button
            id="show-source"
            type="button"
            aria-label="Edit map source"
            title="Edit map source"
            disabled={!state}
            mix={on("click", () => {
              window.dispatchEvent(new Event("tea-maps-inspector-show-source"));
            })}
          >
            <i class="ph ph-code" aria-hidden="true" />
          </button>
        </div>
      );
    };
  },
);
