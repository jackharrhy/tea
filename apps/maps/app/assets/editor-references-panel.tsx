import { clientEntry, on, ref, type Handle } from "remix/component";
import type { EditorReferencesContext } from "./editor-references.ts";

const axes = [
  [0, "X"],
  [1, "Y"],
  [2, "Z"],
] as const;

export const EditorReferences = clientEntry(
  `${import.meta.url}#EditorReferences`,
  function EditorReferencesComponent(handle: Handle) {
    let context: EditorReferencesContext | null = null;
    let fileInput: HTMLInputElement | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-references-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-references-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-references-state",
        (event) => {
          context = (event as CustomEvent<EditorReferencesContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-references-ready"));
    });

    return () => {
      const scenes = context?.scenes ?? [];
      return (
        <details id="reference-tools">
          <summary>References</summary>
          <div class="reference-controls">
            <span id="reference-count">{scenes.length} loaded</span>
            <button
              id="load-reference"
              type="button"
              disabled={!context}
              mix={on("click", () => fileInput?.click())}
            >
              Load .map
            </button>
            <input
              id="reference-file"
              type="file"
              accept=".map,text/plain"
              hidden
              mix={[
                ref((node: HTMLInputElement) => {
                  fileInput = node;
                }),
                on<HTMLInputElement>("change", (event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void context?.loadFile(file);
                }),
              ]}
            />
            <button
              id="snapshot-reference"
              type="button"
              disabled={!context}
              mix={on("click", () => context?.snapshot())}
            >
              Snapshot current map
            </button>
            <button
              id="clear-references"
              type="button"
              disabled={!scenes.length}
              mix={on("click", () => context?.clear())}
            >
              Clear
            </button>
          </div>
          <div id="reference-list" class="reference-list">
            {scenes.map((scene) => (
              <div class="reference-row">
                <label>
                  <input
                    type="checkbox"
                    checked={scene.visible}
                    mix={on<HTMLInputElement>("change", (event) => {
                      context?.change(scene.id, {
                        visible: event.currentTarget.checked,
                      });
                    })}
                  />{" "}
                  {scene.label}
                </label>
                {axes.map(([axis, label]) => (
                  <label>
                    {label} offset{" "}
                    <input
                      type="number"
                      step="16"
                      defaultValue={scene.offset[axis]}
                      mix={on<HTMLInputElement>("change", (event) => {
                        const value = event.currentTarget.valueAsNumber;
                        if (!Number.isFinite(value)) {
                          event.currentTarget.value = String(
                            scene.offset[axis],
                          );
                          return;
                        }
                        const offset: [number, number, number] = [
                          ...scene.offset,
                        ];
                        offset[axis] = value;
                        context?.change(scene.id, { offset });
                      })}
                    />
                  </label>
                ))}
                <button
                  type="button"
                  mix={on("click", () => context?.remove(scene.id))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </details>
      );
    };
  },
);
