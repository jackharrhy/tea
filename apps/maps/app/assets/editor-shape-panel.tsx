import { clientEntry, css, on, type Handle } from "remix/component";
import {
  initialShapeFields,
  type EditorShapePanelContext,
  type ShapeFields,
} from "./editor-shape-bridge.ts";

export const EditorShapePanel = clientEntry(
  `file:///app/assets/editor-shape-panel.tsx#EditorShapePanel`,
  function EditorShapePanelComponent(handle: Handle) {
    let context: EditorShapePanelContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-shape-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-shape-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-shape-state",
        (event) => {
          context = (event as CustomEvent<EditorShapePanelContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-shape-ready"));
    });

    function numberField(
      field: "sides" | "thickness" | "rings" | "accuracy" | "stepHeight",
      id: string,
      label: string,
      min: string,
      max: string,
      disabled = false,
    ) {
      return (
        <span mix={css({ display: "contents" })}>
          <label for={id}>{label}</label>
          <input
            id={id}
            type="number"
            min={min}
            max={max}
            step="1"
            value={context?.state.fields[field] ?? initialShapeFields[field]}
            disabled={!context || disabled}
            mix={on<HTMLInputElement>("input", (event) => {
              context?.setField(field, event.currentTarget.value);
            })}
          />
        </span>
      );
    }

    return () => {
      const state = context?.state;
      const fields = state?.fields ?? initialShapeFields;
      const circular = ["arch", "cylinder", "cone", "uv-sphere"].includes(
        fields.kind,
      );
      return (
        <div id="shape-tools" class="shape-tools" hidden={!state?.visible}>
          <strong>Simple shape</strong>
          <span id="shape-result">{state?.result ?? "Drag to draw"}</span>
          <label for="shape-kind">Shape</label>
          <select
            id="shape-kind"
            value={fields.kind}
            disabled={!context}
            mix={on<HTMLSelectElement>("change", (event) => {
              context?.setField(
                "kind",
                event.currentTarget.value as ShapeFields["kind"],
              );
            })}
          >
            <option value="cuboid">Cuboid</option>
            <option value="stairs">Stairs</option>
            <option value="arch">Arch</option>
            <option value="cylinder">Cylinder</option>
            <option value="cone">Cone</option>
            <option value="uv-sphere">UV spheroid</option>
            <option value="ico-sphere">Icosphere</option>
          </select>
          <div id="shape-circle-fields" class="shape-fields" hidden={!circular}>
            <label for="shape-axis">Axis</label>
            <select
              id="shape-axis"
              value={fields.axis}
              disabled={!context}
              mix={on<HTMLSelectElement>("change", (event) => {
                context?.setField("axis", event.currentTarget.value);
              })}
            >
              <option value="0">X</option>
              <option value="1">Y</option>
              <option value="2">Z</option>
            </select>
            {numberField("sides", "shape-sides", "Sides", "3", "96")}
            <label for="shape-circle-mode">Circle</label>
            <select
              id="shape-circle-mode"
              value={fields.circleMode}
              disabled={!context}
              mix={on<HTMLSelectElement>("change", (event) => {
                context?.setField(
                  "circleMode",
                  event.currentTarget.value as ShapeFields["circleMode"],
                );
              })}
            >
              <option value="edge-aligned">Edge aligned</option>
              <option value="vertex-aligned">Vertex aligned</option>
              <option value="scalable">Scalable grid</option>
            </select>
          </div>
          <div
            id="shape-hollow-fields"
            class="shape-fields"
            hidden={fields.kind !== "arch" && fields.kind !== "cylinder"}
          >
            <label
              id="shape-hollow-label"
              for="shape-hollow"
              hidden={fields.kind === "arch"}
            >
              <input
                id="shape-hollow"
                type="checkbox"
                checked={state?.hollow ?? false}
                disabled={!context}
                mix={on<HTMLInputElement>("change", (event) => {
                  context?.setHollow(event.currentTarget.checked);
                })}
              />{" "}
              Hollow
            </label>
            {numberField(
              "thickness",
              "shape-thickness",
              "Thickness",
              "1",
              "1024",
              fields.kind === "cylinder" && !state?.hollow,
            )}
          </div>
          <div
            id="shape-uv-fields"
            class="shape-fields"
            hidden={fields.kind !== "uv-sphere"}
          >
            {numberField("rings", "shape-rings", "Rings", "1", "32")}
          </div>
          <div
            id="shape-ico-fields"
            class="shape-fields"
            hidden={fields.kind !== "ico-sphere"}
          >
            {numberField("accuracy", "shape-accuracy", "Accuracy", "1", "3")}
          </div>
          <div
            id="shape-stair-fields"
            class="shape-fields"
            hidden={fields.kind !== "stairs"}
          >
            {numberField(
              "stepHeight",
              "shape-step-height",
              "Step height",
              "1",
              "1024",
            )}
            <label for="shape-stair-direction">Direction</label>
            <select
              id="shape-stair-direction"
              value={fields.stairDirection}
              disabled={!context}
              mix={on<HTMLSelectElement>("change", (event) => {
                context?.setField(
                  "stairDirection",
                  event.currentTarget.value as ShapeFields["stairDirection"],
                );
              })}
            >
              <option value="positive-x">+X</option>
              <option value="negative-x">−X</option>
              <option value="positive-y">+Y</option>
              <option value="negative-y">−Y</option>
            </select>
          </div>
          <p>
            Drag in a viewport to size the shape. Shift makes the visible axes
            equal; Shift+Alt makes a cube in perspective.
          </p>
        </div>
      );
    };
  },
);
