import { clientEntry, css, on, type Handle } from "remix/component";
import type { EditorFaceBasicsContext } from "./editor-face-basics-bridge.ts";

export const EditorFaceBasics = clientEntry(
  `file:///app/assets/editor-face-basics-panel.tsx#EditorFaceBasics`,
  function EditorFaceBasicsComponent(handle: Handle) {
    let context: EditorFaceBasicsContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-face-basics-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-face-basics-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-face-basics-state",
        (event) => {
          context = (event as CustomEvent<EditorFaceBasicsContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-face-basics-ready"));
    });

    return () => {
      const state = context?.state;
      return (
        <div mix={css({ display: "contents" })}>
          <p id="face-inspector-summary">{state?.summary ?? ""}</p>
          <label for="selected-face">Face</label>
          <select
            id="selected-face"
            aria-label="Select brush face"
            value={state?.selectedFaceId ?? ""}
            disabled={!state || state.faceSelectDisabled}
            mix={on<HTMLSelectElement>("change", (event) => {
              context?.selectFace(event.currentTarget.value);
            })}
          >
            <option value="">All brush faces</option>
            {state?.faces.map((face) => (
              <option value={face.id}>{face.label}</option>
            ))}
          </select>
          <div id="face-geometry" hidden={!state?.geometryVisible}>
            <h3>Face geometry</h3>
            <label for="face-distance">Distance</label>
            <input
              id="face-distance"
              type="number"
              step="1"
              value={state?.distance ?? "16"}
              disabled={!state || state.distanceDisabled}
              mix={on<HTMLInputElement>("input", (event) => {
                context?.setDistance(event.currentTarget.value);
              })}
            />
            <div class="face-geometry-actions">
              <button
                id="extrude-face"
                type="button"
                disabled={!state || state.geometryDisabled}
                mix={on("click", () => context?.runGeometry("extrude"))}
              >
                Extrude
              </button>
              <button
                id="split-face"
                type="button"
                disabled={!state || state.geometryDisabled}
                mix={on("click", () => context?.runGeometry("split"))}
              >
                Split
              </button>
              <button
                id="stamp-face"
                type="button"
                disabled={!state || state.geometryDisabled}
                mix={on("click", () => context?.runGeometry("stamp"))}
              >
                Stamp
              </button>
            </div>
          </div>
          <h3>Texture</h3>
          <label for="selected-material">Material</label>
          <div class="face-material-actions">
            <input
              id="selected-material"
              type="text"
              list="material-choices"
              autoComplete="off"
              spellCheck={false}
              value={state?.material ?? ""}
              placeholder={state?.materialPlaceholder ?? "Material"}
              disabled={!state || state.materialDisabled}
              mix={[
                on<HTMLInputElement>("input", (event) => {
                  context?.setMaterial(event.currentTarget.value);
                }),
                on<HTMLInputElement>("keydown", (event) => {
                  if (!("key" in event) || event.key !== "Enter") return;
                  event.preventDefault();
                  context?.applyMaterial();
                }),
              ]}
            />
            <button
              id="apply-material"
              type="button"
              disabled={!state || state.applyMaterialDisabled}
              mix={on("click", () => context?.applyMaterial())}
            >
              Apply
            </button>
          </div>
        </div>
      );
    };
  },
);
