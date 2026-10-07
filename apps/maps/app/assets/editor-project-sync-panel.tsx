import { clientEntry, on, type Handle } from "remix/component";
import type { HostedProject } from "@tea/maps-protocol";
import type { MapProject } from "./editor-project.ts";
import type { ProjectSyncContext } from "./editor-project-sync-dialog.ts";
import {
  inspectLinkedMap,
  linkHostedProject,
  loadHostedProjectForSync,
  pullLinkedMap,
  pushLinkedMap,
  type ProjectSyncInspection,
} from "./editor-project-sync.ts";
import { compareSources } from "./editor-source-compare.ts";

const statusLabels = {
  "in-sync": "In sync",
  "first-link": "No common sync point",
  "local-changed": "Local changed",
  "hosted-changed": "Hosted changed",
  conflict: "Both changed",
} as const;

export const EditorProjectSync = clientEntry(
  `${import.meta.url}#EditorProjectSync`,
  function EditorProjectSyncComponent(handle: Handle) {
    let context: ProjectSyncContext | null = null;
    let project: MapProject | null = null;
    let projectId = "";
    let loadedProject: HostedProject | null = null;
    let mappings: Record<string, string> = {};
    let selectedPath = "";
    let inspection: ProjectSyncInspection | null = null;
    let status = "";
    let mode: "setup" | "linked" = "setup";
    let busy = false;
    let generation = 0;

    function showError(cause: unknown) {
      status = cause instanceof Error ? cause.message : String(cause);
      handle.update();
    }

    async function inspect(path: string) {
      const current = project;
      if (!current || !path) return;
      const request = ++generation;
      selectedPath = path;
      inspection = null;
      busy = true;
      status = `Comparing ${path}`;
      handle.update();
      try {
        const result = await inspectLinkedMap(current, path);
        if (
          request !== generation ||
          current !== project ||
          handle.signal.aborted
        )
          return;
        inspection = result;
        status = `${path}: ${statusLabels[result.status]}`;
      } catch (cause) {
        if (request === generation) showError(cause);
      } finally {
        if (request === generation) {
          busy = false;
          handle.update();
        }
      }
    }

    function showLinked() {
      const current = project;
      if (!current?.manifest.hosted) return;
      mode = "linked";
      inspection = null;
      selectedPath = current.manifest.hosted.maps[0]?.path ?? "";
      status = selectedPath ? "" : "No maps are linked";
      handle.update();
      if (selectedPath) void inspect(selectedPath);
    }

    function showSetup() {
      mode = "setup";
      loadedProject = null;
      mappings = {};
      inspection = null;
      status = "Enter a hosted project ID and pair local maps";
      handle.update();
    }

    function setContext(next: ProjectSyncContext) {
      generation++;
      context = next;
      project = next.project;
      projectId = next.project?.manifest.hosted?.projectId ?? "";
      loadedProject = null;
      mappings = {};
      inspection = null;
      busy = false;
      document
        .querySelector<HTMLDialogElement>("#project-sync-dialog")
        ?.close();
      handle.update();
    }

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-project-sync-project",
        (event) =>
          setContext((event as CustomEvent<ProjectSyncContext>).detail),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-project-sync-open",
        () => {
          if (!project) return;
          document
            .querySelector<HTMLDialogElement>("#project-sync-dialog")!
            .showModal();
          if (project.manifest.hosted) showLinked();
          else showSetup();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-project-sync-ready"));
    });

    async function loadProject() {
      const current = project;
      if (!current || busy) return;
      const request = ++generation;
      busy = true;
      status = "Loading hosted project";
      handle.update();
      try {
        const remote = await loadHostedProjectForSync(projectId, current);
        if (
          request !== generation ||
          current !== project ||
          handle.signal.aborted
        )
          return;
        loadedProject = remote;
        mappings = {};
        status = `${remote.name}: ${remote.maps.length} hosted maps available`;
      } catch (cause) {
        if (request === generation) {
          loadedProject = null;
          mappings = {};
          showError(cause);
        }
      } finally {
        if (request === generation) {
          busy = false;
          handle.update();
        }
      }
    }

    async function linkProject() {
      const current = project;
      const remote = loadedProject;
      if (!current || !remote || busy) return;
      const request = ++generation;
      busy = true;
      status = "Saving project links";
      handle.update();
      try {
        const updated = await linkHostedProject(current, remote, mappings);
        if (
          request !== generation ||
          current !== project ||
          handle.signal.aborted
        )
          return;
        project = updated;
        context?.linked(updated);
        status = `Linked ${updated.manifest.hosted?.maps.length ?? 0} maps`;
        showLinked();
      } catch (cause) {
        if (request === generation) showError(cause);
      } finally {
        if (request === generation) {
          busy = false;
          handle.update();
        }
      }
    }

    async function sync(direction: "pull" | "push") {
      const current = project;
      const reviewed = inspection;
      if (!current || !reviewed || busy) return;
      const reason = context?.canSync(reviewed.path);
      if (reason) {
        status = reason;
        handle.update();
        return;
      }
      const request = ++generation;
      busy = true;
      status =
        direction === "pull" ? "Pulling hosted source" : "Pushing local source";
      handle.update();
      try {
        if (direction === "pull") {
          await pullLinkedMap(current, reviewed);
          if (request === generation && current === project)
            context?.pulled(reviewed.path, reviewed.hosted.source);
        } else {
          await pushLinkedMap(current, reviewed);
        }
        if (request === generation && current === project)
          await inspect(reviewed.path);
      } catch (cause) {
        if (request === generation) showError(cause);
      } finally {
        if (request === generation) {
          busy = false;
          handle.update();
        }
      }
    }

    return () => {
      const linkedMaps = project?.manifest.hosted?.maps ?? [];
      const comparison = inspection
        ? compareSources(inspection.localSource, inspection.hosted.source)
        : null;
      const summary = inspection
        ? `${statusLabels[inspection.status]} · hosted version ${inspection.hosted.mapVersion}${comparison?.same ? " · exact source match" : ` · first difference at line ${comparison?.firstDifferentLine ?? "end"}`}`
        : "Choose a linked map to compare";
      return (
        <dialog
          id="project-sync-dialog"
          aria-labelledby="project-sync-title"
          mix={on("cancel", (event) => {
            if (busy) event.preventDefault();
          })}
        >
          <h2 id="project-sync-title">Project sync</h2>
          <p id="project-sync-status" role="status">
            {status}
          </p>
          <div id="project-sync-setup" hidden={mode !== "setup"}>
            <label for="project-sync-id">Hosted project ID</label>
            <input
              id="project-sync-id"
              type="text"
              placeholder="12-character project ID"
              value={projectId}
              mix={on<HTMLInputElement>("input", (event) => {
                projectId = event.currentTarget.value;
              })}
            />
            <button
              id="project-sync-load"
              type="button"
              disabled={busy}
              mix={on("click", () => void loadProject())}
            >
              Load hosted maps
            </button>
            <div id="project-sync-mappings">
              {loadedProject &&
                project?.maps.map((map) => (
                  <label>
                    {map.path}
                    <select
                      data-local-path={map.path}
                      mix={on<HTMLSelectElement>("change", (event) => {
                        mappings[map.path] = event.currentTarget.value;
                      })}
                    >
                      <option value="">Not linked</option>
                      {loadedProject!.maps.map((candidate) => (
                        <option value={candidate.id}>{candidate.name}</option>
                      ))}
                    </select>
                  </label>
                ))}
            </div>
            <button
              id="project-sync-link"
              type="button"
              disabled={busy || !loadedProject}
              mix={on("click", () => void linkProject())}
            >
              Save project links
            </button>
          </div>
          <div id="project-sync-linked" hidden={mode !== "linked"}>
            <label for="project-sync-map">Linked map</label>
            <select
              id="project-sync-map"
              mix={on<HTMLSelectElement>(
                "change",
                (event) => void inspect(event.currentTarget.value),
              )}
            >
              {linkedMaps.map((map) => (
                <option value={map.path} selected={map.path === selectedPath}>
                  {map.path}
                </option>
              ))}
            </select>
            <button
              id="project-sync-relink"
              type="button"
              disabled={busy}
              mix={on("click", showSetup)}
            >
              Change project links
            </button>
            <button
              id="project-sync-inspect"
              type="button"
              disabled={busy || !selectedPath}
              mix={on("click", () => void inspect(selectedPath))}
            >
              Compare sources
            </button>
            <p id="project-sync-summary">{summary}</p>
            <div class="source-compare-columns">
              <div>
                <label for="project-sync-local">Local file</label>
                <textarea
                  id="project-sync-local"
                  readOnly
                  spellCheck={false}
                  value={inspection?.localSource ?? ""}
                />
              </div>
              <div>
                <label for="project-sync-hosted">Hosted map</label>
                <textarea
                  id="project-sync-hosted"
                  readOnly
                  spellCheck={false}
                  value={inspection?.hosted.source ?? ""}
                />
              </div>
            </div>
            <p>
              Pull replaces the local file. Push replaces the hosted source.
              Review both copies before choosing a direction.
            </p>
            <div class="project-sync-actions">
              <button
                id="project-sync-pull"
                type="button"
                disabled={
                  busy || !inspection || inspection.status === "in-sync"
                }
                mix={on("click", () => void sync("pull"))}
              >
                Pull hosted to disk
              </button>
              <button
                id="project-sync-push"
                type="button"
                disabled={
                  busy ||
                  !inspection ||
                  inspection.status === "in-sync" ||
                  inspection.hosted.role === "viewer"
                }
                mix={on("click", () => void sync("push"))}
              >
                Push disk to hosted
              </button>
            </div>
          </div>
          <button
            id="project-sync-close"
            type="button"
            disabled={busy}
            mix={on("click", () =>
              document
                .querySelector<HTMLDialogElement>("#project-sync-dialog")!
                .close(),
            )}
          >
            Close
          </button>
        </dialog>
      );
    };
  },
);
