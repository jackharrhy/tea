export interface EditorToolSettingsState {
  readonly tool: string;
  readonly toolDisabled: boolean;
  readonly gridSize: number;
  readonly textureLock: boolean;
}

export interface EditorToolSettingsContext {
  readonly state: EditorToolSettingsState;
  readonly selectTool: (tool: string) => void;
  readonly setGridSize: (size: number) => void;
  readonly setTextureLock: (enabled: boolean) => void;
}

export function initEditorToolSettings(actions: {
  readonly selectTool: (tool: string) => void;
  readonly textureLockChanged: () => void;
}) {
  let state: EditorToolSettingsState = {
    tool: "select",
    toolDisabled: true,
    gridSize: 16,
    textureLock: true,
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorToolSettingsContext>(
        "tea-maps-tool-settings-state",
        {
          detail: {
            state,
            selectTool: actions.selectTool,
            setGridSize,
            setTextureLock,
          },
        },
      ),
    );
  }

  function update(patch: Partial<EditorToolSettingsState>) {
    state = { ...state, ...patch };
    publish();
  }

  function setGridSize(size: number) {
    if (![1, 2, 4, 8, 16, 32, 64, 128, 256].includes(size)) return;
    update({ gridSize: size });
  }

  function setTextureLock(enabled: boolean) {
    update({ textureLock: enabled });
    actions.textureLockChanged();
  }

  window.addEventListener("tea-maps-tool-settings-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-tool-settings-bridge-ready"));

  return {
    get state() {
      return state;
    },
    update,
  };
}
