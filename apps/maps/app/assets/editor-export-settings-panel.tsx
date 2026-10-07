import { clientEntry, css, on, type Handle } from "remix/component";
import { defaultExportSettings } from "./editor-export-settings.ts";
import type { ExportSettingsPanelContext } from "./editor-export-settings-bridge.ts";

const initialSettings = defaultExportSettings("default");

export const EditorExportSettings = clientEntry(
  `${import.meta.url}#EditorExportSettings`,
  function EditorExportSettingsComponent(handle: Handle) {
    let context: ExportSettingsPanelContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-export-settings-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-export-settings-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-export-settings-state",
        (event) => {
          context = (event as CustomEvent<ExportSettingsPanelContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-export-settings-ready"));
    });

    return () => {
      const settings = context?.settings ?? initialSettings;
      return (
        <div mix={css({ display: "contents" })}>
          <label for="include-build-source">
            <input
              id="include-build-source"
              type="checkbox"
              checked={settings.includeSource}
              disabled={!context}
              mix={on<HTMLInputElement>("change", (event) => {
                context?.configure({
                  includeSource: event.currentTarget.checked,
                });
              })}
            />{" "}
            Include source
          </label>
          <label for="export-after-build">
            <input
              id="export-after-build"
              type="checkbox"
              checked={settings.afterBuild}
              disabled={!context}
              mix={on<HTMLInputElement>("change", (event) => {
                context?.configure({ afterBuild: event.currentTarget.checked });
              })}
            />{" "}
            Export after build
          </label>
          <span id="export-destination">
            Destination: {settings.directory?.name ?? "Downloads"}
          </span>
          <button
            id="choose-export-directory"
            type="button"
            hidden={!context?.directorySupported}
            disabled={!context?.directorySupported}
            mix={on("click", () => void context?.chooseDirectory())}
          >
            Choose export folder
          </button>
          <button
            id="use-export-downloads"
            type="button"
            hidden={!settings.directory}
            mix={on("click", () => context?.configure({ directory: null }))}
          >
            Use Downloads
          </button>
          <span class="hint">
            Folder exports replace a file with the same map name.
          </span>
        </div>
      );
    };
  },
);
