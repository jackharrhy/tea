import { clientEntry, css, on, type Handle } from "remix/component";
import type { TransformAxis } from "@tea/maps-editor/core";
import type { EditorTransformsContext } from "./editor-transforms-bridge.ts";

const axes = ["X", "Y", "Z"] as const;

export const EditorTransforms = clientEntry(
  `${import.meta.url}#EditorTransforms`,
  function EditorTransformsComponent(handle: Handle) {
    let context: EditorTransformsContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-transforms-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-transforms-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-transforms-state",
        (event) => {
          context = (event as CustomEvent<EditorTransformsContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-transforms-ready"));
    });

    return () => {
      const state = context?.state;
      return (
        <div mix={css({ display: "contents" })}>
          <div class="transform-tools" role="group" aria-label="Move selection">
            <span>Move</span>
            {axes.map((axis, index) => (
              <span mix={css({ display: "contents" })}>
                <label for={`move-${axis.toLowerCase()}`}>{axis}</label>
                <input
                  id={`move-${axis.toLowerCase()}`}
                  type="number"
                  value={state?.move[index] ?? ["16", "0", "0"][index]}
                  mix={on<HTMLInputElement>("input", (event) => {
                    context?.setMove(
                      index as TransformAxis,
                      event.currentTarget.value,
                    );
                  })}
                />
              </span>
            ))}
            <button
              id="move-selection"
              type="button"
              disabled={!state || state.moveDisabled}
              mix={on("click", () => context?.move())}
            >
              Apply
            </button>
          </div>
          <div class="transform-tools" role="group" aria-label="Grid nudge">
            <span>Grid nudge</span>
            {axes.map((axis, index) => (
              <span>
                {axis}
                {([-1, 1] as const).map((direction) => (
                  <button
                    class="transform-nudge"
                    type="button"
                    disabled={!state || state.nudgeDisabled}
                    aria-label={`Nudge ${axis} ${direction < 0 ? "negative" : "positive"}`}
                    mix={on("click", () =>
                      context?.nudge(index as TransformAxis, direction),
                    )}
                  >
                    {direction < 0 ? "−" : "+"}
                  </button>
                ))}
              </span>
            ))}
          </div>
          <div
            class="transform-tools"
            role="group"
            aria-label="Rotate selection"
          >
            <span>Rotate</span>
            <label for="rotate-axis">Axis</label>
            <select
              id="rotate-axis"
              value={String(state?.rotateAxis ?? 2)}
              mix={on<HTMLSelectElement>("change", (event) => {
                context?.setRotateAxis(
                  Number(event.currentTarget.value) as TransformAxis,
                );
              })}
            >
              {axes.map((axis, index) => (
                <option value={String(index)}>{axis}</option>
              ))}
            </select>
            <label for="rotate-degrees">Degrees</label>
            <input
              id="rotate-degrees"
              type="number"
              value={state?.rotateDegrees ?? "90"}
              step="1"
              mix={on<HTMLInputElement>("input", (event) => {
                context?.setRotateDegrees(
                  event.currentTarget.value,
                  event.currentTarget.checkValidity(),
                );
              })}
            />
            <button
              id="rotate-selection"
              type="button"
              disabled={!state || state.rotateDisabled}
              mix={on("click", () => context?.rotate())}
            >
              Apply
            </button>
          </div>
          <div
            class="transform-tools"
            role="group"
            aria-label="Scale selection"
          >
            <span>Scale</span>
            {axes.map((axis, index) => (
              <span mix={css({ display: "contents" })}>
                <label for={`scale-${axis.toLowerCase()}`}>{axis}</label>
                <input
                  id={`scale-${axis.toLowerCase()}`}
                  type="number"
                  min="0.05"
                  step="0.05"
                  value={state?.scale[index] ?? "1.25"}
                  mix={on<HTMLInputElement>("input", (event) => {
                    context?.setScale(
                      index as TransformAxis,
                      event.currentTarget.value,
                      event.currentTarget.checkValidity(),
                    );
                  })}
                />
              </span>
            ))}
            <button
              id="scale-selection"
              type="button"
              disabled={!state || state.scaleDisabled}
              mix={on("click", () => context?.scale())}
            >
              Apply
            </button>
          </div>
          <details id="advanced-transforms">
            <summary>Shear and mirror</summary>
            <div class="advanced-transform-controls">
              <label for="shear-source-axis">Plane axis</label>
              <select
                id="shear-source-axis"
                value={String(state?.shearSourceAxis ?? 2)}
                mix={on<HTMLSelectElement>("change", (event) => {
                  context?.setShearSourceAxis(
                    Number(event.currentTarget.value) as TransformAxis,
                  );
                })}
              >
                {axes.map((axis, index) => (
                  <option value={String(index)}>{axis}</option>
                ))}
              </select>
              <label for="shear-target-axis">Move axis</label>
              <select
                id="shear-target-axis"
                value={String(state?.shearTargetAxis ?? 0)}
                mix={on<HTMLSelectElement>("change", (event) => {
                  context?.setShearTargetAxis(
                    Number(event.currentTarget.value) as TransformAxis,
                  );
                })}
              >
                {axes.map((axis, index) => (
                  <option value={String(index)}>{axis}</option>
                ))}
              </select>
              <label for="shear-offset">Offset</label>
              <input
                id="shear-offset"
                type="number"
                step="1"
                value={state?.shearOffset ?? "16"}
                mix={on<HTMLInputElement>("input", (event) => {
                  context?.setShearOffset(
                    event.currentTarget.value,
                    event.currentTarget.checkValidity(),
                  );
                })}
              />
              <button
                id="shear-selection"
                type="button"
                disabled={!state || state.shearDisabled}
                mix={on("click", () => context?.shear())}
              >
                Shear
              </button>
              <span>Mirror around snapped center</span>
              {axes.map((axis, index) => (
                <button
                  id={`flip-${axis.toLowerCase()}`}
                  type="button"
                  disabled={!state || state.flipDisabled}
                  mix={on("click", () => context?.flip(index as TransformAxis))}
                >
                  Flip {axis}
                </button>
              ))}
            </div>
          </details>
        </div>
      );
    };
  },
);
