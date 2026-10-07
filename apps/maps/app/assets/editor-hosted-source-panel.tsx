import { clientEntry, on, type Handle } from "remix/component";
import type { HostedMapLaunch } from "@tea/maps-protocol";
import type { HostedSourceContext } from "./editor-hosted-source-dialog.ts";
import { downloadMapCopy } from "./editor-files.ts";
import {
  clearHostedSourceDraft,
  loadHostedSourceDraft,
  readHostedSource,
  replaceHostedSource,
  saveHostedSourceDraft,
  type HostedSourceBaseline,
} from "./editor-hosted-source.ts";

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

function closeSourceDialog() {
  document.querySelector<HTMLDialogElement>("#hosted-source-dialog")?.close();
}

export const EditorHostedSource = clientEntry(
  `${import.meta.url}#EditorHostedSource`,
  function EditorHostedSourceComponent(handle: Handle) {
    let context: HostedSourceContext | null = null;
    let baseline: HostedSourceBaseline | null = null;
    let draft = "";
    let status = "";
    let busy = false;
    let opening = false;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let saveQueue = Promise.resolve();
    let generation = 0;

    function queueDraftSave(): Promise<void> {
      const current = baseline;
      if (!current) return saveQueue;
      const source = draft;
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

    async function open() {
      const selected = context?.current();
      if (
        opening ||
        !selected ||
        selected.map.role === "viewer" ||
        !selected.connection
      )
        return;
      opening = true;
      const request = ++generation;
      try {
        if (await selected.connection.pending())
          throw new Error("Wait for live brush edits to finish syncing");
        const map = await readHostedSource(selected.map.id);
        if (request !== generation || context?.current()?.map.id !== map.id)
          return;
        if (map.role === "viewer")
          throw new Error("Editor access is required to replace hosted source");
        await saveQueue.catch(() => undefined);
        const saved = await loadHostedSourceDraft(map.id).catch(() => null);
        if (request !== generation || context?.current()?.map.id !== map.id)
          return;
        if (saved && saved.source !== map.source) {
          baseline = saved.baseline;
          draft = saved.source;
          status =
            saved.baseline.sourceSha256 === map.sourceSha256
              ? "Recovered a source draft from this device"
              : "Hosted source changed since this draft began. Download it or discard it before retrying.";
        } else {
          baseline = baselineOf(map);
          draft = map.source;
          status = `Editing hosted version ${map.mapVersion}`;
          if (saved) void clearHostedSourceDraft(map.id);
        }
        handle.update();
        document
          .querySelector<HTMLDialogElement>("#hosted-source-dialog")!
          .showModal();
        document
          .querySelector<HTMLTextAreaElement>("#hosted-source-draft")!
          .focus();
      } catch (cause) {
        context?.status(cause instanceof Error ? cause.message : String(cause));
      } finally {
        opening = false;
        window.dispatchEvent(new Event("tea-maps-hosted-source-availability"));
      }
    }

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-hosted-source-context",
        (event) => {
          const firstContext = context === null;
          context = (event as CustomEvent<HostedSourceContext>).detail;
          if (firstContext)
            window.dispatchEvent(new Event("tea-maps-hosted-source-ready"));
        },
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-hosted-source-open",
        () => void open(),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-hosted-source-close",
        () => {
          generation++;
          closeSourceDialog();
        },
        { signal: handle.signal },
      );
      document.addEventListener(
        "visibilitychange",
        () => {
          if (
            document.visibilityState === "hidden" &&
            document.querySelector<HTMLDialogElement>("#hosted-source-dialog")
              ?.open
          )
            void flushDraft();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-hosted-source-ready"));
    });

    async function save() {
      const current = baseline;
      const hosted = context?.current();
      if (!current || !hosted || hosted.map.id !== current.id || busy) return;
      busy = true;
      handle.update();
      try {
        let draftStored = true;
        try {
          await flushDraft();
        } catch {
          draftStored = false;
        }
        if (!hosted.connection || (await hosted.connection.pending()))
          throw new Error("Wait for live brush edits to finish syncing");
        const result = await replaceHostedSource(current, draft);
        if (result.status === "conflict") {
          status = draftStored
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
        closeSourceDialog();
        context?.saved(result.map.mapVersion);
        if (cleanupFailed)
          context?.status(
            "Hosted source saved; old local draft could not be cleared",
          );
      } catch (cause) {
        status = cause instanceof Error ? cause.message : String(cause);
      } finally {
        busy = false;
        handle.update();
      }
    }

    async function reload() {
      const current = baseline;
      if (!current || busy) return;
      busy = true;
      handle.update();
      try {
        await flushDraft();
        const map = await readHostedSource(current.id);
        if (context?.current()?.map.id !== map.id) return;
        await clearHostedSourceDraft(map.id);
        baseline = baselineOf(map);
        draft = map.source;
        status = `Editing hosted version ${map.mapVersion}`;
      } catch (cause) {
        status = cause instanceof Error ? cause.message : String(cause);
      } finally {
        busy = false;
        handle.update();
      }
    }

    return () => (
      <dialog
        id="hosted-source-dialog"
        aria-labelledby="hosted-source-title"
        mix={[
          on("cancel", (event) => {
            if (busy) event.preventDefault();
          }),
          on("close", () => {
            void flushDraft().catch(() => {
              status = "Could not save this draft on the device";
              handle.update();
            });
            baseline = null;
          }),
        ]}
      >
        <h2 id="hosted-source-title">Edit hosted source</h2>
        <p>
          Saving replaces the hosted map source. Live brush edits must finish
          syncing first. A conflicting version keeps this draft on your device.
        </p>
        <label for="hosted-source-draft">Map source</label>
        <textarea
          id="hosted-source-draft"
          spellCheck={false}
          value={draft}
          mix={on<HTMLTextAreaElement>("input", (event) => {
            draft = event.currentTarget.value;
            handle.update();
            if (saveTimer !== null) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
              saveTimer = null;
              void queueDraftSave().catch(() => {
                status = "Could not save this draft on the device";
                handle.update();
              });
            }, 250);
          })}
        />
        <p id="hosted-source-status" role="status">
          {status}
        </p>
        <div class="hosted-source-actions">
          <button
            id="hosted-source-save"
            type="button"
            disabled={busy}
            mix={on("click", () => void save())}
          >
            Save hosted source
          </button>
          <button
            id="hosted-source-download"
            type="button"
            mix={on("click", () => {
              if (!baseline) return;
              const slug = context?.current()?.map.slug ?? "hosted-map";
              downloadMapCopy(`${slug}.source-draft.map`, draft);
            })}
          >
            Download draft
          </button>
          <button
            id="hosted-source-reload"
            type="button"
            disabled={busy}
            mix={on("click", () => void reload())}
          >
            Discard draft and reload
          </button>
          <button
            id="hosted-source-close"
            type="button"
            disabled={busy}
            mix={on("click", closeSourceDialog)}
          >
            Close
          </button>
        </div>
      </dialog>
    );
  },
);
