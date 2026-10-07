import { clientEntry, type Handle } from "remix/component";
import {
  listDetachedMapSummaries,
  type DetachedMapSummary,
} from "./editor-detached-catalog.ts";

export const RecoveredMaps = clientEntry(
  `${import.meta.url}#RecoveredMaps`,
  function RecoveredMapsComponent(handle: Handle) {
    let copies: readonly DetachedMapSummary[] | null = null;
    let error: string | null = null;

    handle.queueTask(() => {
      void listDetachedMapSummaries()
        .then((value) => {
          copies = value;
          handle.update();
        })
        .catch((cause: unknown) => {
          error = cause instanceof Error ? cause.message : String(cause);
          handle.update();
        });
    });

    return () => (
      <div id="detached-maps-list" class="project-list">
        {error
          ? `Recovered maps are unavailable: ${error}`
          : copies === null
            ? "Loading recovered maps…"
            : copies.length === 0
              ? "No recovered maps on this device"
              : copies.map((copy) => (
                  <div class="project-row">
                    <strong>{copy.name}</strong>
                    <small>{copy.reason}</small>
                    <a
                      href={`/editor?detachedMap=${encodeURIComponent(copy.id)}`}
                      data-rmx-document
                    >
                      Open copy · {new Date(copy.createdAt).toLocaleString()}
                    </a>
                  </div>
                ))}
      </div>
    );
  },
);
