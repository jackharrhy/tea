import {
  DEFAULT_SIMPLE_SHAPE_OPTIONS,
  type SimpleShapeOptions,
} from "@tea/maps-editor/core";

export interface ShapeFields {
  readonly kind: SimpleShapeOptions["kind"];
  readonly axis: string;
  readonly sides: string;
  readonly circleMode: SimpleShapeOptions["circleMode"];
  readonly thickness: string;
  readonly rings: string;
  readonly accuracy: string;
  readonly stepHeight: string;
  readonly stairDirection: SimpleShapeOptions["stairDirection"];
}

export function shapeFields(options: SimpleShapeOptions): ShapeFields {
  return {
    kind: options.kind,
    axis: String(options.axis),
    sides: String(options.sides),
    circleMode: options.circleMode,
    thickness: String(options.thickness),
    rings: String(options.rings),
    accuracy: String(options.accuracy),
    stepHeight: String(options.stepHeight),
    stairDirection: options.stairDirection,
  };
}

export const initialShapeFields = shapeFields(DEFAULT_SIMPLE_SHAPE_OPTIONS);

export interface EditorShapePanelState {
  readonly visible: boolean;
  readonly result: string;
  readonly fields: ShapeFields;
  readonly hollow: boolean;
}

export interface EditorShapePanelContext {
  readonly state: EditorShapePanelState;
  readonly setField: <K extends keyof ShapeFields>(
    field: K,
    value: ShapeFields[K],
  ) => void;
  readonly setHollow: (value: boolean) => void;
}

export function initEditorShapePanel(inputChanged: () => void) {
  let state: EditorShapePanelState = {
    visible: false,
    result: "Drag to draw",
    fields: initialShapeFields,
    hollow: DEFAULT_SIMPLE_SHAPE_OPTIONS.hollow,
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorShapePanelContext>("tea-maps-shape-state", {
        detail: { state, setField, setHollow },
      }),
    );
  }

  function update(patch: Partial<EditorShapePanelState>) {
    state = { ...state, ...patch };
    publish();
  }

  function setField<K extends keyof ShapeFields>(
    field: K,
    value: ShapeFields[K],
  ) {
    update({ fields: { ...state.fields, [field]: value } });
    inputChanged();
  }

  function setHollow(hollow: boolean) {
    update({ hollow });
    inputChanged();
  }

  window.addEventListener("tea-maps-shape-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-shape-bridge-ready"));

  return {
    get state() {
      return state;
    },
    update,
  };
}
