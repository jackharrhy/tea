import { clientEntry, on, ref, type Handle } from "remix/component";
import type { SwitchMapChoice } from "./editor-switch-map-bridge.ts";

export const EditorSwitchMapDialog = clientEntry(
  `file:///app/assets/editor-switch-map-panel.tsx#EditorSwitchMapDialog`,
  function EditorSwitchMapDialogComponent(handle: Handle) {
    let dialog: HTMLDialogElement | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-switch-map-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-switch-map-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-switch-map-request",
        () => {
          if (dialog && !dialog.open) {
            dialog.returnValue = "cancel";
            dialog.showModal();
          }
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-switch-map-ready"));
    });

    return () => (
      <dialog
        id="switch-map-dialog"
        aria-labelledby="switch-map-title"
        mix={[
          ref<HTMLDialogElement>((node) => {
            dialog = node;
          }),
          on<HTMLDialogElement>("close", (event) => {
            const value = event.currentTarget.returnValue;
            const choice: SwitchMapChoice =
              value === "save" || value === "discard" ? value : "cancel";
            window.dispatchEvent(
              new CustomEvent<SwitchMapChoice>("tea-maps-switch-map-choice", {
                detail: choice,
              }),
            );
          }),
        ]}
      >
        <h2 id="switch-map-title">Save this map?</h2>
        <p>Choose what to do with changes before opening another map.</p>
        <form method="dialog">
          <button value="save">Save</button>
          <button value="discard">Discard</button>
          <button value="cancel">Cancel</button>
        </form>
      </dialog>
    );
  },
);
