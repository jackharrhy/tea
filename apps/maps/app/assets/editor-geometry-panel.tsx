import { clientEntry, css, on, type Handle } from "remix/component";
import type { EditorGeometryContext } from "./editor-geometry-bridge.ts";

export const EditorGeometry = clientEntry(
  `file:///app/assets/editor-geometry-panel.tsx#EditorGeometry`,
  function EditorGeometryComponent(handle: Handle) {
    let context: EditorGeometryContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-geometry-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-geometry-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-geometry-state",
        (event) => {
          context = (event as CustomEvent<EditorGeometryContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-geometry-ready"));
    });

    return () => {
      const state = context?.state;
      return (
        <div mix={css({ display: "contents" })}>
          <button
            id="add-box"
            type="button"
            disabled={!state || state.addBoxDisabled}
            mix={on("click", () => context?.addBox())}
          >
            Add box
          </button>
          <label for="box-material">Brush texture</label>
          <input
            id="box-material"
            type="text"
            list="material-choices"
            value={state?.material ?? "DEV/GRID"}
            mix={on<HTMLInputElement>("input", (event) => {
              context?.setMaterial(event.currentTarget.value);
            })}
          />
          <datalist id="material-choices">
            {state?.materialChoices.map((name) => (
              <option value={name} />
            ))}
          </datalist>
        </div>
      );
    };
  },
);

export const EditorCsg = clientEntry(
  `file:///app/assets/editor-geometry-panel.tsx#EditorCsg`,
  function EditorCsgComponent(handle: Handle) {
    let context: EditorGeometryContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-geometry-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-geometry-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-geometry-state",
        (event) => {
          context = (event as CustomEvent<EditorGeometryContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-geometry-ready"));
    });

    return () => {
      const state = context?.state;
      return (
        <details id="csg-tools">
          <summary>Constructive geometry</summary>
          <div
            class="csg-actions"
            role="group"
            aria-label="Constructive geometry commands"
          >
            <button
              id="csg-merge"
              type="button"
              disabled={!state || state.mergeDisabled}
              mix={on("click", () => context?.runCsg("merge"))}
            >
              Convex merge
            </button>
            <button
              id="csg-intersect"
              type="button"
              disabled={!state || state.intersectDisabled}
              mix={on("click", () => context?.runCsg("intersect"))}
            >
              Intersect
            </button>
            <button
              id="csg-subtract"
              type="button"
              disabled={!state || state.subtractDisabled}
              mix={on("click", () => context?.runCsg("subtract"))}
            >
              Subtract
            </button>
            <label for="csg-thickness">Hollow wall thickness</label>
            <input
              id="csg-thickness"
              type="number"
              min="1"
              step="1"
              value={state?.thickness ?? "16"}
              disabled={!state || state.thicknessDisabled}
              mix={on<HTMLInputElement>("input", (event) => {
                context?.setThickness(event.currentTarget.value);
              })}
            />
            <button
              id="csg-hollow"
              type="button"
              disabled={!state || state.hollowDisabled}
              mix={on("click", () => context?.runCsg("hollow"))}
            >
              Hollow
            </button>
          </div>
          <p>
            Merge and Intersect need at least two brushes. Subtract uses
            selected brushes as cutters and removes them.
          </p>
        </details>
      );
    };
  },
);
