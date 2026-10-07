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
            {current
              ? `${current.participants.length + 1} ${current.participants.length === 0 ? "person" : "people"} here`
              : ""}
          </output>
          <ul id="hosted-participant-list" aria-label="Live collaborators">
            {current ? <li>{current.displayName} (you)</li> : null}
            {current?.participants.map((participant) => (
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
