import type { MapProject } from "./editor-project.ts";

export interface ProjectSyncContext {
  readonly project: MapProject | null;
  readonly linked: (project: MapProject) => void;
  readonly canSync: (path: string) => string | null;
  readonly pulled: (path: string, source: string) => void;
}

export function initProjectSyncDialog(
  options: Omit<ProjectSyncContext, "project">,
) {
  const openButton =
    document.querySelector<HTMLButtonElement>("#project-sync-open")!;
  let project: MapProject | null = null;
  let ready = false;
  let pendingOpen = false;

  function publish() {
    window.dispatchEvent(
      new CustomEvent<ProjectSyncContext>("tea-maps-project-sync-project", {
        detail: {
          project,
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
    openButton.disabled = !project;
    publish();
    if (pendingOpen) {
      pendingOpen = false;
      open();
    }
  });
  function open() {
    if (!project) return;
    if (!ready) {
      pendingOpen = true;
      return;
    }
    window.dispatchEvent(new Event("tea-maps-project-sync-open"));
  }
  openButton.addEventListener("click", open);
  publish();

  return {
    open,
    setProject(value: MapProject | null) {
      project = value;
      if (!value) pendingOpen = false;
      openButton.disabled = !ready || !value;
      if (ready) publish();
    },
  };
}
