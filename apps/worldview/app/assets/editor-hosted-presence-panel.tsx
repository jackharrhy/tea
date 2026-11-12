import { clientEntry, on, type Handle } from "remix/component";
import {
  currentHostedPresence,
  hostedShareUrl,
  onHostedPresenceChange,
  reportHostedPresenceStatus,
  requestHostedLocalCopy,
} from "./editor-hosted-presence.ts";

export const EditorHostedPresenceStrip = clientEntry(
  `file:///app/assets/editor-hosted-presence-panel.tsx#EditorHostedPresenceStrip`,
  function EditorHostedPresenceStripComponent(handle: Handle) {
    let state = null as ReturnType<typeof currentHostedPresence>;
    let pickerOpen = false;

    handle.queueTask(() => {
      const picker = document.querySelector<HTMLDetailsElement>(
        "#hosted-editor-picker",
      )!;
      pickerOpen = picker.open;
      picker.addEventListener(
        "toggle",
        () => {
          pickerOpen = picker.open;
          handle.update();
        },
        { signal: handle.signal },
      );
      onHostedPresenceChange(() => {
        state = currentHostedPresence();
        handle.update();
      }, handle.signal);
      state = currentHostedPresence();
      handle.update();
    });

    return () => {
      const connected = state?.connection === "connected";
      const collaborators =
        state?.connection === "connected"
          ? [
              { displayName: state.displayName, color: null },
              ...state.participants.map(({ displayName, color }) => ({
                displayName,
                color,
              })),
            ]
          : [];
      const people = collaborators.length;
      const label = connected
        ? `Live · ${people}`
        : state?.connection === "connecting"
          ? "Connecting"
          : state?.connection === "disconnected"
            ? "Reconnecting"
            : state
              ? "Viewing hosted map"
              : "Hosted maps";
      return (
        <button
          id="hosted-presence-toggle"
          class="hosted-presence-toggle"
          type="button"
          aria-controls="hosted-editor-picker"
          aria-expanded={pickerOpen}
          mix={on("click", () => {
            const picker = document.querySelector<HTMLDetailsElement>(
              "#hosted-editor-picker",
            )!;
            picker.open = !picker.open;
          })}
        >
          <span
            class="hosted-presence-indicator"
            data-connection={state?.connection ?? "local"}
          />
          <span>{label}</span>
          {connected && (
            <span class="hosted-presence-people" aria-hidden="true">
              {collaborators.slice(0, 3).map((person) => (
                <span
                  class="hosted-presence-person"
                  data-color={person.color ?? undefined}
                  title={person.displayName}
                >
                  {person.displayName.charAt(0).toUpperCase()}
                </span>
              ))}
              {people > 3 && <span>+{people - 3}</span>}
            </span>
          )}
        </button>
      );
    };
  },
);

export const EditorHostedPresence = clientEntry(
  `file:///app/assets/editor-hosted-presence-panel.tsx#EditorHostedPresence`,
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
                <li data-color={participant.color ?? undefined}>
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
          {current && (
            <button
              id="hosted-local-copy"
              type="button"
              mix={on("click", requestHostedLocalCopy)}
            >
              Continue as local copy
            </button>
          )}
        </div>
      );
    };
  },
);
