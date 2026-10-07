import { clientEntry, on, type Handle } from "remix/component";
import {
  IndexedDbCollaborationOutbox,
  type DetachedHostedMap,
} from "./editor-collaboration.ts";
import type { DetachedMapsContext } from "./editor-hosted.ts";

export const EditorDetachedMaps = clientEntry(
  `${import.meta.url}#EditorDetachedMaps`,
  function EditorDetachedMapsComponent(handle: Handle) {
    let context: DetachedMapsContext | null = null;
    let copies: readonly DetachedHostedMap[] = [];
    let selectedId = "";
    let status = "";
    let busy = false;
    let revision = 0;
    const outbox = new IndexedDbCollaborationOutbox();

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-detached-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-detached-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-detached-state",
        (event) => {
          context = (event as CustomEvent<DetachedMapsContext>).detail;
          void refresh();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-detached-ready"));
    });

    async function refresh() {
      const request = ++revision;
      try {
        const next = await outbox.listDetached();
        if (request !== revision || handle.signal.aborted) return;
        copies = next;
        if (!copies.some((copy) => copy.id === selectedId))
          selectedId = copies[0]?.id ?? "";
        status = "";
      } catch {
        if (request !== revision || handle.signal.aborted) return;
        status = "Local recovery copies are unavailable";
      }
      handle.update();
    }

    async function openSelected() {
      if (!context || !selectedId || busy) return;
      busy = true;
      handle.update();
      try {
        const copy = await outbox.loadDetached(selectedId);
        if (copy) await context.openDetached(copy);
        else await refresh();
      } catch (cause) {
        status = cause instanceof Error ? cause.message : String(cause);
      } finally {
        busy = false;
        if (!handle.signal.aborted) handle.update();
      }
    }

    return () => (
      <div class="detached-editor-controls">
        <label for="detached-editor-map">Recovery copies</label>
        <select
          id="detached-editor-map"
          disabled={!copies.length || busy}
          mix={on<HTMLSelectElement>("change", (event) => {
            selectedId = event.currentTarget.value;
          })}
        >
          {copies.map((copy) => (
            <option value={copy.id} selected={copy.id === selectedId}>
              {copy.fileName} · {new Date(copy.createdAt).toLocaleString()}
            </option>
          ))}
        </select>
        <button
          id="detached-editor-open"
          type="button"
          disabled={!copies.length || busy || !context}
          mix={on("click", () => void openSelected())}
        >
          Open recovery copy
        </button>
        {status && <output role="status">{status}</output>}
      </div>
    );
  },
);
