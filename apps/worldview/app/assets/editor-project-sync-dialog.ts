import type { MapProject } from "./editor-project.ts";

export interface ProjectSyncContext {
  readonly project: MapProject | null;
  readonly ready: boolean;
  readonly open: () => void;
  readonly linked: (project: MapProject) => void;
  readonly canSync: (path: string) => string | null;
  readonly pulled: (path: string, source: string) => void;
}

export function initProjectSyncDialog(
  options: Omit<ProjectSyncContext, "project" | "ready" | "open">,
) {
  let project: MapProject | null = null;
  let ready = false;
  let pendingOpen = false;

  function publish() {
    window.dispatchEvent(
      new CustomEvent<ProjectSyncContext>("tea-maps-project-sync-project", {
        detail: {
          project,
          ready,
          open,
          ...options,
          linked(updated) {
            project = updated;
            options.linked(updated);
          },
        },
      }),
    );
  }

  window.addEventListener("tea-maps-project-sync-ready", () => {
    ready = true;
    publish();
    if (pendingOpen) {
      pendingOpen = false;
      open();
    }
  });
  window.addEventListener("tea-maps-project-sync-button-ready", publish);
  function open() {
    if (!project) return;
    if (!ready) {
      pendingOpen = true;
      return;
    }
    window.dispatchEvent(new Event("tea-maps-project-sync-open"));
  }
  window.dispatchEvent(new Event("tea-maps-project-sync-bridge-ready"));
  publish();

  return {
    open,
    setProject(value: MapProject | null) {
      project = value;
      if (!value) pendingOpen = false;
      publish();
    },
  };
}
