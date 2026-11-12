import { clientEntry, css, on, type Handle } from "remix/component";
import type { EditorSourceContext } from "./editor-source-bridge.ts";

export const EditorSourcePanel = clientEntry(
  `file:///app/assets/editor-source-panel.tsx#EditorSourcePanel`,
  function EditorSourcePanelComponent(handle: Handle) {
    let context: EditorSourceContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-source-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-source-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-source-state",
        (event) => {
          context = (event as CustomEvent<EditorSourceContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-source-ready"));
    });

    return () => (
      <div mix={css({ display: "contents" })}>
        <label for="map-source">Valve map source</label>
        <p
          id="source-save-warning"
          role="status"
          hidden={!context?.state.warning}
        >
          {context?.state.warning ?? ""}
        </p>
        <textarea
          id="map-source"
          spellCheck={false}
          aria-label="Valve map source"
          disabled={!context || context.state.disabled}
          value={context?.state.value ?? ""}
          mix={on<HTMLTextAreaElement>("input", (event) => {
            context?.input(event.currentTarget.value);
          })}
        />
        <button
          id="apply-source"
          type="button"
          disabled={!context || context.state.disabled}
          mix={on("click", () => context?.apply())}
        >
          Apply source
        </button>
      </div>
    );
  },
);
