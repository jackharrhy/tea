import type { HostedProject } from "@tea/maps-protocol";

export interface EditorHostedResourcesContext {
  readonly project: HostedProject | null;
  readonly resourcesChanged: (projectId: string) => void;
}

export function initEditorHostedResources(options: {
  readonly resourcesChanged: (projectId: string) => void;
}) {
  let project: HostedProject | null = null;
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorHostedResourcesContext>(
        "tea-maps-hosted-resources-state",
        { detail: { project, resourcesChanged: options.resourcesChanged } },
      ),
    );
  }

  window.addEventListener("tea-maps-hosted-resources-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-hosted-resources-bridge-ready"));

  return {
    setProject(next: HostedProject | null) {
      project = next;
      publish();
    },
  };
}
