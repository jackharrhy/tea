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
  readonly exportStatus: string;
  readonly previewDisabled: boolean;
  readonly previewLabel: string;
  readonly leakDisabled: boolean;
  readonly leakActive: boolean;
  readonly portalDisabled: boolean;
  readonly portalActive: boolean;
  readonly launchDisabled: boolean;
  readonly buildStatus: string;
  readonly buildOutput: string;
  readonly buildLogVisible: boolean;
}

export interface EditorBuildControlActions {
  readonly selectGame: (game: string) => void;
  readonly selectProfile: (id: string) => void;
  readonly build: () => void;
  readonly buildExportOnce: () => void;
  readonly exportLatest: () => void;
  readonly togglePreview: () => void;
  readonly toggleLeak: () => void;
  readonly togglePortals: () => void;
  readonly launch: () => void;
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
    exportStatus: "",
    previewDisabled: true,
    previewLabel: "Show compiled",
    leakDisabled: true,
    leakActive: false,
    portalDisabled: true,
    portalActive: false,
    launchDisabled: true,
    buildStatus: "",
    buildOutput: "",
    buildLogVisible: false,
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

  function update(patch: Partial<EditorBuildControlState>) {
    state = { ...state, ...patch };
    publish();
  }

  return {
    get state() {
      return state;
    },
    update,
    get exportStatus() {
      return state.exportStatus;
    },
    set exportStatus(value: string) {
      update({ exportStatus: value });
    },
    get buildStatus() {
      return state.buildStatus;
    },
    set buildStatus(value: string) {
      update({ buildStatus: value });
    },
    get buildOutput() {
      return state.buildOutput;
    },
    set buildOutput(value: string) {
      update({ buildOutput: value });
    },
    get buildLogHidden() {
      return !state.buildLogVisible;
    },
    set buildLogHidden(value: boolean) {
      update({ buildLogVisible: !value });
    },
  };
}
