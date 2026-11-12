export interface EditorProjectContextState {
  readonly projectName: string | null;
  readonly paths: readonly string[];
  readonly selectedPath: string;
  readonly resourceInfo: string;
  readonly diagnostics: readonly string[];
  readonly standalone: boolean;
  readonly standaloneGame: string;
  readonly standaloneWadCount: number;
  readonly standalonePalette: boolean;
  readonly standaloneMessage: string;
}

export interface EditorProjectContext {
  readonly state: EditorProjectContextState;
  readonly openMap: (path: string) => Promise<boolean>;
  readonly addWads: (files: readonly File[]) => Promise<void>;
  readonly setPalette: (file: File) => Promise<void>;
  readonly clearResources: () => Promise<void>;
}

export function initEditorProjectContext(
  openMap: (path: string) => Promise<boolean>,
  resources: Pick<
    EditorProjectContext,
    "addWads" | "setPalette" | "clearResources"
  >,
) {
  let state: EditorProjectContextState = {
    projectName: null,
    paths: [],
    selectedPath: "",
    resourceInfo: "",
    diagnostics: [],
    standalone: true,
    standaloneGame: "quake",
    standaloneWadCount: 0,
    standalonePalette: false,
    standaloneMessage: "",
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorProjectContext>("tea-maps-project-context-state", {
        detail: { state, openMap, ...resources },
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
