import {
  defaultExportSettings,
  directoryExportSupported,
  type ExportSettings,
} from "./editor-export-settings.ts";

export interface ExportSettingsPanelContext {
  readonly settings: ExportSettings;
  readonly directorySupported: boolean;
  readonly configure: (
    update: Partial<
      Pick<ExportSettings, "includeSource" | "afterBuild" | "directory">
    >,
  ) => void;
  readonly chooseDirectory: () => Promise<void>;
}

export function initEditorExportSettingsPanel(options: {
  readonly configure: ExportSettingsPanelContext["configure"];
  readonly chooseDirectory: ExportSettingsPanelContext["chooseDirectory"];
}) {
  let settings = defaultExportSettings("default");
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<ExportSettingsPanelContext>(
        "tea-maps-export-settings-state",
        {
          detail: {
            settings,
            directorySupported: directoryExportSupported(),
            configure: options.configure,
            chooseDirectory: options.chooseDirectory,
          },
        },
      ),
    );
  }

  window.addEventListener("tea-maps-export-settings-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-export-settings-bridge-ready"));

  return {
    setSettings(next: ExportSettings) {
      settings = next;
      publish();
    },
  };
}
