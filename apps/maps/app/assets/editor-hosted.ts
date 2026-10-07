import {
  HostedMapResponseSchema,
  HostedProjectResponseSchema,
  HostedProjectsResponseSchema,
  HostedSessionResponseSchema,
  type HostedMapLaunch,
  type HostedProject,
} from "@tea/maps-protocol";
import { readHostedApi } from "./hosted-api.ts";
import { initHostedAccess } from "./editor-hosted-access.ts";
import {
  createHostedMap,
  createHostedProject,
} from "./editor-hosted-create.ts";
import { initEditorHostedResources } from "./editor-hosted-resources-bridge.ts";
import {
  IndexedDbCollaborationOutbox,
  type DetachedHostedMap,
} from "./editor-collaboration.ts";

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
  const status = document.querySelector<HTMLElement>("#hosted-editor-status")!;
  const login = document.querySelector<HTMLAnchorElement>(
    "#hosted-editor-login",
  )!;
  const projects = document.querySelector<HTMLSelectElement>(
    "#hosted-editor-project",
  )!;
  const projectCreate = document.querySelector<HTMLDetailsElement>(
    "#hosted-project-create",
  )!;
  const projectCreateForm = document.querySelector<HTMLFormElement>(
    "#hosted-project-create-form",
  )!;
  const projectCreateButton = document.querySelector<HTMLButtonElement>(
    "#hosted-project-create-button",
  )!;
  const projectName = document.querySelector<HTMLInputElement>(
    "#hosted-project-name",
  )!;
  const projectGame = document.querySelector<HTMLSelectElement>(
    "#hosted-project-game",
  )!;
  const maps = document.querySelector<HTMLSelectElement>("#hosted-editor-map")!;
  const mapCreate =
    document.querySelector<HTMLDetailsElement>("#hosted-map-create")!;
  const mapCreateForm = document.querySelector<HTMLFormElement>(
    "#hosted-map-create-form",
  )!;
  const mapCreateButton = document.querySelector<HTMLButtonElement>(
    "#hosted-map-create-button",
  )!;
  const mapName = document.querySelector<HTMLInputElement>("#hosted-map-name")!;
  const mapFormat =
    document.querySelector<HTMLSelectElement>("#hosted-map-format")!;
  const mapFile = document.querySelector<HTMLInputElement>("#hosted-map-file")!;
  const openButton = document.querySelector<HTMLButtonElement>(
    "#hosted-editor-open",
  )!;
  const compareButton = document.querySelector<HTMLButtonElement>(
    "#hosted-editor-compare",
  )!;
  const copyButton = document.querySelector<HTMLButtonElement>(
    "#hosted-editor-copy",
  )!;
  const detachedMaps = document.querySelector<HTMLSelectElement>(
    "#detached-editor-map",
  )!;
  const detachedOpen = document.querySelector<HTMLButtonElement>(
    "#detached-editor-open",
  )!;
  const outbox = new IndexedDbCollaborationOutbox();
  const access = initHostedAccess();
  const initialMap = new URL(location.href).searchParams.get("hostedMap");
  const initialProject = new URL(location.href).searchParams.get(
    "hostedProject",
  );
  let requestVersion = 0;
  let viewingHosted = false;
  let currentProject: HostedProject | null = null;

  function refreshCompareAvailability() {
    compareButton.disabled = viewingHosted || maps.disabled || !maps.value;
  }

  const resourcePanel = initEditorHostedResources({
    resourcesChanged: options.resourcesChanged,
  });

  login.href = `/auth/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
  if (initialMap || initialProject) picker.open = true;

  async function loadProject(projectId: string, selectedMap?: string) {
    const version = ++requestVersion;
    currentProject = null;
    access.setProject(null);
    resourcePanel.setProject(null);
    mapCreate.hidden = true;
    maps.replaceChildren();
    maps.disabled = true;
    openButton.disabled = true;
    refreshCompareAvailability();
    status.textContent = "Loading project maps";
    const response = await readHostedApi(
      `/api/projects/${encodeURIComponent(projectId)}`,
      HostedProjectResponseSchema,
    );
    if (version !== requestVersion) return;
    currentProject = response.project;
    access.setProject(response.project);
    resourcePanel.setProject(response.project);
    mapCreate.hidden =
      response.project.role !== "owner" && response.project.role !== "editor";
    mapFormat.querySelector<HTMLOptionElement>(
      'option[value="quake"]',
    )!.hidden = response.project.game !== "quake";
    if (response.project.game !== "quake") mapFormat.value = "valve-220";
    for (const map of response.project.maps)
      maps.add(new Option(map.name, map.id));
    if (
      selectedMap &&
      response.project.maps.some((map) => map.id === selectedMap)
    ) {
      maps.value = selectedMap;
    }
    maps.disabled = response.project.maps.length === 0;
    openButton.disabled = maps.disabled;
    refreshCompareAvailability();
    status.textContent = maps.disabled
      ? "This project has no maps yet"
      : "Choose a map to inspect";
  }

  async function openMap(mapId: string, snapshot?: HostedMapLaunch) {
    openButton.disabled = true;
    status.textContent = "Opening hosted map";
    try {
      const map =
        snapshot ??
        (
          await readHostedApi(
            `/api/maps/${encodeURIComponent(mapId)}`,
            HostedMapResponseSchema,
          )
        ).map;
      const opened = await options.open(map);
      status.textContent = opened
        ? `${map.projectName} / ${map.name} opened`
        : "Opening hosted map was cancelled";
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      openButton.disabled = maps.disabled;
    }
  }

  async function loadSession() {
    const session = await readHostedApi(
      "/api/session",
      HostedSessionResponseSchema,
    );
    if (!session.user) {
      login.hidden = false;
      projectCreate.hidden = true;
      status.textContent = "Sign in to inspect hosted maps";
      return;
    }
    projectCreate.hidden = false;
    const response = await readHostedApi(
      "/api/projects",
      HostedProjectsResponseSchema,
    );
    for (const project of response.projects) {
      projects.add(new Option(project.name, project.id));
    }
    projects.disabled = response.projects.length === 0;
    if (projects.disabled) {
      status.textContent = "No hosted projects are available";
      return;
    }
    if (initialMap) {
      try {
        const { map } = await readHostedApi(
          `/api/maps/${encodeURIComponent(initialMap)}`,
          HostedMapResponseSchema,
        );
        if (response.projects.some((project) => project.id === map.projectId)) {
          projects.value = map.projectId;
          await loadProject(map.projectId, map.id);
          await openMap(map.id, map);
          return;
        }
        status.textContent = "Hosted map is not in an available project";
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : String(error);
      }
    }
    if (
      initialProject &&
      response.projects.some((project) => project.id === initialProject)
    ) {
      projects.value = initialProject;
      await loadProject(initialProject);
      return;
    }
    await loadProject(projects.value);
  }

  projects.addEventListener("change", () => {
    void loadProject(projects.value).catch((error: unknown) => {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    });
  });
  projectCreateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    projectCreateButton.disabled = true;
    status.textContent = "Creating hosted project";
    void createHostedProject(projectName.value, projectGame.value)
      .then(async (project) => {
        projects.add(new Option(project.name, project.id));
        projects.disabled = false;
        projects.value = project.id;
        projectCreateForm.reset();
        projectCreate.open = false;
        await loadProject(project.id);
        status.textContent = `Created ${project.name}`;
      })
      .catch((error: unknown) => {
        status.textContent =
          error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        projectCreateButton.disabled = false;
      });
  });
  mapCreateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const project = currentProject;
    if (!project || project.id !== projects.value) return;
    mapCreateButton.disabled = true;
    status.textContent = "Creating hosted map";
    void createHostedMap(
      project.id,
      project.game,
      mapName.value,
      mapFormat.value,
      mapFile.files?.[0] ?? null,
    )
      .then(async (map) => {
        mapCreateForm.reset();
        mapCreate.open = false;
        await loadProject(project.id, map.id);
        await openMap(map.id);
      })
      .catch((error: unknown) => {
        status.textContent =
          error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        mapCreateButton.disabled = false;
      });
  });
  openButton.addEventListener("click", () => {
    if (maps.value) void openMap(maps.value);
  });
  compareButton.addEventListener("click", () => {
    if (!maps.value) return;
    compareButton.disabled = true;
    status.textContent = "Loading hosted source for comparison";
    void readHostedApi(
      `/api/maps/${encodeURIComponent(maps.value)}`,
      HostedMapResponseSchema,
    )
      .then(({ map }) => {
        options.compare(map);
        status.textContent = `Comparing with ${map.projectName} / ${map.name}`;
      })
      .catch((error: unknown) => {
        status.textContent =
          error instanceof Error ? error.message : String(error);
      })
      .finally(refreshCompareAvailability);
  });
  copyButton.addEventListener("click", () => {
    void options
      .makeCopy()
      .then(() => {
        copyButton.disabled = true;
        status.textContent = "Independent local copy ready";
      })
      .catch((error: unknown) => {
        status.textContent =
          error instanceof Error ? error.message : String(error);
      });
  });
  async function refreshDetached() {
    const copies = await outbox.listDetached();
    detachedMaps.replaceChildren();
    for (const copy of copies) {
      detachedMaps.add(
        new Option(
          `${copy.fileName} · ${new Date(copy.createdAt).toLocaleString()}`,
          copy.id,
        ),
      );
    }
    detachedMaps.disabled = copies.length === 0;
    detachedOpen.disabled = copies.length === 0;
  }
  detachedOpen.addEventListener("click", () => {
    void outbox
      .loadDetached(detachedMaps.value)
      .then(async (copy) => {
        if (copy) await options.openDetached(copy);
      })
      .catch((error: unknown) => {
        status.textContent =
          error instanceof Error ? error.message : String(error);
      });
  });
  void refreshDetached().catch(() => {
    status.textContent = "Local recovery copies are unavailable";
  });
  void loadSession().catch((error: unknown) => {
    status.textContent = error instanceof Error ? error.message : String(error);
  });

  return {
    setViewingHosted(value) {
      viewingHosted = value;
      refreshCompareAvailability();
      copyButton.disabled = !value;
      if (value) picker.open = true;
      void refreshDetached();
    },
  };
}
