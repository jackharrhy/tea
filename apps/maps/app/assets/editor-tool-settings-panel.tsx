import { clientEntry, css, on, type Handle } from "remix/component";
import type { EditorToolSettingsContext } from "./editor-tool-settings-bridge.ts";
import { editorGeometryIcon } from "./editor-geometry-icon.tsx";

const tools = [
  { value: "select", label: "Select and move", key: "Esc" },
  {
    value: "entity",
    label: "Place point entity",
    key: "N",
  },
  { value: "hull", label: "Convex hull brush", key: "B" },
  { value: "face", label: "Face", key: "F" },
  { value: "sweep", label: "Sweep faces", key: "W" },
  { value: "clip", label: "Clip brush", key: "C" },
  { value: "vertex", label: "Vertex edit", key: "V" },
  { value: "edge", label: "Edge edit", key: "E" },
  { value: "rotate", label: "Rotate", key: "R" },
  { value: "scale", label: "Scale", key: "S" },
  { value: "shear", label: "Shear", key: "H" },
  { value: "create", label: "Draw shape", key: "G" },
] as const;

export const EditorToolSettings = clientEntry(
  `file:///app/assets/editor-tool-settings-panel.tsx#EditorToolSettings`,
  function EditorToolSettingsComponent(handle: Handle) {
    let context: EditorToolSettingsContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-tool-settings-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-tool-settings-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-tool-settings-state",
        (event) => {
          context = (event as CustomEvent<EditorToolSettingsContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-tool-settings-ready"));
    });

    return () => {
      const state = context?.state;
      return (
        <div mix={css({ display: "contents" })}>
          <div
            class="editor-tool-group"
            role="group"
            aria-label="Viewport tools"
          >
            {tools.map((tool) => (
              <button
                class="editor-tool-button"
                data-tool={tool.value}
                type="button"
                title={`${tool.label} [${tool.key}]`}
                aria-label={tool.label}
                aria-pressed={state?.tool === tool.value}
                disabled={!state || state.toolDisabled}
                mix={on("click", () => context?.selectTool(tool.value))}
              >
                {editorGeometryIcon(tool.value)}
              </button>
            ))}
          </div>
          <select
            id="viewport-tool"
            aria-label="Viewport tool"
            class="editor-tool-select-fallback"
            disabled={!state || state.toolDisabled}
            value={state?.tool ?? "select"}
            mix={on<HTMLSelectElement>("change", (event) => {
              context?.selectTool(event.currentTarget.value);
            })}
          >
            <option value="select">Select and move</option>
            <option value="face">Face</option>
            <option value="clip">Clip brush</option>
            <option value="hull">Convex hull brush</option>
            <option value="sweep">Sweep faces</option>
            <option value="vertex">Vertex edit</option>
            <option value="edge">Edge edit</option>
            <option value="rotate">Rotate</option>
            <option value="scale">Scale</option>
            <option value="shear">Shear</option>
            <option value="create">Draw shape</option>
            <option value="entity">Place point entity</option>
          </select>
          <label class="editor-grid-label" for="grid-size">
            Grid
          </label>
          <select
            id="grid-size"
            value={String(state?.gridSize ?? 16)}
            mix={on<HTMLSelectElement>("change", (event) => {
              context?.setGridSize(Number(event.currentTarget.value));
            })}
          >
            {[1, 2, 4, 8, 16, 32, 64, 128, 256].map((size) => (
              <option value={String(size)}>{size}</option>
            ))}
          </select>
          <label
            class="editor-texture-lock"
            for="texture-lock"
            title="Texture lock"
          >
            <input
              id="texture-lock"
              type="checkbox"
              checked={state?.textureLock ?? true}
              mix={on<HTMLInputElement>("change", (event) => {
                context?.setTextureLock(event.currentTarget.checked);
              })}
            />{" "}
            <i class="ph ph-lock-key" aria-hidden="true" />
            <span class="editor-visually-hidden">Texture lock</span>
          </label>
        </div>
      );
    };
  },
);
