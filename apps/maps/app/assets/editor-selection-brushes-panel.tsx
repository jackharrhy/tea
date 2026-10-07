import { clientEntry, on, type Handle } from "remix/component";
import type {
  EditorSelectionBrushesContext,
  SelectionBrushProjection,
} from "./editor-selection-brushes-bridge.ts";

export const EditorSelectionBrushes = clientEntry(
  `${import.meta.url}#EditorSelectionBrushes`,
  function EditorSelectionBrushesComponent(handle: Handle) {
    let context: EditorSelectionBrushesContext | null = null;
    let projection: SelectionBrushProjection = "xy";

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-selection-brushes-bridge-ready",
        () =>
          window.dispatchEvent(new Event("tea-maps-selection-brushes-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-selection-brushes-state",
        (event) => {
          context = (event as CustomEvent<EditorSelectionBrushesContext>)
            .detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-selection-brushes-ready"));
    });

    return () => (
      <details id="selection-brush-tools">
        <summary>Selection brushes</summary>
        <div
          class="selection-brush-actions"
          role="group"
          aria-label="Selection brush commands"
        >
          <button
            id="selection-brush-touching"
            type="button"
            disabled={!context?.enabled}
            mix={on("click", () => context?.run("touching"))}
          >
            Select touching
          </button>
          <button
            id="selection-brush-inside"
            type="button"
            disabled={!context?.enabled}
            mix={on("click", () => context?.run("inside"))}
          >
            Select enclosed
          </button>
          <label for="selection-brush-projection">2D plane</label>
          <select
            id="selection-brush-projection"
            disabled={!context?.enabled}
            value={projection}
            mix={on<HTMLSelectElement>("change", (event) => {
              projection = event.currentTarget
                .value as SelectionBrushProjection;
            })}
          >
            <option value="xy">XY</option>
            <option value="xz">XZ</option>
            <option value="yz">YZ</option>
          </select>
          <button
            id="selection-brush-projected"
            type="button"
            disabled={!context?.enabled}
            mix={on("click", () =>
              context?.run("inside-projected", projection),
            )}
          >
            Select enclosed in 2D
          </button>
        </div>
        <p>
          Selected structural brushes define the volume and are removed. Undo
          restores them.
        </p>
      </details>
    );
  },
);
