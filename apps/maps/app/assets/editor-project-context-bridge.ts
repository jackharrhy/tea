export interface EditorProjectContextState {
  readonly projectName: string | null;
  readonly paths: readonly string[];
  readonly selectedPath: string;
  readonly resourceInfo: string;
  readonly diagnostics: readonly string[];
}

export interface EditorProjectContext {
  readonly state: EditorProjectContextState;
  readonly openMap: (path: string) => Promise<boolean>;
}

export function initEditorProjectContext(
  openMap: (path: string) => Promise<boolean>,
) {
  let state: EditorProjectContextState = {
    projectName: null,
    paths: [],
    selectedPath: "",
    resourceInfo: "",
    diagnostics: [],
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorProjectContext>("tea-maps-project-context-state", {
        detail: { state, openMap },
      }),
    );
  }

  window.addEventListener("tea-maps-project-context-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-project-context-bridge-ready"));

  return {
    update(patch: Partial<EditorProjectContextState>) {
      state = { ...state, ...patch };
      publish();
    },
  };
}
