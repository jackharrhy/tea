import { clientEntry, on, ref, type Handle } from "remix/component";
import type {
  EditorSurfaceContext,
  SurfaceFlagChoice,
} from "./editor-surface-bridge.ts";

export const EditorSurface = clientEntry(
  `${import.meta.url}#EditorSurface`,
  function EditorSurfaceComponent(handle: Handle) {
    let context: EditorSurfaceContext | null = null;
    const flagInputs = new Map<string, HTMLInputElement>();

    function syncIndeterminate() {
      for (const field of ["contents", "flags"] as const) {
        for (const choice of context?.state[field] ?? []) {
          const input = flagInputs.get(`${field}:${choice.value}`);
          if (input) input.indeterminate = choice.indeterminate;
        }
      }
    }

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-surface-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-surface-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-surface-state",
        (event) => {
          context = (event as CustomEvent<EditorSurfaceContext>).detail;
          handle.update();
          handle.queueTask(syncIndeterminate);
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-surface-ready"));
    });

    function flagGrid(
      field: "contents" | "flags",
      choices: readonly SurfaceFlagChoice[],
      unknown: string | null,
    ) {
      return (
        <fieldset>
          <legend>{field === "contents" ? "Contents" : "Surface flags"}</legend>
          <div id={`surface-${field}`} class="surface-flag-grid">
            {choices.map((choice) => (
              <label>
                <input
                  type="checkbox"
                  checked={choice.checked}
                  aria-checked={choice.indeterminate ? "mixed" : choice.checked}
                  disabled={!context || context.state.disabled}
                  mix={[
                    ref<HTMLInputElement>((node, signal) => {
                      const key = `${field}:${choice.value}`;
                      flagInputs.set(key, node);
                      node.indeterminate = choice.indeterminate;
                      signal.addEventListener("abort", () => {
                        if (flagInputs.get(key) === node)
                          flagInputs.delete(key);
                      });
                    }),
                    on<HTMLInputElement>("change", (event) => {
                      context?.setFlag(
                        field,
                        choice.value,
                        event.currentTarget.checked,
                      );
                    }),
                  ]}
                />
                {choice.label}
              </label>
            ))}
          </div>
          <p id={`surface-unknown-${field}`} hidden={!unknown}>
            {unknown ?? ""}
          </p>
        </fieldset>
      );
    }

    return () => {
      const state = context?.state;
      return (
        <details id="surface-attributes" hidden={!state?.visible}>
          <summary>Quake II surface</summary>
          {flagGrid(
            "contents",
            state?.contents ?? [],
            state?.unknownContents ?? null,
          )}
          {flagGrid("flags", state?.flags ?? [], state?.unknownFlags ?? null)}
          <label for="surface-value" id="surface-value-label">
            {state?.valueLabel ?? "Light value"}
          </label>
          <input
            id="surface-value"
            type="number"
            step="1"
            value={state?.value ?? ""}
            placeholder={state?.valuePlaceholder ?? ""}
            disabled={!state || state.disabled}
            mix={[
              on<HTMLInputElement>("input", (event) => {
                context?.setValue(event.currentTarget.value);
              }),
              on<HTMLInputElement>("change", (event) => {
                context?.commitValue(event.currentTarget.value);
              }),
            ]}
          />
        </details>
      );
    };
  },
);
