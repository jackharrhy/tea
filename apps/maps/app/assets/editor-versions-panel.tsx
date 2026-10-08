import { clientEntry, on, type Handle } from "remix/component";
import {
  listEditorVersions,
  setEditorVersionProtected,
  type EditorVersion,
} from "./editor-draft.ts";
import { listHostedCheckpoints } from "./editor-hosted-checkpoints.ts";

export type VersionsRestoreRequest =
  | {
      readonly kind: "local";
      readonly version: EditorVersion;
      readonly resolve: () => void;
      readonly reject: (cause: unknown) => void;
    }
  | {
      readonly kind: "hosted";
      readonly mapId: string;
      readonly checkpointId: string;
      readonly resolve: () => void;
      readonly reject: (cause: unknown) => void;
    };

export type VersionsRefreshRequest = { readonly mapId: string | null };

type RestoreChoice =
  | { readonly kind: "local"; readonly version: EditorVersion }
  | {
      readonly kind: "hosted";
      readonly mapId: string;
      readonly checkpointId: string;
    };

export const EditorVersions = clientEntry(
  `file:///app/assets/editor-versions-panel.tsx#EditorVersions`,
  function EditorVersionsComponent(handle: Handle) {
    let mapId: string | null = null;
    let localVersions: readonly EditorVersion[] = [];
    let hostedVersions: Awaited<ReturnType<typeof listHostedCheckpoints>> = [];
    let status = "";
    let busy = false;
    let generation = 0;

    async function refresh(nextMapId: string | null) {
      const currentGeneration = ++generation;
      mapId = nextMapId;
      localVersions = [];
      hostedVersions = [];
      status = "Loading recovery versions…";
      handle.update();
      try {
        const hosted = nextMapId
          ? await listHostedCheckpoints(nextMapId)
          : null;
        const local = nextMapId ? null : await listEditorVersions();
        if (currentGeneration !== generation || handle.signal.aborted) return;
        hostedVersions = hosted ?? [];
        localVersions = local ?? [];
        status = nextMapId
          ? hostedVersions.length
            ? "Restoring opens a detached local copy; the hosted map stays unchanged."
            : "No hosted checkpoints for this map yet"
          : localVersions.length
            ? ""
            : "No recovery versions on this device yet";
      } catch (cause) {
        if (currentGeneration !== generation || handle.signal.aborted) return;
        status = cause instanceof Error ? cause.message : String(cause);
      }
      handle.update();
    }

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-versions-refresh",
        (event) => {
          void refresh(
            (event as CustomEvent<VersionsRefreshRequest>).detail.mapId,
          );
        },
        { signal: handle.signal },
      );
    });

    async function restore(request: RestoreChoice) {
      if (busy) return;
      busy = true;
      status = "Opening recovery copy…";
      handle.update();
      try {
        await new Promise<void>((resolve, reject) => {
          const handled = !window.dispatchEvent(
            new CustomEvent<VersionsRestoreRequest>(
              "tea-maps-versions-restore",
              {
                cancelable: true,
                detail: {
                  ...request,
                  resolve,
                  reject,
                } as VersionsRestoreRequest,
              },
            ),
          );
          if (!handled) reject(new Error("The map editor is still starting"));
        });
        if (document.querySelector<HTMLDialogElement>("#versions-dialog")?.open)
          status = "Restore cancelled";
      } catch (cause) {
        status = cause instanceof Error ? cause.message : String(cause);
      } finally {
        busy = false;
        handle.update();
      }
    }

    async function protect(version: EditorVersion) {
      if (busy) return;
      busy = true;
      handle.update();
      try {
        await setEditorVersionProtected(version.id, !version.protected);
        await refresh(null);
      } catch (cause) {
        status = cause instanceof Error ? cause.message : String(cause);
      } finally {
        busy = false;
        handle.update();
      }
    }

    return () => (
      <dialog id="versions-dialog" aria-labelledby="versions-title">
        <h2 id="versions-title">Recovery versions</h2>
        <p>
          Local restores open a copy to save to a file. Hosted checkpoints
          record map versions.
        </p>
        <div id="versions-list">
          {mapId
            ? hostedVersions.map((checkpoint) => (
                <div class="version-row">
                  <span>
                    {checkpoint.name} · hosted v{checkpoint.mapVersion} ·{" "}
                    {new Date(checkpoint.createdAt).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    mix={on(
                      "click",
                      () =>
                        void restore({
                          kind: "hosted",
                          mapId: mapId!,
                          checkpointId: checkpoint.id,
                        }),
                    )}
                  >
                    Restore copy
                  </button>
                </div>
              ))
            : localVersions.map((version) => (
                <div class="version-row">
                  <span>
                    {version.protected ? "★ " : ""}
                    {version.fileName} · {version.label} ·{" "}
                    {new Date(version.createdAt).toLocaleString()}
                  </span>
                  <div class="version-actions">
                    <button
                      type="button"
                      disabled={busy}
                      mix={on(
                        "click",
                        () => void restore({ kind: "local", version }),
                      )}
                    >
                      Restore copy
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      mix={on("click", () => void protect(version))}
                    >
                      {version.protected ? "Unprotect" : "Protect"}
                    </button>
                  </div>
                </div>
              ))}
        </div>
        <p id="versions-status" role="status">
          {status}
        </p>
        <button
          id="close-versions"
          type="button"
          mix={on("click", () =>
            document
              .querySelector<HTMLDialogElement>("#versions-dialog")!
              .close(),
          )}
        >
          Close
        </button>
      </dialog>
    );
  },
);
