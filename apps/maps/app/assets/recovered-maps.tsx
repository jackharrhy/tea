import { clientEntry, on, type Handle } from "remix/component";
import {
  listRecentProjects,
  type RecentProject,
} from "./editor-recent-projects.ts";
import {
  listDetachedMapSummaries,
  type DetachedMapSummary,
} from "./editor-detached-catalog.ts";
import { openLocalProject } from "./project-local.ts";
import {
  countLegacyDetachedMaps,
  importLegacyDetachedMaps,
} from "./editor-legacy-local.ts";

export const OpenLocalProject = clientEntry(
  `${import.meta.url}#OpenLocalProject`,
  function OpenLocalProjectComponent(handle: Handle) {
    let opening = false;
    let error: string | null = null;

    async function open() {
      if (opening) return;
      opening = true;
      error = null;
      handle.update();
      try {
        const id = await openLocalProject();
        if (id)
          location.href = `/editor?recentProject=${encodeURIComponent(id)}`;
      } catch (cause) {
        error = message(cause);
      } finally {
        opening = false;
        handle.update();
      }
    }

    return () => (
      <div>
        <button
          id="projects-open-local"
          type="button"
          disabled={opening}
          mix={on("click", () => void open())}
        >
          Open local project folder
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </div>
    );
  },
);

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
    let legacyCount = 0;
    let legacyError: string | null = null;
    let importing = false;
    let importStatus = "";

    handle.queueTask(() => {
      void listDetachedMapSummaries()
        .then((found) => {
          copies = found;
          handle.update();
        })
        .catch((cause: unknown) => {
          error = message(cause);
          handle.update();
        });
      void countLegacyDetachedMaps()
        .then((count) => {
          legacyCount = count;
          handle.update();
        })
        .catch((cause: unknown) => {
          legacyError = message(cause);
          handle.update();
        });
    });

    async function importCopies() {
      if (importing) return;
      importing = true;
      importStatus = "Importing local Worldview copies…";
      handle.update();
      try {
        const result = await importLegacyDetachedMaps();
        copies = await listDetachedMapSummaries();
        importStatus = `Imported ${result.imported} Worldview copies; ${result.existing} were already in Tea.`;
      } catch (cause) {
        importStatus = message(cause);
      } finally {
        importing = false;
        handle.update();
      }
    }

    return () => (
      <div id="detached-maps-list" class="project-list">
        {legacyCount > 0 ? (
          <button
            id="import-worldview-copies"
            type="button"
            disabled={importing}
            mix={on("click", () => void importCopies())}
          >
            Import {legacyCount} Worldview local copies
          </button>
        ) : null}
        {legacyError ? (
          <p role="status">
            Worldview local copies are unavailable: {legacyError}
          </p>
        ) : null}
        {importStatus ? <p role="status">{importStatus}</p> : null}
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
