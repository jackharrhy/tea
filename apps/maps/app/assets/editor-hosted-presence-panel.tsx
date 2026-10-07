import { clientEntry, on, type Handle } from "remix/component";
import {
  currentHostedPresence,
  hostedShareUrl,
  onHostedPresenceChange,
  reportHostedPresenceStatus,
} from "./editor-hosted-presence.ts";

export const EditorHostedPresence = clientEntry(
  `${import.meta.url}#EditorHostedPresence`,
  function EditorHostedPresenceComponent(handle: Handle) {
    let state = null as ReturnType<typeof currentHostedPresence>;

    handle.queueTask(() => {
      onHostedPresenceChange(() => {
        state = currentHostedPresence();
        handle.update();
      }, handle.signal);
      state = currentHostedPresence();
      handle.update();
    });

    async function copyLink() {
      if (!state) return;
      try {
        await navigator.clipboard.writeText(
          hostedShareUrl(state.mapId, location.origin),
        );
        reportHostedPresenceStatus("Hosted map link copied");
      } catch {
        const input =
          document.querySelector<HTMLInputElement>("#hosted-share-link")!;
        input.focus();
        input.select();
        reportHostedPresenceStatus("Select the share link to copy it");
      }
    }

    return () => {
      const current = state;
      const connected = current?.connection === "connected";
      return (
        <div class="hosted-presence-panel">
          <div id="hosted-share" class="hosted-share" hidden={!current}>
            <label for="hosted-share-link">Share link</label>
            <input
              id="hosted-share-link"
              type="url"
              value={
                current ? hostedShareUrl(current.mapId, location.origin) : ""
              }
              readOnly
            />
            <button
              id="hosted-copy-link"
              type="button"
              disabled={!current}
              mix={on("click", () => void copyLink())}
            >
              Copy link
            </button>
          </div>
          <output id="hosted-participants" aria-live="polite">
            {connected
              ? `${current.participants.length + 1} ${current.participants.length === 0 ? "person" : "people"} here`
              : current?.connection === "connecting"
                ? "Connecting to live room…"
                : current?.connection === "disconnected"
                  ? "Reconnecting to live room…"
                  : current
                    ? "Viewing hosted map"
                    : ""}
          </output>
          <ul id="hosted-participant-list" aria-label="Live collaborators">
            {connected ? <li>{current.displayName} (you)</li> : null}
            {connected &&
              current.participants.map((participant) => (
                <li>
                  {[
                    participant.displayName,
                    participant.viewport,
                    participant.selectedCount
                      ? `${participant.selectedCount} selected`
                      : "No selection",
                    ...(participant.editing ? ["Editing"] : []),
                  ].join(" · ")}
                </li>
              ))}
          </ul>
        </div>
      );
    };
  },
);
