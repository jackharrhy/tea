import { clientEntry, css, on, type Handle } from "remix/component";
import type { EditorUvControlsContext } from "./editor-uv-controls-bridge.ts";

export const EditorUvControls = clientEntry(
  `${import.meta.url}#EditorUvControls`,
  function EditorUvControlsComponent(handle: Handle) {
    let context: EditorUvControlsContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-uv-controls-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-uv-controls-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-uv-controls-state",
        (event) => {
          context = (event as CustomEvent<EditorUvControlsContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-uv-controls-ready"));
    });

    return () => (
      <div mix={css({ display: "contents" })}>
        <p id="uv-editor-status" role="status">
          {context?.state.status ?? "Select a brush face"}
        </p>
        <div class="uv-editor-controls">
          <button
            id="uv-frame"
            type="button"
            disabled={!context || context.state.disabled}
            mix={on("click", () => context?.frame())}
          >
            Frame face
          </button>
          <button
            id="uv-reset-pivot"
            type="button"
            disabled={!context || context.state.disabled}
            mix={on("click", () => context?.resetPivot())}
          >
            Reset UV origin
          </button>
          <label for="uv-grid-x">Grid X</label>
          <input
            id="uv-grid-x"
            type="number"
            min="1"
            max="16"
            step="1"
            value={context?.state.gridX ?? "1"}
            disabled={!context}
            mix={[
              on<HTMLInputElement>("input", (event) => {
                context?.setGridDraft(0, event.currentTarget.value);
              }),
              on<HTMLInputElement>("change", (event) => {
                context?.commitGrid(0, event.currentTarget.valueAsNumber);
              }),
            ]}
          />
          <label for="uv-grid-y">Grid Y</label>
          <input
            id="uv-grid-y"
            type="number"
            min="1"
            max="16"
            step="1"
            value={context?.state.gridY ?? "1"}
            disabled={!context}
            mix={[
              on<HTMLInputElement>("input", (event) => {
                context?.setGridDraft(1, event.currentTarget.value);
              }),
              on<HTMLInputElement>("change", (event) => {
                context?.commitGrid(1, event.currentTarget.valueAsNumber);
              }),
            ]}
          />
        </div>
        <p>
          Drag to offset. Drag the ring to rotate or the handles to scale.
          Middle or right drag pans; wheel zooms. Ctrl/Command bypasses
          snapping.
        </p>
      </div>
    );
  },
);
