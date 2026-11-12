export type FaceGeometryOperation = "extrude" | "split" | "stamp";

export interface EditorFaceBasicsState {
  readonly summary: string;
  readonly faces: readonly { readonly id: string; readonly label: string }[];
  readonly selectedFaceId: string;
  readonly faceSelectDisabled: boolean;
  readonly geometryVisible: boolean;
  readonly distance: string;
  readonly distanceDisabled: boolean;
  readonly geometryDisabled: boolean;
  readonly material: string;
  readonly materialPlaceholder: string;
  readonly materialDisabled: boolean;
  readonly applyMaterialDisabled: boolean;
}

export interface EditorFaceBasicsContext {
  readonly state: EditorFaceBasicsState;
  readonly selectFace: (faceId: string) => void;
  readonly setDistance: (value: string) => void;
  readonly setMaterial: (value: string) => void;
  readonly runGeometry: (operation: FaceGeometryOperation) => void;
  readonly applyMaterial: () => void;
}

export function initEditorFaceBasics(actions: {
  readonly selectFace: (faceId: string) => void;
  readonly runGeometry: (operation: FaceGeometryOperation) => void;
  readonly applyMaterial: () => void;
}) {
  let state: EditorFaceBasicsState = {
    summary: "",
    faces: [],
    selectedFaceId: "",
    faceSelectDisabled: true,
    geometryVisible: false,
    distance: "16",
    distanceDisabled: true,
    geometryDisabled: true,
    material: "",
    materialPlaceholder: "Material",
    materialDisabled: true,
    applyMaterialDisabled: true,
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorFaceBasicsContext>("tea-maps-face-basics-state", {
        detail: {
          state,
          selectFace: actions.selectFace,
          setDistance,
          setMaterial,
          runGeometry: actions.runGeometry,
          applyMaterial: actions.applyMaterial,
        },
      }),
    );
  }

  function update(patch: Partial<EditorFaceBasicsState>) {
    state = { ...state, ...patch };
    publish();
  }

  function setDistance(distance: string) {
    update({ distance });
  }

  function setMaterial(material: string) {
    update({
      material,
      applyMaterialDisabled: state.materialDisabled || !material.trim(),
    });
  }

  window.addEventListener("tea-maps-face-basics-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-face-basics-bridge-ready"));

  return {
    get state() {
      return state;
    },
    update,
    setMaterial,
  };
}
