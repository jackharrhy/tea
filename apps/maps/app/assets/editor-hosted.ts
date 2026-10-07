import type { HostedMapLaunch, HostedProject } from "@tea/maps-protocol";
import { initHostedAccess } from "./editor-hosted-access.ts";
import { initEditorHostedResources } from "./editor-hosted-resources-bridge.ts";
import type { DetachedHostedMap } from "./editor-collaboration.ts";

export interface DetachedMapsContext {
  readonly openDetached: (copy: DetachedHostedMap) => Promise<boolean>;
}

export interface HostedPickerContext {
  readonly open: (map: HostedMapLaunch) => Promise<boolean>;
  readonly compare: (map: HostedMapLaunch) => void;
  readonly makeCopy: () => Promise<void>;
  readonly setProject: (project: HostedProject | null) => void;
  readonly viewingHosted: boolean;
}

export function initHostedEditor(options: {
  open(map: HostedMapLaunch): Promise<boolean>;
  compare(map: HostedMapLaunch): void;
  makeCopy(): Promise<void>;
  openDetached(copy: DetachedHostedMap): Promise<boolean>;
  resourcesChanged(projectId: string): void;
}): { setViewingHosted(value: boolean): void } {
  const picker = document.querySelector<HTMLDetailsElement>(
    "#hosted-editor-picker",
  )!;
  const access = initHostedAccess();
  const resources = initEditorHostedResources({
    resourcesChanged: options.resourcesChanged,
  });
  let viewingHosted = false;
  let pickerReady = false;
  let detachedReady = false;

  function publishPicker() {
    if (!pickerReady) return;
    window.dispatchEvent(
      new CustomEvent<HostedPickerContext>("tea-maps-hosted-picker-state", {
        detail: {
          open: options.open,
          compare: options.compare,
          makeCopy: options.makeCopy,
          setProject(project) {
            access.setProject(project);
            resources.setProject(project);
          },
          viewingHosted,
        },
      }),
    );
  }

  function publishDetached() {
    if (!detachedReady) return;
    window.dispatchEvent(
      new CustomEvent<DetachedMapsContext>("tea-maps-detached-state", {
        detail: { openDetached: options.openDetached },
      }),
    );
  }

  window.addEventListener("tea-maps-hosted-picker-ready", () => {
    pickerReady = true;
    publishPicker();
  });
  window.addEventListener("tea-maps-detached-ready", () => {
    detachedReady = true;
    publishDetached();
  });
  window.dispatchEvent(new Event("tea-maps-hosted-picker-bridge-ready"));
  window.dispatchEvent(new Event("tea-maps-detached-bridge-ready"));

  const query = new URL(location.href).searchParams;
  if (query.has("hostedMap") || query.has("hostedProject")) picker.open = true;

  return {
    setViewingHosted(value) {
      viewingHosted = value;
      if (value) picker.open = true;
      publishPicker();
      publishDetached();
    },
  };
}
