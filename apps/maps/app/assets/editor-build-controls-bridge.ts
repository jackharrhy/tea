import type { WorldviewGameProfile } from "@tea/maps-editor/core";

export interface EditorBuildControlState {
  readonly game: WorldviewGameProfile;
  readonly gameDisabled: boolean;
  readonly profiles: readonly { readonly id: string; readonly label: string }[];
  readonly profileId: string;
  readonly profileDisabled: boolean;
  readonly buildDisabled: boolean;
  readonly buildLabel: string;
  readonly buildExportOnceDisabled: boolean;
  readonly exportDisabled: boolean;
  readonly previewDisabled: boolean;
  readonly previewLabel: string;
}

export interface EditorBuildControlActions {
  readonly selectGame: (game: string) => void;
  readonly selectProfile: (id: string) => void;
  readonly build: () => void;
  readonly buildExportOnce: () => void;
  readonly exportLatest: () => void;
  readonly togglePreview: () => void;
}

export interface EditorBuildControlsContext {
  readonly state: EditorBuildControlState;
  readonly actions: EditorBuildControlActions;
}

export function initEditorBuildControls(actions: EditorBuildControlActions) {
  let state: EditorBuildControlState = {
    game: "quake",
    gameDisabled: false,
    profiles: [
      { id: "preview", label: "Preview" },
      { id: "final", label: "Final" },
    ],
    profileId: "preview",
    profileDisabled: true,
    buildDisabled: true,
    buildLabel: "Build BSP",
    buildExportOnceDisabled: true,
    exportDisabled: true,
    previewDisabled: true,
    previewLabel: "Show compiled",
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorBuildControlsContext>(
        "tea-maps-build-controls-state",
        {
          detail: { state, actions },
        },
      ),
    );
  }

  window.addEventListener("tea-maps-build-controls-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-build-controls-bridge-ready"));

  return {
    get state() {
      return state;
    },
    update(patch: Partial<EditorBuildControlState>) {
      state = { ...state, ...patch };
      publish();
    },
  };
}
