import { clientEntry, css, on, type Handle } from "remix/component";
import type { SweepPath } from "@tea/maps-editor/core";
import { initialSweepFields } from "./editor-sweep-bridge.ts";
import type {
  EditorSweepPanelContext,
  SweepField,
} from "./editor-sweep-bridge.ts";

export const EditorSweepPanel = clientEntry(
  `${import.meta.url}#EditorSweepPanel`,
  function EditorSweepPanelComponent(handle: Handle) {
    let context: EditorSweepPanelContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-sweep-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-sweep-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-sweep-state",
        (event) => {
          context = (event as CustomEvent<EditorSweepPanelContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-sweep-ready"));
    });

    function numberField(
      field: SweepField,
      id: string,
      label: string,
      step: string,
      min?: string,
      max?: string,
    ) {
      return (
        <span mix={css({ display: "contents" })}>
          <label for={id}>{label}</label>
          <input
            id={id}
            type="number"
            step={step}
            min={min}
            max={max}
            value={context?.state.fields[field] ?? initialSweepFields[field]}
            disabled={!context}
            mix={[
              on<HTMLInputElement>("input", (event) => {
                context?.setField(field, event.currentTarget.value);
              }),
              on<HTMLInputElement>("keydown", (event) => {
                if ("key" in event && event.key === "Enter") {
                  event.preventDefault();
                  context?.apply();
                }
              }),
            ]}
          />
        </span>
      );
    }

    return () => {
      const state = context?.state;
      return (
        <div id="sweep-tools" class="sweep-tools" hidden={!state?.visible}>
          <strong>Sweep selected faces</strong>
          <span id="sweep-count">{state?.count ?? "0 brushes"}</span>
          <div class="sweep-fields">
            <span>Destination</span>
            {numberField("translateX", "sweep-translate-x", "X", "1")}
            {numberField("translateY", "sweep-translate-y", "Y", "1")}
            {numberField("translateZ", "sweep-translate-z", "Z", "1")}
            <span>Rotation</span>
            {numberField("rotateX", "sweep-rotate-x", "X", "5")}
            {numberField("rotateY", "sweep-rotate-y", "Y", "5")}
            {numberField("rotateZ", "sweep-rotate-z", "Z", "5")}
            {numberField("scale", "sweep-scale", "Scale", "0.05", "0.05", "20")}
            <label for="sweep-path">Path</label>
            <select
              id="sweep-path"
              value={state?.path ?? "straight"}
              disabled={!context}
              mix={[
                on<HTMLSelectElement>("change", (event) => {
                  context?.setPath(event.currentTarget.value as SweepPath);
                }),
                on<HTMLSelectElement>("keydown", (event) => {
                  if ("key" in event && event.key === "Enter") {
                    event.preventDefault();
                    context?.apply();
                  }
                }),
              ]}
            >
              <option value="straight">Straight</option>
              <option value="arc">Arc</option>
              <option value="s-bend">S-bend</option>
            </select>
            {numberField(
              "segments",
              "sweep-segments",
              "Segments",
              "1",
              "1",
              "128",
            )}
            {numberField(
              "iterations",
              "sweep-iterations",
              "Iterations",
              "1",
              "1",
              "64",
            )}
            <label for="sweep-snap">
              <input
                id="sweep-snap"
                type="checkbox"
                checked={state?.snap ?? false}
                disabled={!context}
                mix={on<HTMLInputElement>("change", (event) => {
                  context?.setSnap(event.currentTarget.checked);
                })}
              />{" "}
              Snap vertices
            </label>
            <button
              id="reset-sweep"
              type="button"
              disabled={!context}
              mix={on("click", () => context?.reset())}
            >
              Reset
            </button>
            <button
              id="apply-sweep"
              type="button"
              disabled={!state || state.applyDisabled}
              mix={on("click", () => context?.apply())}
            >
              Apply sweep
            </button>
          </div>
          <p>
            Drag the destination cap in the perspective viewport to move,
            rotate, or scale it. Enter applies; Escape resets, then leaves the
            tool.
          </p>
        </div>
      );
    };
  },
);
