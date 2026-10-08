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
  countLegacyLocalData,
  exportLegacyLocalArchive,
  importLegacyLocalArchive,
  importLegacyLocalData,
  importLegacyLocalProjects,
  listImportedLegacyRecovery,
  countLegacyLocalProjects,
  type LegacyRecoverySnapshot,
} from "./editor-legacy-local.ts";
import {
  countLegacyExportSettings,
  importLegacyExportSettings,
} from "./editor-legacy-export-settings.ts";

export const OpenLocalProject = clientEntry(
  `file:///app/assets/recovered-maps.tsx#OpenLocalProject`,
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
  `file:///app/assets/recovered-maps.tsx#RecentProjects`,
  function RecentProjectsComponent(handle: Handle) {
    let projects: readonly RecentProject[] | null = null;
    let error: string | null = null;
    let openingId: string | null = null;
    let legacyCount = 0;
    let importing = false;
    let importStatus = "";

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
      void countLegacyLocalProjects()
        .then((count) => {
          legacyCount = count;
          handle.update();
        })
        .catch((cause: unknown) => {
          error = message(cause);
          handle.update();
        });
    });

    async function importProjects() {
      if (importing) return;
      importing = true;
      importStatus = "Importing Worldview project folders…";
      handle.update();
      try {
        const result = await importLegacyLocalProjects();
        projects = await listRecentProjects();
        importStatus = `Imported ${result.imported} project folders; ${result.existing} were already in Tea.`;
      } catch (cause) {
        importStatus = message(cause);
      } finally {
        importing = false;
        handle.update();
      }
    }

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
        {legacyCount > 0 ? (
          <button
            type="button"
            disabled={importing}
            mix={on("click", () => void importProjects())}
          >
            Import {legacyCount} Worldview project folders
          </button>
        ) : null}
        {importStatus ? <p role="status">{importStatus}</p> : null}
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
  `file:///app/assets/recovered-maps.tsx#RecoveredMaps`,
  function RecoveredMapsComponent(handle: Handle) {
    let copies: readonly DetachedMapSummary[] | null = null;
    let error: string | null = null;
    let legacyCounts = { copies: 0, recovery: 0, mounts: 0 };
    let legacyExportCount = 0;
    let recovery: readonly LegacyRecoverySnapshot[] = [];
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
      void countLegacyLocalData()
        .then((counts) => {
          legacyCounts = counts;
          handle.update();
        })
        .catch((cause: unknown) => {
          legacyError = message(cause);
          handle.update();
        });
      void countLegacyExportSettings()
        .then((count) => {
          legacyExportCount = count;
          handle.update();
        })
        .catch((cause: unknown) => {
          legacyError = message(cause);
          handle.update();
        });
      void listImportedLegacyRecovery()
        .then((found) => {
          recovery = found;
          handle.update();
        })
        .catch((cause: unknown) => {
          legacyError = message(cause);
          handle.update();
        });
    });

    async function importFromThisOrigin() {
      if (importing) return;
      importing = true;
      importStatus = "Importing local Worldview work…";
      handle.update();
      try {
        const result = await importLegacyLocalData();
        copies = await listDetachedMapSummaries();
        recovery = await listImportedLegacyRecovery();
        importStatus = `Imported ${result.copies.imported} local copies, ${result.recovery.imported} recovery versions, and ${result.mounts.imported} resource mounts; ${result.copies.existing + result.recovery.existing + result.mounts.existing} were already in Tea.`;
      } catch (cause) {
        importStatus = message(cause);
      } finally {
        importing = false;
        handle.update();
      }
    }

    async function downloadLegacyWork() {
      if (importing) return;
      importing = true;
      importStatus = "Preparing Worldview local archive…";
      handle.update();
      try {
        const blob = await exportLegacyLocalArchive();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "worldview-local-work.json";
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1_000);
        importStatus = "Downloaded Worldview local work";
      } catch (cause) {
        importStatus = message(cause);
      } finally {
        importing = false;
        handle.update();
      }
    }

    async function importExportPreferences() {
      if (importing) return;
      importing = true;
      importStatus = "Importing Worldview export preferences…";
      handle.update();
      try {
        const result = await importLegacyExportSettings();
        importStatus = `Imported ${result.imported} export preferences; ${result.existing} were already in Tea.`;
      } catch (cause) {
        importStatus = message(cause);
      } finally {
        importing = false;
        handle.update();
      }
    }

    async function importFile(file: File) {
      if (importing) return;
      importing = true;
      importStatus = "Importing Worldview local archive…";
      handle.update();
      try {
        const result = await importLegacyLocalArchive(file);
        copies = await listDetachedMapSummaries();
        recovery = await listImportedLegacyRecovery();
        importStatus = `Imported ${result.copies.imported} local copies, ${result.recovery.imported} recovery versions, ${result.mounts.imported} resource mounts, and ${result.exports.imported} export preferences; ${result.copies.existing + result.recovery.existing + result.mounts.existing + result.exports.existing} were already in Tea.`;
      } catch (cause) {
        importStatus = message(cause);
      } finally {
        importing = false;
        handle.update();
      }
    }

    return () => (
      <div id="detached-maps-list" class="project-list">
        {legacyCounts.copies +
          legacyCounts.recovery +
          legacyCounts.mounts +
          legacyExportCount >
        0 ? (
          <div>
            {legacyCounts.copies + legacyCounts.recovery + legacyCounts.mounts >
            0 ? (
              <button
                id="import-worldview-copies"
                type="button"
                disabled={importing}
                mix={on("click", () => void importFromThisOrigin())}
              >
                Import {legacyCounts.copies} Worldview copies and{" "}
                {legacyCounts.recovery} recovery versions, and{" "}
                {legacyCounts.mounts} resource mounts
              </button>
            ) : null}
            <button
              id="download-worldview-copies"
              type="button"
              disabled={importing}
              mix={on("click", () => void downloadLegacyWork())}
            >
              Download Worldview maps, resources, and export preferences
            </button>
          </div>
        ) : null}
        {legacyExportCount > 0 ? (
          <button
            type="button"
            disabled={importing}
            mix={on("click", () => void importExportPreferences())}
          >
            Import {legacyExportCount} Worldview export preferences
          </button>
        ) : null}
        {legacyCounts.copies +
          legacyCounts.recovery +
          legacyCounts.mounts +
          legacyExportCount >
        0 ? (
          <p>
            Local build history stays in Worldview. Save builds you need there;
            choose export folders again on a new origin and relink project sync
            in Tea.
          </p>
        ) : null}
        <label for="import-worldview-copies-file">
          Import Worldview local work from a file
        </label>
        <input
          id="import-worldview-copies-file"
          type="file"
          accept=".json,application/json"
          disabled={importing}
          mix={on<HTMLInputElement>("change", (event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            input.value = "";
            if (file) void importFile(file);
          })}
        />
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
        {recovery.length > 0 ? <h3>Worldview recovery versions</h3> : null}
        {recovery.map((snapshot) => (
          <div class="project-row">
            <strong>{snapshot.fileName}</strong>
            <small>
              {snapshot.label} · {snapshot.document.faceSyntax} ·{" "}
              {new Date(snapshot.updatedAt).toLocaleString()}
            </small>
            <form action="/editor" method="get" data-rmx-document>
              <input
                type="hidden"
                name="legacyRecovery"
                value={snapshot.snapshotId}
              />
              <label>
                Game
                <select name="game" required>
                  <option value="">Choose game</option>
                  <option value="quake">Quake</option>
                  <option value="goldsrc">GoldSrc</option>
                  <option value="quake2">Quake II</option>
                  <option value="gower">Gower Complex</option>
                </select>
              </label>
              <button type="submit">Open as local copy</button>
            </form>
          </div>
        ))}
      </div>
    );
  },
);

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
