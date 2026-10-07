import { clientEntry, css, on, type Handle } from "remix/component";
import type { EditorBuildControlsContext } from "./editor-build-controls-bridge.ts";

export const EditorBuildControls = clientEntry(
  `${import.meta.url}#EditorBuildControls`,
  function EditorBuildControlsComponent(handle: Handle) {
    let context: EditorBuildControlsContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-build-controls-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-build-controls-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-build-controls-state",
        (event) => {
          context = (event as CustomEvent<EditorBuildControlsContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-build-controls-ready"));
    });

    return () => {
      const state = context?.state;
      return (
        <div mix={css({ display: "contents" })}>
          <label for="game-profile">Game</label>
          <select
            id="game-profile"
            value={state?.game ?? "quake"}
            disabled={!context || state?.gameDisabled}
            mix={on<HTMLSelectElement>("change", (event) =>
              context?.actions.selectGame(event.currentTarget.value),
            )}
          >
            <option value="quake">Quake</option>
            <option value="goldsrc">GoldSrc</option>
            <option value="quake2">Quake II</option>
            <option value="gower">Gower Complex</option>
          </select>
          <label for="build-profile">Build profile</label>
          <select
            id="build-profile"
            value={state?.profileId ?? "preview"}
            disabled={!context || state?.profileDisabled}
            mix={on<HTMLSelectElement>("change", (event) =>
              context?.actions.selectProfile(event.currentTarget.value),
            )}
          >
            {(state?.profiles ?? [{ id: "preview", label: "Preview" }]).map(
              (profile) => (
                <option value={profile.id}>{profile.label}</option>
              ),
            )}
          </select>
          <button
            id="build-map"
            type="button"
            disabled={!context || state?.buildDisabled}
            mix={on("click", () => context?.actions.build())}
          >
            {state?.buildLabel ?? "Build BSP"}
          </button>
          <button
            id="build-export-once"
            type="button"
            disabled={!context || state?.buildExportOnceDisabled}
            mix={on("click", () => context?.actions.buildExportOnce())}
          >
            Build &amp; export
          </button>
          <button
            id="export-build"
            type="button"
            disabled={!context || state?.exportDisabled}
            mix={on("click", () => context?.actions.exportLatest())}
          >
            Export build
          </button>
          <button
            id="toggle-compiled"
            type="button"
            disabled={!context || state?.previewDisabled}
            mix={on("click", () => context?.actions.togglePreview())}
          >
            {state?.previewLabel ?? "Show compiled"}
          </button>
        </div>
      );
    };
  },
);
