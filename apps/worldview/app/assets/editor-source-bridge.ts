interface EditorSourceState {
  readonly value: string;
  readonly disabled: boolean;
  readonly warning: string | null;
}

export interface EditorSourceContext {
  readonly state: EditorSourceState;
  readonly input: (value: string) => void;
  readonly apply: () => void;
}

export function initEditorSourcePanel(actions: {
  readonly input: () => void;
  readonly apply: () => void;
}) {
  let state: EditorSourceState = {
    value: "",
    disabled: true,
    warning: null,
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorSourceContext>("tea-maps-source-state", {
        detail: { state, input, apply: actions.apply },
      }),
    );
  }

  function input(value: string) {
    state = { ...state, value };
    publish();
    actions.input();
  }

  window.addEventListener("tea-maps-source-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-source-bridge-ready"));

  return {
    get value() {
      return state.value;
    },
    set value(value: string) {
      state = { ...state, value };
      publish();
    },
    set disabled(disabled: boolean) {
      state = { ...state, disabled };
      publish();
    },
    setWarning(warning: string | null) {
      state = { ...state, warning };
      publish();
    },
  };
}
