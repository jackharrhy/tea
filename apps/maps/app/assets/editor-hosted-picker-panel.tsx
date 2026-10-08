import {
  HostedMapResponseSchema,
  HostedProjectResponseSchema,
  HostedProjectsResponseSchema,
  HostedSessionResponseSchema,
  type HostedMapLaunch,
  type HostedProject,
  type HostedProjectSummary,
} from "@tea/maps-protocol";
import { clientEntry, on, ref, type Handle } from "remix/component";
import { readHostedApi } from "./hosted-api.ts";
import {
  createHostedMap,
  createHostedProject,
} from "./editor-hosted-create.ts";
import type { HostedPickerContext } from "./editor-hosted.ts";

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

export const EditorHostedPicker = clientEntry(
  `file:///app/assets/editor-hosted-picker-panel.tsx#EditorHostedPicker`,
  function EditorHostedPickerComponent(handle: Handle) {
    let context: HostedPickerContext | null = null;
    let signedIn: boolean | null = null;
    let projects: readonly HostedProjectSummary[] = [];
    let projectId = "";
    let project: HostedProject | null = null;
    let mapId = "";
    let mapFormat = "valve-220";
    let status = "Connecting to Maps service";
    let loginHref = "/auth/login?returnTo=/editor";
    let loadingProject = false;
    let creatingProject = false;
    let creatingMap = false;
    let openingMap = false;
    let comparing = false;
    let copying = false;
    let copied = false;
    let wasViewingHosted = false;
    let requestVersion = 0;
    let initialized = false;
    let projectCreateDetails: HTMLDetailsElement | null = null;
    let mapCreateDetails: HTMLDetailsElement | null = null;

    handle.queueTask(() => {
      loginHref = `/auth/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
      window.addEventListener(
        "tea-maps-hosted-picker-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-hosted-picker-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-hosted-picker-state",
        (event) => {
          context = (event as CustomEvent<HostedPickerContext>).detail;
          if (context.viewingHosted && !wasViewingHosted) copied = false;
          wasViewingHosted = context.viewingHosted;
          handle.update();
          if (!initialized) {
            initialized = true;
            void loadSession();
          }
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-hosted-picker-ready"));
      handle.update();
    });

    async function loadProject(nextId: string, selectedMap?: string) {
      const request = ++requestVersion;
      projectId = nextId;
      project = null;
      mapId = "";
      loadingProject = true;
      status = "Loading project maps";
      context?.setProject(null);
      handle.update();
      try {
        const response = await readHostedApi(
          `/api/projects/${encodeURIComponent(nextId)}`,
          HostedProjectResponseSchema,
        );
        if (request !== requestVersion || handle.signal.aborted) return;
        project = response.project;
        mapFormat = "valve-220";
        mapId =
          selectedMap &&
          response.project.maps.some((map) => map.id === selectedMap)
            ? selectedMap
            : (response.project.maps[0]?.id ?? "");
        context?.setProject(response.project);
        status = mapId
          ? "Choose a map to inspect"
          : "This project has no maps yet";
      } catch (cause) {
        if (request !== requestVersion || handle.signal.aborted) return;
        status = message(cause);
      } finally {
        if (request === requestVersion && !handle.signal.aborted) {
          loadingProject = false;
          handle.update();
        }
      }
    }

    async function openMap(nextId: string, snapshot?: HostedMapLaunch) {
      if (!context || !nextId || openingMap) return;
      openingMap = true;
      status = "Opening hosted map";
      handle.update();
      try {
        const map =
          snapshot ??
          (
            await readHostedApi(
              `/api/maps/${encodeURIComponent(nextId)}`,
              HostedMapResponseSchema,
            )
          ).map;
        const opened = await context.open(map);
        status = opened
          ? `${map.projectName} / ${map.name} opened`
          : "Opening hosted map was cancelled";
      } catch (cause) {
        status = message(cause);
      } finally {
        openingMap = false;
        if (!handle.signal.aborted) handle.update();
      }
    }

    async function loadSession() {
      const initial = new URL(location.href).searchParams;
      const initialMap = initial.get("hostedMap");
      const initialProject = initial.get("hostedProject");
      try {
        const session = await readHostedApi(
          "/api/session",
          HostedSessionResponseSchema,
        );
        if (handle.signal.aborted) return;
        signedIn = Boolean(session.user);
        if (!session.user) {
          status = "Sign in to inspect hosted maps";
          handle.update();
          return;
        }
        const response = await readHostedApi(
          "/api/projects",
          HostedProjectsResponseSchema,
        );
        if (handle.signal.aborted) return;
        projects = response.projects;
        if (!projects.length) {
          status = "No hosted projects are available";
          handle.update();
          return;
        }
        if (initialMap) {
          try {
            const { map } = await readHostedApi(
              `/api/maps/${encodeURIComponent(initialMap)}`,
              HostedMapResponseSchema,
            );
            if (initialProject && map.projectId !== initialProject) {
              status = "Hosted map does not belong to this project";
              handle.update();
              return;
            }
            if (projects.some((item) => item.id === map.projectId)) {
              await loadProject(map.projectId, map.id);
              if (project?.id === map.projectId) await openMap(map.id, map);
              return;
            }
            status = "Hosted map is not in an available project";
          } catch (cause) {
            status = message(cause);
          }
        }
        await loadProject(
          initialProject && projects.some((item) => item.id === initialProject)
            ? initialProject
            : projects[0]!.id,
        );
      } catch (cause) {
        if (!handle.signal.aborted) {
          status = message(cause);
          handle.update();
        }
      }
    }

    async function addProject(form: HTMLFormElement) {
      if (creatingProject) return;
      const fields = new FormData(form);
      creatingProject = true;
      status = "Creating hosted project";
      handle.update();
      try {
        const created = await createHostedProject(
          String(fields.get("name") ?? ""),
          String(fields.get("game") ?? ""),
        );
        projects = [...projects, created];
        form.reset();
        if (projectCreateDetails) projectCreateDetails.open = false;
        await loadProject(created.id);
        if (project?.id === created.id) status = `Created ${created.name}`;
      } catch (cause) {
        status = message(cause);
      } finally {
        creatingProject = false;
        if (!handle.signal.aborted) handle.update();
      }
    }

    async function addMap(form: HTMLFormElement) {
      const selected = project;
      if (!selected || selected.id !== projectId || creatingMap) return;
      const fields = new FormData(form);
      const file = fields.get("file");
      creatingMap = true;
      status = "Creating hosted map";
      handle.update();
      try {
        const created = await createHostedMap(
          selected.id,
          selected.game,
          String(fields.get("name") ?? ""),
          mapFormat,
          file instanceof File && file.size ? file : null,
        );
        form.reset();
        mapFormat = "valve-220";
        if (mapCreateDetails) mapCreateDetails.open = false;
        await loadProject(selected.id, created.id);
        if (project?.id === selected.id) await openMap(created.id);
      } catch (cause) {
        status = message(cause);
      } finally {
        creatingMap = false;
        if (!handle.signal.aborted) handle.update();
      }
    }

    async function compareMap() {
      if (!mapId || !context || comparing) return;
      comparing = true;
      status = "Loading hosted source for comparison";
      handle.update();
      try {
        const { map } = await readHostedApi(
          `/api/maps/${encodeURIComponent(mapId)}`,
          HostedMapResponseSchema,
        );
        context.compare(map);
        status = `Comparing with ${map.projectName} / ${map.name}`;
      } catch (cause) {
        status = message(cause);
      } finally {
        comparing = false;
        if (!handle.signal.aborted) handle.update();
      }
    }

    async function makeCopy() {
      if (!context || copying) return;
      copying = true;
      handle.update();
      try {
        await context.makeCopy();
        copied = true;
        status = "Independent local copy ready";
      } catch (cause) {
        status = message(cause);
      } finally {
        copying = false;
        if (!handle.signal.aborted) handle.update();
      }
    }

    return () => (
      <div class="hosted-picker-controls">
        <p id="hosted-editor-status" role="status">
          {status}
        </p>
        <a
          id="hosted-editor-login"
          href={loginHref}
          hidden={signedIn !== false}
        >
          Sign in to Maps
        </a>
        <label for="hosted-editor-project">Project</label>
        <select
          id="hosted-editor-project"
          disabled={!projects.length || loadingProject}
          mix={on<HTMLSelectElement>("change", (event) => {
            void loadProject(event.currentTarget.value);
          })}
        >
          {projects.map((item) => (
            <option value={item.id} selected={item.id === projectId}>
              {item.name}
            </option>
          ))}
        </select>
        <details
          id="hosted-project-create"
          hidden={signedIn !== true}
          mix={ref((node: HTMLDetailsElement) => {
            projectCreateDetails = node;
          })}
        >
          <summary>Create hosted project</summary>
          <form
            id="hosted-project-create-form"
            mix={on<HTMLFormElement>("submit", (event) => {
              event.preventDefault();
              void addProject(event.currentTarget);
            })}
          >
            <label for="hosted-project-name">Project name</label>
            <input
              id="hosted-project-name"
              name="name"
              maxLength={120}
              required
            />
            <label for="hosted-project-game">Game</label>
            <select id="hosted-project-game" name="game">
              <option value="quake">Quake</option>
              <option value="goldsrc">GoldSrc</option>
              <option value="gower">Gower Complex</option>
            </select>
            <button
              id="hosted-project-create-button"
              type="submit"
              disabled={creatingProject}
            >
              Create project
            </button>
          </form>
        </details>
        <label for="hosted-editor-map">Map</label>
        <select
          id="hosted-editor-map"
          disabled={!project?.maps.length || loadingProject}
          mix={on<HTMLSelectElement>("change", (event) => {
            mapId = event.currentTarget.value;
            handle.update();
          })}
        >
          {project?.maps.map((map) => (
            <option value={map.id} selected={map.id === mapId}>
              {map.name}
            </option>
          ))}
        </select>
        <details
          id="hosted-map-create"
          hidden={project?.role !== "owner" && project?.role !== "editor"}
          mix={ref((node: HTMLDetailsElement) => {
            mapCreateDetails = node;
          })}
        >
          <summary>Create hosted map</summary>
          <form
            id="hosted-map-create-form"
            mix={on<HTMLFormElement>("submit", (event) => {
              event.preventDefault();
              void addMap(event.currentTarget);
            })}
          >
            <label for="hosted-map-name">Map name</label>
            <input
              id="hosted-map-name"
              name="name"
              defaultValue="untitled.map"
              maxLength={120}
              required
            />
            <label for="hosted-map-format">Format</label>
            <select
              id="hosted-map-format"
              name="format"
              mix={on<HTMLSelectElement>("change", (event) => {
                mapFormat = event.currentTarget.value;
              })}
            >
              <option value="valve-220" selected={mapFormat === "valve-220"}>
                Valve 220
              </option>
              <option
                value="quake"
                selected={mapFormat === "quake"}
                hidden={project?.game !== "quake"}
              >
                Classic Quake
              </option>
            </select>
            <label for="hosted-map-file">Existing .map file (optional)</label>
            <input
              id="hosted-map-file"
              name="file"
              type="file"
              accept=".map,text/plain"
            />
            <button
              id="hosted-map-create-button"
              type="submit"
              disabled={creatingMap}
            >
              Create map
            </button>
          </form>
        </details>
        <button
          id="hosted-editor-open"
          type="button"
          disabled={!mapId || openingMap || loadingProject}
          mix={on("click", () => void openMap(mapId))}
        >
          Open hosted map
        </button>
        <button
          id="hosted-editor-compare"
          type="button"
          disabled={
            !mapId || context?.viewingHosted || comparing || loadingProject
          }
          mix={on("click", () => void compareMap())}
        >
          Compare with current source
        </button>
        <button
          id="hosted-editor-copy"
          type="button"
          disabled={!context?.viewingHosted || copying || copied}
          mix={on("click", () => void makeCopy())}
        >
          Edit a local copy
        </button>
      </div>
    );
  },
);
