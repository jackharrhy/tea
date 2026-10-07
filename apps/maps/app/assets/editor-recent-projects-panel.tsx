import { clientEntry, on, type Handle } from "remix/component";
import {
  listRecentProjects,
  type RecentProject,
} from "./editor-recent-projects.ts";

export interface OpenRecentProjectRequest {
  readonly id: string;
  readonly resolve: () => void;
  readonly reject: (cause: unknown) => void;
}

export const EditorRecentProjects = clientEntry(
  `${import.meta.url}#EditorRecentProjects`,
  function EditorRecentProjectsComponent(handle: Handle) {
    let projects: readonly RecentProject[] | null = null;
    let busyId: string | null = null;
    let error: string | null = null;

    async function refresh() {
      try {
        projects = await listRecentProjects();
        error = null;
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      handle.update();
    }

    handle.queueTask(() => void refresh());

    async function openProject(project: RecentProject) {
      busyId = project.id;
      error = null;
      handle.update();
      try {
        await new Promise<void>((resolve, reject) => {
          const handled = !window.dispatchEvent(
            new CustomEvent<OpenRecentProjectRequest>(
              "tea-maps-open-recent-project",
              {
                cancelable: true,
                detail: { id: project.id, resolve, reject },
              },
            ),
          );
          if (!handled) reject(new Error("The map editor is still starting"));
        });
        document.querySelector<HTMLDetailsElement>("#recent-projects")!.open =
          false;
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      } finally {
        busyId = null;
        handle.update();
      }
    }

    return () => (
      <details
        id="recent-projects"
        mix={on("toggle", (event) => {
          if ((event.currentTarget as HTMLDetailsElement).open) void refresh();
        })}
      >
        <summary>Recent projects</summary>
        <div id="recent-project-list">
          {error ? (
            <span role="status">{error}</span>
          ) : projects === null ? (
            "Loading recent project folders…"
          ) : projects.length === 0 ? (
            "No recent project folders"
          ) : (
            projects.map((project) => (
              <button
                type="button"
                disabled={busyId !== null}
                mix={on("click", () => void openProject(project))}
              >
                <strong>{project.name}</strong>
                <small>{project.lastMapPath ?? project.handle.name}</small>
              </button>
            ))
          )}
        </div>
      </details>
    );
  },
);
