import type { HostedMapLaunch } from "@tea/maps-protocol";
import type { HostedEditorConnection } from "./editor-hosted-collaboration.ts";

export interface HostedSourceContext {
  readonly current: () => {
    readonly map: HostedMapLaunch;
    readonly connection: HostedEditorConnection | null;
  } | null;
  readonly saved: (mapVersion: number) => void;
  readonly status: (message: string) => void;
}

export function initHostedSourceDialog(options: HostedSourceContext) {
  const openButton = document.querySelector<HTMLButtonElement>(
    "#hosted-source-open",
  )!;
  let ready = false;

  function setAvailability() {
    const current = options.current();
    openButton.disabled =
      !ready ||
      !current ||
      current.map.role === "viewer" ||
      !current.connection;
  }

  window.addEventListener("tea-maps-hosted-source-ready", () => {
    ready = true;
    publish();
    setAvailability();
  });
  function publish() {
    window.dispatchEvent(
      new CustomEvent<HostedSourceContext>("tea-maps-hosted-source-context", {
        detail: options,
      }),
    );
  }
  window.addEventListener(
    "tea-maps-hosted-source-availability",
    setAvailability,
  );
  openButton.addEventListener("click", () => {
    if (ready) window.dispatchEvent(new Event("tea-maps-hosted-source-open"));
  });
  publish();

  return {
    setAvailability,
    close() {
      if (ready)
        window.dispatchEvent(new Event("tea-maps-hosted-source-close"));
    },
  };
}
