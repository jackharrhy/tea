export interface SurfaceFlagChoice {
  readonly value: number;
  readonly label: string;
  readonly checked: boolean;
  readonly indeterminate: boolean;
}

export interface EditorSurfaceState {
  readonly visible: boolean;
  readonly contents: readonly SurfaceFlagChoice[];
  readonly flags: readonly SurfaceFlagChoice[];
  readonly unknownContents: string | null;
  readonly unknownFlags: string | null;
  readonly valueLabel: string;
  readonly value: string;
  readonly valuePlaceholder: string;
  readonly disabled: boolean;
}

export interface EditorSurfaceContext {
  readonly state: EditorSurfaceState;
  readonly setValue: (value: string) => void;
  readonly commitValue: (value: string) => void;
  readonly setFlag: (
    field: "contents" | "flags",
    mask: number,
    enabled: boolean,
  ) => void;
}

export function initEditorSurface(actions: {
  readonly commitValue: (value: string) => void;
  readonly setFlag: (
    field: "contents" | "flags",
    mask: number,
    enabled: boolean,
  ) => void;
}) {
  let state: EditorSurfaceState = {
    visible: false,
    contents: [],
    flags: [],
    unknownContents: null,
    unknownFlags: null,
    valueLabel: "Light value",
    value: "",
    valuePlaceholder: "",
    disabled: true,
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorSurfaceContext>("tea-maps-surface-state", {
        detail: {
          state,
          setValue,
          commitValue: actions.commitValue,
          setFlag: actions.setFlag,
        },
      }),
    );
  }

  function update(patch: Partial<EditorSurfaceState>) {
    state = { ...state, ...patch };
    publish();
  }

  function setValue(value: string) {
    update({ value });
  }

  window.addEventListener("tea-maps-surface-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-surface-bridge-ready"));

  return {
    get state() {
      return state;
    },
    update,
  };
}
