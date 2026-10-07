import type { HostedMapLaunch } from "@tea/maps-protocol";
import type { HostedEditorConnection } from "./editor-hosted-collaboration.ts";
import { downloadMapCopy } from "./editor-files.ts";
import {
  clearHostedSourceDraft,
  loadHostedSourceDraft,
  readHostedSource,
  replaceHostedSource,
  saveHostedSourceDraft,
  type HostedSourceBaseline,
} from "./editor-hosted-source.ts";

interface CurrentHostedMap {
  readonly map: HostedMapLaunch;
  readonly connection: HostedEditorConnection | null;
}

function baselineOf(map: HostedMapLaunch): HostedSourceBaseline {
  return {
    id: map.id,
    projectId: map.projectId,
    format: map.format,
    mapVersion: map.mapVersion,
    sourceSha256: map.sourceSha256,
    source: map.source,
  };
}

export function initHostedSourceDialog(options: {
  current(): CurrentHostedMap | null;
  saved(mapVersion: number): void;
  status(message: string): void;
}) {
  const openButton = document.querySelector<HTMLButtonElement>(
    "#hosted-source-open",
  )!;
  const dialog = document.querySelector<HTMLDialogElement>(
    "#hosted-source-dialog",
  )!;
  const draftInput = document.querySelector<HTMLTextAreaElement>(
    "#hosted-source-draft",
  )!;
  const status = document.querySelector<HTMLElement>("#hosted-source-status")!;
  const saveButton = document.querySelector<HTMLButtonElement>(
    "#hosted-source-save",
  )!;
  const downloadButton = document.querySelector<HTMLButtonElement>(
    "#hosted-source-download",
  )!;
  const reloadButton = document.querySelector<HTMLButtonElement>(
    "#hosted-source-reload",
  )!;
  const closeButton = document.querySelector<HTMLButtonElement>(
    "#hosted-source-close",
  )!;
  let baseline: HostedSourceBaseline | null = null;
  let busy = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveQueue = Promise.resolve();

  function queueDraftSave(): Promise<void> {
    const current = baseline;
    if (!current) return saveQueue;
    const source = draftInput.value;
    saveQueue = saveQueue
      .catch(() => undefined)
      .then(() =>
        source === current.source
          ? clearHostedSourceDraft(current.id)
          : saveHostedSourceDraft({
              mapId: current.id,
              baseline: current,
              source,
              updatedAt: Date.now(),
            }),
      );
    return saveQueue;
  }

  function flushDraft(): Promise<void> {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = null;
    return queueDraftSave();
  }

  function setBusy(value: boolean) {
    busy = value;
    saveButton.disabled = value;
    reloadButton.disabled = value;
    closeButton.disabled = value;
  }

  async function open() {
    const selected = options.current();
    if (!selected || selected.map.role === "viewer" || !selected.connection)
      return;
    openButton.disabled = true;
    try {
      if (await selected.connection.pending()) {
        throw new Error("Wait for live brush edits to finish syncing");
      }
      const map = await readHostedSource(selected.map.id);
      if (options.current()?.map.id !== map.id) return;
      if (map.role === "viewer") {
        throw new Error("Editor access is required to replace hosted source");
      }
      await saveQueue.catch(() => undefined);
      const saved = await loadHostedSourceDraft(map.id).catch(() => null);
      if (saved && saved.source !== map.source) {
        baseline = saved.baseline;
        draftInput.value = saved.source;
        status.textContent =
          saved.baseline.sourceSha256 === map.sourceSha256
            ? "Recovered a source draft from this device"
            : "Hosted source changed since this draft began. Download it or discard it before retrying.";
      } else {
        baseline = baselineOf(map);
        draftInput.value = map.source;
        status.textContent = `Editing hosted version ${map.mapVersion}`;
        if (saved) void clearHostedSourceDraft(map.id);
      }
      dialog.showModal();
      draftInput.focus();
    } catch (error) {
      options.status(error instanceof Error ? error.message : String(error));
    } finally {
      const current = options.current();
      openButton.disabled =
        !current || current.map.role === "viewer" || !current.connection;
    }
  }

  openButton.addEventListener("click", () => void open());
  draftInput.addEventListener("input", () => {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void queueDraftSave().catch(() => {
        status.textContent = "Could not save this draft on the device";
      });
    }, 250);
  });
  saveButton.addEventListener("click", async () => {
    const current = baseline;
    const hosted = options.current();
    if (!current || !hosted || hosted.map.id !== current.id || busy) return;
    setBusy(true);
    try {
      let draftStored = true;
      try {
        await flushDraft();
      } catch {
        draftStored = false;
      }
      if (!hosted.connection || (await hosted.connection.pending())) {
        throw new Error("Wait for live brush edits to finish syncing");
      }
      const result = await replaceHostedSource(current, draftInput.value);
      if (result.status === "conflict") {
        status.textContent = draftStored
          ? `Hosted map changed to version ${result.mapVersion}. Your draft is saved on this device.`
          : `Hosted map changed to version ${result.mapVersion}. Download your draft; device storage is unavailable.`;
        return;
      }
      let cleanupFailed = false;
      try {
        await saveQueue;
        await clearHostedSourceDraft(current.id);
      } catch {
        cleanupFailed = true;
      }
      baseline = null;
      dialog.close();
      options.saved(result.map.mapVersion);
      if (cleanupFailed)
        options.status(
          "Hosted source saved; old local draft could not be cleared",
        );
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      setBusy(false);
    }
  });
  downloadButton.addEventListener("click", () => {
    const current = baseline;
    if (!current) return;
    const slug = options.current()?.map.slug ?? "hosted-map";
    downloadMapCopy(`${slug}.source-draft.map`, draftInput.value);
  });
  reloadButton.addEventListener("click", async () => {
    const current = baseline;
    if (!current || busy) return;
    setBusy(true);
    try {
      await flushDraft();
      const map = await readHostedSource(current.id);
      if (options.current()?.map.id !== map.id) return;
      await clearHostedSourceDraft(map.id);
      baseline = baselineOf(map);
      draftInput.value = map.source;
      status.textContent = `Editing hosted version ${map.mapVersion}`;
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      setBusy(false);
    }
  });
  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });
  dialog.addEventListener("close", () => {
    void flushDraft().catch(() => {
      status.textContent = "Could not save this draft on the device";
    });
    baseline = null;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && dialog.open) void flushDraft();
  });

  return {
    setAvailability() {
      const current = options.current();
      openButton.disabled =
        !current || current.map.role === "viewer" || !current.connection;
    },
    close() {
      if (dialog.open) dialog.close();
    },
  };
}
