interface EntityClassChoice {
  readonly classname: string;
  readonly label: string;
}

export interface EditorEntityCreationState {
  readonly brushClassname: string;
  readonly pointClassname: string;
  readonly pointOrigin: readonly [string, string, string];
  readonly brushClasses: readonly EntityClassChoice[];
  readonly pointClasses: readonly EntityClassChoice[];
  readonly makeBrushDisabled: boolean;
  readonly makeStructuralDisabled: boolean;
  readonly addPointDisabled: boolean;
}

export interface EditorEntityCreationContext {
  readonly state: EditorEntityCreationState;
  readonly setBrushClassname: (value: string) => void;
  readonly setPointClassname: (value: string) => void;
  readonly setPointOrigin: (axis: 0 | 1 | 2, value: string) => void;
  readonly makeBrushEntity: () => void;
  readonly makeStructural: () => void;
  readonly addPoint: () => void;
}

export function initEditorEntityCreation(actions: {
  readonly pointClassnameChanged: () => void;
  readonly makeBrushEntity: () => void;
  readonly makeStructural: () => void;
  readonly addPoint: () => void;
}) {
  let state: EditorEntityCreationState = {
    brushClassname: "func_detail",
    pointClassname: "info_player_start",
    pointOrigin: ["0", "0", "64"],
    brushClasses: [],
    pointClasses: [],
    makeBrushDisabled: true,
    makeStructuralDisabled: true,
    addPointDisabled: true,
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorEntityCreationContext>(
        "tea-maps-entity-creation-state",
        {
          detail: {
            state,
            setBrushClassname,
            setPointClassname,
            setPointOrigin,
            makeBrushEntity: actions.makeBrushEntity,
            makeStructural: actions.makeStructural,
            addPoint: actions.addPoint,
          },
        },
      ),
    );
  }

  function update(patch: Partial<EditorEntityCreationState>) {
    state = { ...state, ...patch };
    publish();
  }

  function setBrushClassname(value: string) {
    update({ brushClassname: value });
  }

  function setPointClassname(value: string) {
    update({ pointClassname: value });
    actions.pointClassnameChanged();
  }

  function setPointOrigin(axis: 0 | 1 | 2, value: string) {
    const next = [...state.pointOrigin] as [string, string, string];
    next[axis] = value;
    update({ pointOrigin: next });
  }

  window.addEventListener("tea-maps-entity-creation-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-entity-creation-bridge-ready"));

  return {
    get state() {
      return state;
    },
    update,
  };
}
