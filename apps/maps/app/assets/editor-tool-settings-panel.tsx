import { clientEntry, css, on, type Handle } from "remix/component";
import type { EditorToolSettingsContext } from "./editor-tool-settings-bridge.ts";

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
          <label for="viewport-tool">Viewport tool</label>
          <select
            id="viewport-tool"
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
          <label for="grid-size">Grid size</label>
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
          <label for="texture-lock">
            <input
              id="texture-lock"
              type="checkbox"
              checked={state?.textureLock ?? true}
              mix={on<HTMLInputElement>("change", (event) => {
                context?.setTextureLock(event.currentTarget.checked);
              })}
            />{" "}
            Texture lock
          </label>
        </div>
      );
    };
  },
);
