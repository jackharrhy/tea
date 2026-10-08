import { clientEntry, css, on, type Handle } from "remix/component";
import { supportsMapOpenPicker } from "./editor-files.ts";
import type { EditorDocumentControlsContext } from "./editor-document-controls-bridge.ts";

export const EditorDocumentControls = clientEntry(
  `file:///app/assets/editor-document-controls-panel.tsx#EditorDocumentControls`,
  function EditorDocumentControlsComponent(handle: Handle) {
    let context: EditorDocumentControlsContext | null = null;
    let checkpointLabel = "";
    let checkpointBusy = false;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-document-controls-bridge-ready",
        () =>
          window.dispatchEvent(new Event("tea-maps-document-controls-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-document-controls-state",
        (event) => {
          context = (event as CustomEvent<EditorDocumentControlsContext>)
            .detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-document-controls-ready"));
    });

    async function createCheckpoint() {
      if (!context || checkpointBusy) return;
      checkpointBusy = true;
      handle.update();
      try {
        if (await context.actions.checkpoint(checkpointLabel))
          checkpointLabel = "";
      } finally {
        checkpointBusy = false;
        handle.update();
      }
    }

    return () => (
      <div mix={css({ display: "contents" })}>
        <button
          id="new-map"
          type="button"
          disabled={!context}
          mix={on("click", () => void context?.actions.newMap())}
        >
          New map
        </button>
        <button
          id="example-map"
          type="button"
          disabled={!context}
          mix={on("click", () => void context?.actions.exampleMap())}
        >
          Example scene
        </button>
        <button
          id="open-map-button"
          type="button"
          disabled={!context}
          mix={on("click", () => {
            if (supportsMapOpenPicker()) void context?.actions.openPicker();
            else document.querySelector<HTMLInputElement>("#open-map")?.click();
          })}
        >
          Open .map
        </button>
        <input
          id="open-map"
          type="file"
          accept=".map,text/plain"
          mix={on<HTMLInputElement>("change", (event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            input.value = "";
            if (file) void context?.actions.openFile(file);
          })}
        />
        <button
          id="open-project"
          type="button"
          disabled={!context}
          mix={on("click", () => void context?.actions.openProject())}
        >
          Open project
        </button>
        <button
          id="save-map"
          type="button"
          disabled={!context || context.state.saveDisabled}
          mix={on("click", () => void context?.actions.save())}
        >
          Save .map
        </button>
        <button
          id="export-normalized"
          type="button"
          disabled={!context}
          mix={on("click", () => context?.actions.exportNormalized())}
        >
          Export normalized
        </button>
        <label for="checkpoint-label">Checkpoint label</label>
        <input
          id="checkpoint-label"
          type="text"
          placeholder="Optional"
          value={checkpointLabel}
          mix={on<HTMLInputElement>("input", (event) => {
            checkpointLabel = event.currentTarget.value;
          })}
        />
        <button
          id="create-checkpoint"
          type="button"
          disabled={
            !context || context.state.checkpointDisabled || checkpointBusy
          }
          mix={on("click", () => void createCheckpoint())}
        >
          Save checkpoint
        </button>
        <button
          id="show-versions"
          type="button"
          disabled={!context}
          mix={on("click", () => void context?.actions.showVersions())}
        >
          Recovery versions
        </button>
        <button
          id="download-map"
          type="button"
          disabled={!context}
          mix={on("click", () => context?.actions.download())}
        >
          {context?.state.downloadLabel ?? "Download .map"}
        </button>
      </div>
    );
  },
);
