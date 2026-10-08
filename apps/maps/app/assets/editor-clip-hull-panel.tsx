import { clientEntry, css, on, type Handle } from "remix/component";
import type { BrushClipMode } from "@tea/maps-editor/core";
import type { EditorClipHullContext } from "./editor-clip-hull-bridge.ts";

const clipModes = [
  ["back", "Keep back"],
  ["split", "Split"],
  ["front", "Keep front"],
] as const satisfies readonly (readonly [BrushClipMode, string])[];

export const EditorClipHull = clientEntry(
  `file:///app/assets/editor-clip-hull-panel.tsx#EditorClipHull`,
  function EditorClipHullComponent(handle: Handle) {
    let context: EditorClipHullContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-clip-hull-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-clip-hull-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-clip-hull-state",
        (event) => {
          context = (event as CustomEvent<EditorClipHullContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-clip-hull-ready"));
    });

    return () => {
      const state = context?.state;
      return (
        <div mix={css({ display: "contents" })}>
          <div id="clip-tools" class="clip-tools" hidden={!state?.clipVisible}>
            <span id="clip-points">
              {state?.clipPoints ?? "Place two or three points"}
            </span>
            <div role="group" aria-label="Clip result">
              {clipModes.map(([mode, label]) => (
                <button
                  id={`clip-${mode}`}
                  type="button"
                  aria-pressed={state?.clipMode === mode}
                  mix={on("click", () => context?.setClipMode(mode))}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              id="apply-clip"
              type="button"
              disabled={!state || state.clipApplyDisabled}
              mix={on("click", () => context?.applyClip())}
            >
              Apply clip
            </button>
            <button
              id="reset-clip"
              type="button"
              disabled={!state || state.clipResetDisabled}
              mix={on("click", () => context?.resetClip())}
            >
              Reset points
            </button>
            <p>
              Click two or three snapped points in a viewport, or double-click a
              face to match its plane. Drag an orange point to adjust it.
            </p>
          </div>
          <div id="hull-tools" class="hull-tools" hidden={!state?.hullVisible}>
            <span id="hull-points">{state?.hullPoints ?? "0 points"}</span>
            <button
              id="create-hull"
              type="button"
              disabled={!state || state.hullCreateDisabled}
              mix={on("click", () => context?.createHull())}
            >
              Create hull
            </button>
            <button
              id="discard-hull"
              type="button"
              disabled={!state || state.hullDiscardDisabled}
              mix={on("click", () => context?.discardHull())}
            >
              Discard points
            </button>
            <p>
              In the perspective viewport, click a reference face for one point,
              double-click for its vertices, or drag a rectangle. Enter creates
              the hull; Escape discards its points.
            </p>
          </div>
        </div>
      );
    };
  },
);
