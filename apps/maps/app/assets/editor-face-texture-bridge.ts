import type {
  FaceTextureAlignmentOperation,
  FaceTextureProjectionField,
} from "@tea/maps-editor/core";

export interface ProjectionInputState {
  readonly value: string;
  readonly placeholder: string;
  readonly disabled: boolean;
}

export interface EditorFaceTextureState {
  readonly projection: Readonly<
    Record<FaceTextureProjectionField, ProjectionInputState>
  >;
  readonly alignmentOperation: FaceTextureAlignmentOperation;
  readonly width: string;
  readonly height: string;
  readonly widthPlaceholder: string;
  readonly heightPlaceholder: string;
  readonly alignmentDisabled: boolean;
  readonly reverse: boolean;
  readonly subdivide: boolean;
}

export interface EditorFaceTextureContext {
  readonly state: EditorFaceTextureState;
  readonly setProjection: (
    field: FaceTextureProjectionField,
    value: string,
  ) => void;
  readonly commitProjection: (
    field: FaceTextureProjectionField,
    value: string,
  ) => void;
  readonly setAlignmentOperation: (
    value: FaceTextureAlignmentOperation,
  ) => void;
  readonly setWidth: (value: string) => void;
  readonly setHeight: (value: string) => void;
  readonly setReverse: (value: boolean) => void;
  readonly setSubdivide: (value: boolean) => void;
  readonly applyAlignment: () => void;
}

const emptyProjection: ProjectionInputState = {
  value: "",
  placeholder: "",
  disabled: true,
};

export function initEditorFaceTexture(actions: {
  readonly commitProjection: (
    field: FaceTextureProjectionField,
    value: string,
  ) => void;
  readonly applyAlignment: () => void;
}) {
  let state: EditorFaceTextureState = {
    projection: {
      "offset-u": emptyProjection,
      "offset-v": emptyProjection,
      "scale-u": emptyProjection,
      "scale-v": emptyProjection,
      rotation: emptyProjection,
    },
    alignmentOperation: "reset",
    width: "",
    height: "",
    widthPlaceholder: "",
    heightPlaceholder: "",
    alignmentDisabled: true,
    reverse: false,
    subdivide: false,
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorFaceTextureContext>("tea-maps-face-texture-state", {
        detail: {
          state,
          setProjection,
          commitProjection: actions.commitProjection,
          setAlignmentOperation,
          setWidth,
          setHeight,
          setReverse,
          setSubdivide,
          applyAlignment: actions.applyAlignment,
        },
      }),
    );
  }

  function update(patch: Partial<EditorFaceTextureState>) {
    state = { ...state, ...patch };
    publish();
  }

  function setProjection(field: FaceTextureProjectionField, value: string) {
    update({
      projection: {
        ...state.projection,
        [field]: { ...state.projection[field], value },
      },
    });
  }

  function setAlignmentOperation(
    alignmentOperation: FaceTextureAlignmentOperation,
  ) {
    update({ alignmentOperation });
  }

  function setWidth(width: string) {
    update({ width });
  }

  function setHeight(height: string) {
    update({ height });
  }

  function setReverse(reverse: boolean) {
    update({ reverse });
  }

  function setSubdivide(subdivide: boolean) {
    update({ subdivide });
  }

  window.addEventListener("tea-maps-face-texture-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-face-texture-bridge-ready"));

  return {
    get state() {
      return state;
    },
    update,
  };
}
