export type SwitchMapChoice = "save" | "discard" | "cancel";

export function initEditorSwitchMapDialog() {
  let ready = false;
  let pending: Promise<SwitchMapChoice> | null = null;
  let resolvePending: ((choice: SwitchMapChoice) => void) | null = null;

  function request() {
    if (ready && pending)
      window.dispatchEvent(new Event("tea-maps-switch-map-request"));
  }

  window.addEventListener("tea-maps-switch-map-ready", () => {
    ready = true;
    request();
  });
  window.addEventListener("tea-maps-switch-map-choice", (event) => {
    const choice = (event as CustomEvent<SwitchMapChoice>).detail;
    resolvePending?.(choice);
    pending = null;
    resolvePending = null;
  });
  window.dispatchEvent(new Event("tea-maps-switch-map-bridge-ready"));

  function ask(): Promise<SwitchMapChoice> {
    if (pending) return pending;
    pending = new Promise<SwitchMapChoice>((resolve) => {
      resolvePending = resolve;
    });
    request();
    return pending;
  }

  return { ask };
}
