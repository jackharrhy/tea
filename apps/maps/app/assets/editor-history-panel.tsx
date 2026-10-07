import { clientEntry, css, on, type Handle } from "remix/component";
import type { EditorHistoryContext } from "./editor-history-bridge.ts";

export const EditorHistory = clientEntry(
  `${import.meta.url}#EditorHistory`,
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
            disabled={!state || state.undoDisabled}
            title={state?.undoTitle ?? "Undo"}
            mix={on("click", () => context?.undo())}
          >
            Undo
          </button>
          <button
            id="redo"
            type="button"
            disabled={!state || state.redoDisabled}
            title={state?.redoTitle ?? "Redo"}
            mix={on("click", () => context?.redo())}
          >
            Redo
          </button>
        </div>
      );
    };
  },
);
