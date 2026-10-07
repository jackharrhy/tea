import type { TransformAxis } from "@tea/maps-editor/core";

type AxisValues = readonly [string, string, string];

export interface EditorTransformsState {
  readonly move: AxisValues;
  readonly rotateAxis: TransformAxis;
  readonly rotateDegrees: string;
  readonly rotateValid: boolean;
  readonly scale: AxisValues;
  readonly scaleValid: readonly [boolean, boolean, boolean];
  readonly shearSourceAxis: TransformAxis;
  readonly shearTargetAxis: TransformAxis;
  readonly shearOffset: string;
  readonly shearValid: boolean;
  readonly moveDisabled: boolean;
  readonly nudgeDisabled: boolean;
  readonly rotateDisabled: boolean;
  readonly scaleDisabled: boolean;
  readonly shearDisabled: boolean;
  readonly flipDisabled: boolean;
}

export interface EditorTransformsContext {
  readonly state: EditorTransformsState;
  readonly setMove: (axis: TransformAxis, value: string) => void;
  readonly setRotateAxis: (axis: TransformAxis) => void;
  readonly setRotateDegrees: (value: string, valid: boolean) => void;
  readonly setScale: (
    axis: TransformAxis,
    value: string,
    valid: boolean,
  ) => void;
  readonly setShearSourceAxis: (axis: TransformAxis) => void;
  readonly setShearTargetAxis: (axis: TransformAxis) => void;
  readonly setShearOffset: (value: string, valid: boolean) => void;
  readonly move: () => void;
  readonly nudge: (axis: TransformAxis, direction: -1 | 1) => void;
  readonly rotate: () => void;
  readonly scale: () => void;
  readonly shear: () => void;
  readonly flip: (axis: TransformAxis) => void;
}

export function initEditorTransforms(actions: {
  readonly move: () => void;
  readonly nudge: (axis: TransformAxis, direction: -1 | 1) => void;
  readonly rotate: () => void;
  readonly scale: () => void;
  readonly shear: () => void;
  readonly flip: (axis: TransformAxis) => void;
}) {
  let state: EditorTransformsState = {
    move: ["16", "0", "0"],
    rotateAxis: 2,
    rotateDegrees: "90",
    rotateValid: true,
    scale: ["1.25", "1.25", "1.25"],
    scaleValid: [true, true, true],
    shearSourceAxis: 2,
    shearTargetAxis: 0,
    shearOffset: "16",
    shearValid: true,
    moveDisabled: true,
    nudgeDisabled: true,
    rotateDisabled: true,
    scaleDisabled: true,
    shearDisabled: true,
    flipDisabled: true,
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorTransformsContext>("tea-maps-transforms-state", {
        detail: {
          state,
          setMove,
          setRotateAxis,
          setRotateDegrees,
          setScale,
          setShearSourceAxis,
          setShearTargetAxis,
          setShearOffset,
          ...actions,
        },
      }),
    );
  }

  function update(patch: Partial<EditorTransformsState>) {
    state = { ...state, ...patch };
    publish();
  }

  function setMove(axis: TransformAxis, value: string) {
    const move = [...state.move] as [string, string, string];
    move[axis] = value;
    update({ move });
  }

  function setRotateAxis(rotateAxis: TransformAxis) {
    update({ rotateAxis });
  }

  function setRotateDegrees(rotateDegrees: string, rotateValid: boolean) {
    update({ rotateDegrees, rotateValid });
  }

  function setScale(axis: TransformAxis, value: string, valid: boolean) {
    const scale = [...state.scale] as [string, string, string];
    const scaleValid = [...state.scaleValid] as [boolean, boolean, boolean];
    scale[axis] = value;
    scaleValid[axis] = valid;
    update({ scale, scaleValid });
  }

  function setShearSourceAxis(shearSourceAxis: TransformAxis) {
    update({ shearSourceAxis });
  }

  function setShearTargetAxis(shearTargetAxis: TransformAxis) {
    update({ shearTargetAxis });
  }

  function setShearOffset(shearOffset: string, shearValid: boolean) {
    update({ shearOffset, shearValid });
  }

  window.addEventListener("tea-maps-transforms-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-transforms-bridge-ready"));

  return {
    get state() {
      return state;
    },
    update,
  };
}
