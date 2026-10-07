import type { HostedMapLaunch } from "@tea/maps-protocol";
import type { HostedEditorConnection } from "./editor-hosted-collaboration.ts";

export interface HostedSourceContext {
  readonly canOpen: boolean;
  readonly open: () => void;
  readonly current: () => {
    readonly map: HostedMapLaunch;
    readonly connection: HostedEditorConnection | null;
  } | null;
  readonly saved: (mapVersion: number) => void;
  readonly status: (message: string) => void;
}

export function initHostedSourceDialog(
  options: Omit<HostedSourceContext, "canOpen" | "open">,
) {
  let ready = false;
  let canOpen = false;

  function setAvailability() {
    const current = options.current();
    canOpen = !!(
      ready &&
      current &&
      current.map.role !== "viewer" &&
      current.connection
    );
    publish();
  }

  window.addEventListener("tea-maps-hosted-source-ready", () => {
    ready = true;
    setAvailability();
  });
  function publish() {
    window.dispatchEvent(
      new CustomEvent<HostedSourceContext>("tea-maps-hosted-source-context", {
        detail: { ...options, canOpen, open },
      }),
    );
  }
  function open() {
    if (canOpen) window.dispatchEvent(new Event("tea-maps-hosted-source-open"));
  }
  window.addEventListener(
    "tea-maps-hosted-source-availability",
    setAvailability,
  );
  window.addEventListener("tea-maps-hosted-source-button-ready", publish);
  window.dispatchEvent(new Event("tea-maps-hosted-source-bridge-ready"));
  publish();

  return {
    setAvailability,
    close() {
      if (ready)
        window.dispatchEvent(new Event("tea-maps-hosted-source-close"));
    },
  };
}
