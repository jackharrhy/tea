import { clientEntry, on, ref, type Handle } from "remix/component";
import type { EditorFovContext } from "./editor-fov.ts";

export const EditorFov = clientEntry(
  `${import.meta.url}#EditorFov`,
  function EditorFovComponent(handle: Handle) {
    let context: EditorFovContext | null = null;
    let details: HTMLDetailsElement | null = null;
    let input: HTMLInputElement | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-fov-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-fov-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-fov-state",
        (event) => {
          context = (event as CustomEvent<EditorFovContext>).detail;
          if (input) input.value = String(context.currentFov);
          if (context.compiled && details) details.open = false;
          handle.update();
        },
        { signal: handle.signal },
      );
      document.addEventListener(
        "pointerdown",
        (event) => {
          if (details && !details.contains(event.target as Node))
            details.open = false;
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-fov-ready"));
    });

    return () => {
      const current = context?.currentFov ?? 60;
      const saved = context?.defaultFov ?? 60;
      const modified = Math.abs(current - saved) > 0.01;
      return (
        <details
          id="editor-fov"
          inert={context?.compiled ?? false}
          mix={ref((node: HTMLDetailsElement) => {
            details = node;
            if (context?.compiled) node.open = false;
          })}
        >
          <summary id="editor-fov-trigger">
            FOV {Math.round(current)}°{modified ? " *" : ""}
          </summary>
          <div class="editor-fov-controls">
            <label for="editor-fov-value">Vertical FOV (degrees)</label>
            <input
              id="editor-fov-value"
              type="number"
              min="20"
              max="120"
              step="1"
              defaultValue="60"
              mix={[
                ref((node: HTMLInputElement) => {
                  input = node;
                  if (context) node.value = String(context.currentFov);
                }),
                on<HTMLInputElement>("change", (event) => {
                  context?.set(event.currentTarget.valueAsNumber);
                }),
              ]}
            />
            <span id="editor-fov-default">Default: {Math.round(saved)}°</span>
            <button
              id="editor-fov-reset"
              type="button"
              disabled={!modified}
              mix={on("click", () => context?.reset())}
            >
              Reset to default
            </button>
            <button
              id="editor-fov-save"
              type="button"
              disabled={!modified}
              mix={on("click", () => context?.save())}
            >
              Use current as default
            </button>
            <button
              id="editor-fov-factory"
              type="button"
              mix={on("click", () => context?.factory())}
            >
              Restore 60° default
            </button>
          </div>
        </details>
      );
    };
  },
);
