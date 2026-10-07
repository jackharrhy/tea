import { clientEntry, on, type Handle } from "remix/component";
import {
  listRecentProjects,
  type RecentProject,
} from "./editor-recent-projects.ts";
import {
  listDetachedMapSummaries,
  type DetachedMapSummary,
} from "./editor-detached-catalog.ts";

export const RecentProjects = clientEntry(
  `${import.meta.url}#RecentProjects`,
  function RecentProjectsComponent(handle: Handle) {
    let projects: readonly RecentProject[] | null = null;
    let error: string | null = null;
    let openingId: string | null = null;

    handle.queueTask(() => {
      void listRecentProjects()
        .then((value) => {
          projects = value;
          handle.update();
        })
        .catch((cause: unknown) => {
          error = message(cause);
          handle.update();
        });
    });

    async function openProject(project: RecentProject) {
      openingId = project.id;
      error = null;
      handle.update();
      try {
        const permission =
          (await project.handle.queryPermission?.({ mode: "readwrite" })) ??
          "granted";
        if (permission !== "granted") {
          const granted = await project.handle.requestPermission?.({
            mode: "readwrite",
          });
          if (granted !== "granted")
            throw new Error("Project folder permission was not granted");
        }
        location.href = `/editor?recentProject=${encodeURIComponent(project.id)}`;
      } catch (cause) {
        error = message(cause);
        openingId = null;
        handle.update();
      }
    }

    return () => (
      <div id="local-projects-list" class="project-list">
        {error ? <p role="status">{error}</p> : null}
        {projects === null
          ? "Loading recent projects…"
          : projects.length === 0
            ? "No recent local projects on this device"
            : projects.map((project) => (
                <div class="project-row">
                  <strong>{project.name}</strong>
                  <small>{project.lastMapPath ?? project.handle.name}</small>
                  <button
                    type="button"
                    disabled={openingId === project.id}
                    mix={on("click", () => void openProject(project))}
                  >
                    Open in editor
                  </button>
                </div>
              ))}
      </div>
    );
  },
);

export const RecoveredMaps = clientEntry(
  `${import.meta.url}#RecoveredMaps`,
  function RecoveredMapsComponent(handle: Handle) {
    let copies: readonly DetachedMapSummary[] | null = null;
    let error: string | null = null;

    handle.queueTask(() => {
      void listDetachedMapSummaries()
        .then((value) => {
          copies = value;
          handle.update();
        })
        .catch((cause: unknown) => {
          error = message(cause);
          handle.update();
        });
    });

    return () => (
      <div id="detached-maps-list" class="project-list">
        {error
          ? `Recovered maps are unavailable: ${error}`
          : copies === null
            ? "Loading recovered maps…"
            : copies.length === 0
              ? "No recovered maps on this device"
              : copies.map((copy) => (
                  <div class="project-row">
                    <strong>{copy.name}</strong>
                    <small>{copy.reason}</small>
                    <a
                      href={`/editor?detachedMap=${encodeURIComponent(copy.id)}`}
                      data-rmx-document
                    >
                      Open copy · {new Date(copy.createdAt).toLocaleString()}
                    </a>
                  </div>
                ))}
      </div>
    );
  },
);

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
