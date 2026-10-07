import { clientEntry, css, on, type Handle } from "remix/component";
import type { EditorEntityCreationContext } from "./editor-entity-creation-bridge.ts";

export const EditorEntityCreation = clientEntry(
  `${import.meta.url}#EditorEntityCreation`,
  function EditorEntityCreationComponent(handle: Handle) {
    let context: EditorEntityCreationContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-entity-creation-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-entity-creation-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-entity-creation-state",
        (event) => {
          context = (event as CustomEvent<EditorEntityCreationContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-entity-creation-ready"));
    });

    return () => {
      const state = context?.state;
      return (
        <div mix={css({ display: "contents" })}>
          <div class="transform-tools" role="group" aria-label="Brush entity">
            <label for="brush-entity-classname">Brush entity</label>
            <input
              id="brush-entity-classname"
              type="text"
              list="brush-entity-classes"
              value={state?.brushClassname ?? "func_detail"}
              autoComplete="off"
              spellCheck={false}
              mix={on<HTMLInputElement>("input", (event) => {
                context?.setBrushClassname(event.currentTarget.value);
              })}
            />
            <datalist id="brush-entity-classes">
              {state?.brushClasses.map(({ classname, label }) => (
                <option value={classname} label={label} />
              ))}
            </datalist>
            <button
              id="make-brush-entity"
              type="button"
              disabled={!state || state.makeBrushDisabled}
              mix={on("click", () => context?.makeBrushEntity())}
            >
              Make entity
            </button>
            <button
              id="make-structural"
              type="button"
              disabled={!state || state.makeStructuralDisabled}
              mix={on("click", () => context?.makeStructural())}
            >
              Make structural
            </button>
          </div>
          <div class="transform-tools" role="group" aria-label="Point entity">
            <label for="point-entity-classname">Point entity</label>
            <input
              id="point-entity-classname"
              type="text"
              list="point-entity-classes"
              value={state?.pointClassname ?? "info_player_start"}
              autoComplete="off"
              spellCheck={false}
              mix={on<HTMLInputElement>("input", (event) => {
                context?.setPointClassname(event.currentTarget.value);
              })}
            />
            <datalist id="point-entity-classes">
              {state?.pointClasses.map(({ classname, label }) => (
                <option value={classname} label={label} />
              ))}
            </datalist>
            {(["X", "Y", "Z"] as const).map((axis, index) => (
              <span mix={css({ display: "contents" })}>
                <label for={`point-origin-${axis.toLowerCase()}`}>{axis}</label>
                <input
                  id={`point-origin-${axis.toLowerCase()}`}
                  type="number"
                  value={state?.pointOrigin[index] ?? ["0", "0", "64"][index]}
                  mix={on<HTMLInputElement>("input", (event) => {
                    context?.setPointOrigin(
                      index as 0 | 1 | 2,
                      event.currentTarget.value,
                    );
                  })}
                />
              </span>
            ))}
            <button
              id="add-point-entity"
              type="button"
              disabled={!state || state.addPointDisabled}
              mix={on("click", () => context?.addPoint())}
            >
              Add point
            </button>
          </div>
        </div>
      );
    };
  },
);
