import { clientEntry, css, on, type Handle } from "remix/component";
import type {
  EditorLayerCommand,
  EditorLayersPanelState,
} from "./editor-layers-bridge.ts";

export const EditorLayers = clientEntry(
  `file:///app/assets/editor-layers-panel.tsx#EditorLayers`,
  function EditorLayersComponent(handle: Handle) {
    let state: EditorLayersPanelState | null = null;
    let nameDraft = "";
    let newNameDraft = "Layer";
    let previousSelection: string | null | undefined;

    function run(command: EditorLayerCommand) {
      state?.run(command);
    }

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-layers-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-layers-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-layers-state",
        (event) => {
          state = (event as CustomEvent<EditorLayersPanelState>).detail;
          const selected = state.layers.find(
            (layer) => layer.id === state?.selectedLayerId,
          );
          if (
            previousSelection !== state.selectedLayerId ||
            document.activeElement?.id !== "layer-name"
          ) {
            nameDraft = selected?.name ?? "";
          }
          previousSelection = state.selectedLayerId;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-layers-ready"));
    });

    return () => {
      const layers = state?.layers ?? [];
      const selected = layers.find(
        (layer) => layer.id === state?.selectedLayerId,
      );
      const custom = layers.filter((layer) => layer.id !== null);
      const customIndex = custom.findIndex(
        (layer) => layer.id === state?.selectedLayerId,
      );
      const editing = state?.editing ?? false;
      const customSelected = state?.selectedLayerId != null;
      const populated =
        !!selected &&
        !selected.hidden &&
        !selected.locked &&
        selected.brushIds.length + selected.pointEntityIds.length > 0;

      return (
        <div mix={css({ display: "contents" })}>
          <details id="layer-tools">
            <summary>Layers</summary>
            <div class="layer-controls">
              <label for="layer-select">Layer</label>
              <select
                id="layer-select"
                aria-label="Map layer"
                value={state?.selectedLayerId ?? ""}
                disabled={layers.length === 0}
                mix={on<HTMLSelectElement>("change", (event) =>
                  run({
                    type: "choose",
                    id: event.currentTarget.value || null,
                  }),
                )}
              >
                {layers.map((layer) => (
                  <option value={layer.id ?? ""}>
                    {layer.name}
                    {layer.id === state?.activeLayerId ? " · active" : ""}
                  </option>
                ))}
              </select>
              <span id="layer-count">
                {selected
                  ? `${selected.brushIds.length} brushes · ${selected.pointEntityIds.length} point entities`
                  : ""}
              </span>
              <label for="layer-name">Name</label>
              <input
                id="layer-name"
                type="text"
                value={nameDraft}
                autoComplete="off"
                disabled={!editing || !customSelected}
                mix={on<HTMLInputElement>("input", (event) => {
                  nameDraft = event.currentTarget.value;
                })}
              />
              <button
                id="rename-layer"
                type="button"
                disabled={!editing || !customSelected}
                mix={on("click", () =>
                  run({ type: "rename", name: nameDraft }),
                )}
              >
                Rename
              </button>
              <button
                id="activate-layer"
                type="button"
                disabled={
                  !editing || state?.selectedLayerId === state?.activeLayerId
                }
                mix={on("click", () => run({ type: "activate" }))}
              >
                Make active
              </button>
              <button
                id="move-to-layer"
                type="button"
                disabled={!editing || !state?.hasObjectSelection}
                mix={on("click", () => run({ type: "move" }))}
              >
                Move selection
              </button>
              <button
                id="select-layer-contents"
                type="button"
                disabled={!populated}
                mix={on("click", () => run({ type: "select" }))}
              >
                Select contents
              </button>
              <button
                id="isolate-layer"
                type="button"
                disabled={!editing || layers.length < 2}
                mix={on("click", () => run({ type: "isolate" }))}
              >
                Isolate
              </button>
              <label for="layer-hidden">
                <input
                  id="layer-hidden"
                  type="checkbox"
                  checked={selected?.hidden ?? false}
                  disabled={!editing || !selected}
                  mix={on<HTMLInputElement>("change", (event) =>
                    run({
                      type: "flag",
                      flag: "hidden",
                      value: event.currentTarget.checked,
                    }),
                  )}
                />{" "}
                Hidden
              </label>
              <label for="layer-locked">
                <input
                  id="layer-locked"
                  type="checkbox"
                  checked={selected?.locked ?? false}
                  disabled={!editing || !selected}
                  mix={on<HTMLInputElement>("change", (event) =>
                    run({
                      type: "flag",
                      flag: "locked",
                      value: event.currentTarget.checked,
                    }),
                  )}
                />{" "}
                Locked
              </label>
              <label for="layer-omit">
                <input
                  id="layer-omit"
                  type="checkbox"
                  checked={selected?.omitFromExport ?? false}
                  disabled={!editing || !selected}
                  mix={on<HTMLInputElement>("change", (event) =>
                    run({
                      type: "flag",
                      flag: "omit-from-export",
                      value: event.currentTarget.checked,
                    }),
                  )}
                />{" "}
                Omit from build
              </label>
              <button
                id="layer-up"
                type="button"
                disabled={!editing || customIndex <= 0}
                mix={on("click", () => run({ type: "up" }))}
              >
                Move up
              </button>
              <button
                id="layer-down"
                type="button"
                disabled={
                  !editing ||
                  customIndex < 0 ||
                  customIndex >= custom.length - 1
                }
                mix={on("click", () => run({ type: "down" }))}
              >
                Move down
              </button>
              <button
                id="remove-layer"
                type="button"
                disabled={!editing || !customSelected}
                mix={on("click", () => run({ type: "remove" }))}
              >
                Remove layer
              </button>
              <label for="new-layer-name">New layer</label>
              <input
                id="new-layer-name"
                type="text"
                value={newNameDraft}
                autoComplete="off"
                disabled={!editing}
                mix={on<HTMLInputElement>("input", (event) => {
                  newNameDraft = event.currentTarget.value;
                })}
              />
              <button
                id="create-layer"
                type="button"
                disabled={!editing}
                mix={on("click", () =>
                  run({ type: "create", name: newNameDraft }),
                )}
              >
                Add layer
              </button>
              <button
                id="show-all-layers"
                type="button"
                disabled={!editing || layers.length === 0}
                mix={on("click", () =>
                  run({ type: "all", flag: "hidden", value: false }),
                )}
              >
                Show all
              </button>
              <button
                id="hide-all-layers"
                type="button"
                disabled={!editing || layers.length === 0}
                mix={on("click", () =>
                  run({ type: "all", flag: "hidden", value: true }),
                )}
              >
                Hide all
              </button>
              <button
                id="unlock-all-layers"
                type="button"
                disabled={!editing || layers.length === 0}
                mix={on("click", () =>
                  run({ type: "all", flag: "locked", value: false }),
                )}
              >
                Unlock all
              </button>
              <button
                id="lock-all-layers"
                type="button"
                disabled={!editing || layers.length === 0}
                mix={on("click", () =>
                  run({ type: "all", flag: "locked", value: true }),
                )}
              >
                Lock all
              </button>
            </div>
          </details>
        </div>
      );
    };
  },
);
