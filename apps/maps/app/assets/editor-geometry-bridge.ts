export type CsgOperation = "merge" | "intersect" | "subtract" | "hollow";

export interface EditorGeometryState {
  readonly material: string;
  readonly materialChoices: readonly string[];
  readonly thickness: string;
  readonly addBoxDisabled: boolean;
  readonly mergeDisabled: boolean;
  readonly intersectDisabled: boolean;
  readonly subtractDisabled: boolean;
  readonly hollowDisabled: boolean;
  readonly thicknessDisabled: boolean;
}

export interface EditorGeometryContext {
  readonly state: EditorGeometryState;
  readonly setMaterial: (material: string) => void;
  readonly setThickness: (thickness: string) => void;
  readonly addBox: () => void;
  readonly runCsg: (operation: CsgOperation) => void;
}

export function initEditorGeometry(actions: {
  readonly addBox: () => void;
  readonly runCsg: (operation: CsgOperation) => void;
}) {
  let state: EditorGeometryState = {
    material: "DEV/GRID",
    materialChoices: [],
    thickness: "16",
    addBoxDisabled: true,
    mergeDisabled: true,
    intersectDisabled: true,
    subtractDisabled: true,
    hollowDisabled: true,
    thicknessDisabled: true,
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorGeometryContext>("tea-maps-geometry-state", {
        detail: { state, setMaterial, setThickness, ...actions },
      }),
    );
  }

  function update(patch: Partial<EditorGeometryState>) {
    state = { ...state, ...patch };
    publish();
  }

  function setMaterial(material: string) {
    update({ material });
  }

  function setThickness(thickness: string) {
    update({ thickness });
  }

  window.addEventListener("tea-maps-geometry-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-geometry-bridge-ready"));

  return {
    get state() {
      return state;
    },
    update,
    setMaterial,
  };
}
