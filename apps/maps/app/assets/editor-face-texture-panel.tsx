import { clientEntry, css, on, type Handle } from "remix/component";
import type {
  FaceTextureAlignmentOperation,
  FaceTextureProjectionField,
} from "@tea/maps-editor/core";
import type { EditorFaceTextureContext } from "./editor-face-texture-bridge.ts";

const projectionFields = [
  { field: "offset-u", id: "texture-offset-u", label: "U offset", step: "1" },
  { field: "offset-v", id: "texture-offset-v", label: "V offset", step: "1" },
  { field: "scale-u", id: "texture-scale-u", label: "U scale", step: "0.25" },
  { field: "scale-v", id: "texture-scale-v", label: "V scale", step: "0.25" },
  {
    field: "rotation",
    id: "texture-rotation",
    label: "Rotation (°)",
    step: "15",
  },
] as const satisfies readonly {
  readonly field: FaceTextureProjectionField;
  readonly id: string;
  readonly label: string;
  readonly step: string;
}[];

const alignmentOperations = [
  ["reset", "Reset face projection"],
  ["world", "Align to world axes"],
  ["flip-u", "Flip horizontally"],
  ["flip-v", "Flip vertically"],
  ["rotate-ccw", "Rotate 90° left"],
  ["rotate-cw", "Rotate 90° right"],
  ["align-edge", "Align to face edge"],
  ["justify-u-min", "Justify left"],
  ["justify-u-max", "Justify right"],
  ["justify-v-min", "Justify top"],
  ["justify-v-max", "Justify bottom"],
  ["fit-u", "Fit horizontally"],
  ["fit-v", "Fit vertically"],
  ["auto-fit", "Fit to face"],
] as const satisfies readonly (readonly [
  FaceTextureAlignmentOperation,
  string,
])[];

export const EditorFaceProjectionFields = clientEntry(
  `file:///app/assets/editor-face-texture-panel.tsx#EditorFaceProjectionFields`,
  function EditorFaceProjectionFieldsComponent(handle: Handle) {
    let context: EditorFaceTextureContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-face-texture-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-face-texture-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-face-texture-state",
        (event) => {
          context = (event as CustomEvent<EditorFaceTextureContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-face-texture-ready"));
    });

    return () => (
      <div class="face-projection-fields">
        {projectionFields.map(({ field, id, label, step }) => {
          const input = context?.state.projection[field];
          return (
            <span mix={css({ display: "contents" })}>
              <label for={id}>{label}</label>
              <input
                id={id}
                type="number"
                step={step}
                value={input?.value ?? ""}
                placeholder={input?.placeholder ?? ""}
                disabled={!input || input.disabled}
                mix={[
                  on<HTMLInputElement>("input", (event) => {
                    context?.setProjection(field, event.currentTarget.value);
                  }),
                  on<HTMLInputElement>("change", (event) => {
                    context?.commitProjection(field, event.currentTarget.value);
                  }),
                ]}
              />
            </span>
          );
        })}
      </div>
    );
  },
);

export const EditorTextureAlignment = clientEntry(
  `file:///app/assets/editor-face-texture-panel.tsx#EditorTextureAlignment`,
  function EditorTextureAlignmentComponent(handle: Handle) {
    let context: EditorFaceTextureContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-face-texture-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-face-texture-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-face-texture-state",
        (event) => {
          context = (event as CustomEvent<EditorFaceTextureContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-face-texture-ready"));
    });

    return () => {
      const state = context?.state;
      return (
        <details id="texture-alignment">
          <summary>Align texture</summary>
          <label for="texture-alignment-operation">Operation</label>
          <select
            id="texture-alignment-operation"
            value={state?.alignmentOperation ?? "reset"}
            disabled={!state || state.alignmentDisabled}
            mix={on<HTMLSelectElement>("change", (event) => {
              context?.setAlignmentOperation(
                event.currentTarget.value as FaceTextureAlignmentOperation,
              );
            })}
          >
            {alignmentOperations.map(([value, label]) => (
              <option value={value}>{label}</option>
            ))}
          </select>
          <div class="texture-size-fields">
            <label for="texture-width">Texture width</label>
            <input
              id="texture-width"
              type="number"
              min="1"
              step="1"
              value={state?.width ?? ""}
              placeholder={state?.widthPlaceholder ?? ""}
              disabled={!state || state.alignmentDisabled}
              mix={on<HTMLInputElement>("input", (event) => {
                context?.setWidth(event.currentTarget.value);
              })}
            />
            <label for="texture-height">Texture height</label>
            <input
              id="texture-height"
              type="number"
              min="1"
              step="1"
              value={state?.height ?? ""}
              placeholder={state?.heightPlaceholder ?? ""}
              disabled={!state || state.alignmentDisabled}
              mix={on<HTMLInputElement>("input", (event) => {
                context?.setHeight(event.currentTarget.value);
              })}
            />
          </div>
          <p>
            Fit and justify use project texture sizes, or both dimensions
            entered here.
          </p>
          <label for="texture-align-reverse">
            <input
              id="texture-align-reverse"
              type="checkbox"
              checked={state?.reverse ?? false}
              disabled={!state || state.alignmentDisabled}
              mix={on<HTMLInputElement>("change", (event) => {
                context?.setReverse(event.currentTarget.checked);
              })}
            />
            Reverse direction
          </label>
          <label for="texture-align-subdivide">
            <input
              id="texture-align-subdivide"
              type="checkbox"
              checked={state?.subdivide ?? false}
              disabled={!state || state.alignmentDisabled}
              mix={on<HTMLInputElement>("change", (event) => {
                context?.setSubdivide(event.currentTarget.checked);
              })}
            />
            Subdivide when fitting
          </label>
          <button
            id="apply-texture-alignment"
            type="button"
            disabled={!state || state.alignmentDisabled}
            mix={on("click", () => context?.applyAlignment())}
          >
            Align selection
          </button>
        </details>
      );
    };
  },
);
