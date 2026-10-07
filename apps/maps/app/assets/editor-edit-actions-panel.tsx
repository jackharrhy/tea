import { clientEntry, css, on, type Handle } from "remix/component";
import type { EditorEditActionsContext } from "./editor-edit-actions-bridge.ts";

export const EditorEditActions = clientEntry(
  `${import.meta.url}#EditorEditActions`,
  function EditorEditActionsComponent(handle: Handle) {
    let context: EditorEditActionsContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-edit-actions-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-edit-actions-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-edit-actions-state",
        (event) => {
          context = (event as CustomEvent<EditorEditActionsContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-edit-actions-ready"));
    });

    return () => {
      const state = context?.state;
      const commands = context?.commands;
      return (
        <div mix={css({ display: "contents" })}>
          <button
            id="snap-to-grid"
            type="button"
            disabled={!state || state.snapDisabled}
            mix={on("click", () => commands?.snap())}
          >
            Snap selection
          </button>
          <button
            id="repeat-commands"
            type="button"
            disabled={!state || state.repeatDisabled}
            title={state?.repeatTitle ?? ""}
            mix={on("click", () => commands?.repeat())}
          >
            {state?.repeatLabel ?? "Repeat"}
          </button>
          <button
            id="clear-repeat-commands"
            type="button"
            disabled={!state || state.clearRepeatDisabled}
            title={state?.clearRepeatTitle ?? ""}
            mix={on("click", () => commands?.clearRepeat())}
          >
            Clear repeat
          </button>
          <button
            id="copy-selection"
            type="button"
            disabled={!state || state.copyDisabled}
            mix={on("click", () => commands?.copy())}
          >
            Copy
          </button>
          <button
            id="paste-cursor"
            type="button"
            disabled={!state || state.pastePointerDisabled}
            mix={on("click", () => commands?.pastePointer())}
          >
            Paste at pointer
          </button>
          <button
            id="paste-original"
            type="button"
            disabled={!state || state.pasteOriginalDisabled}
            mix={on("click", () => commands?.pasteOriginal())}
          >
            Paste in place
          </button>
        </div>
      );
    };
  },
);
