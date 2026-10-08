import { clientEntry, css, on, type Handle } from "remix/component";
import type { EditorTransformToolContext } from "./editor-transform-tool-bridge.ts";

const axes = ["x", "y", "z"] as const;

export const EditorTransformToolPanel = clientEntry(
  `file:///app/assets/editor-transform-tool-panel.tsx#EditorTransformToolPanel`,
  function EditorTransformToolPanelComponent(handle: Handle) {
    let context: EditorTransformToolContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-transform-tool-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-transform-tool-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-transform-tool-state",
        (event) => {
          context = (event as CustomEvent<EditorTransformToolContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-transform-tool-ready"));
    });

    return () => {
      const state = context?.state;
      return (
        <div
          id="transform-tool"
          class="transform-tool"
          hidden={!state?.visible}
        >
          <strong id="transform-title">{state?.title ?? "Rotate"}</strong>
          <span>Pivot</span>
          {axes.map((axis, index) => (
            <span mix={css({ display: "contents" })}>
              <label for={`transform-pivot-${axis}`}>
                {axis.toUpperCase()}
              </label>
              <input
                id={`transform-pivot-${axis}`}
                type="number"
                step="1"
                value={state?.pivot[index] ?? "0"}
                disabled={!context}
                mix={[
                  on<HTMLInputElement>("input", (event) => {
                    context?.setPivotDraft(
                      index as 0 | 1 | 2,
                      event.currentTarget.value,
                    );
                  }),
                  on<HTMLInputElement>("change", () => {
                    context?.commitPivot();
                  }),
                ]}
              />
            </span>
          ))}
          <button
            id="reset-transform-pivot"
            type="button"
            disabled={!context}
            mix={on("click", () => context?.resetPivot())}
          >
            Reset pivot
          </button>
          <label for="transform-update-angles">
            <input
              id="transform-update-angles"
              type="checkbox"
              checked={state?.updateAngles ?? true}
              disabled={!state || state.updateAnglesDisabled}
              mix={on<HTMLInputElement>("change", (event) => {
                context?.setUpdateAngles(event.currentTarget.checked);
              })}
            />{" "}
            Update entity angles
          </label>
          <button
            id="apply-transform-tool"
            type="button"
            disabled={!state || state.applyDisabled}
            mix={on("click", () => context?.apply())}
          >
            Apply numeric transform
          </button>
          <p>
            Drag the viewport handles to transform the selection. Set exact
            rotation, scale, or shear values in the toolbar above; the pivot
            also applies to those commands while this tool is active.
          </p>
        </div>
      );
    };
  },
);
