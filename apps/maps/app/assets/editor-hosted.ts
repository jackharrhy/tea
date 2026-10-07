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
import { initHostedArtbin } from "./editor-hosted-artbin.ts";
import {
  createHostedMap,
  createHostedProject,
} from "./editor-hosted-create.ts";
import {
  listHostedResources,
  removeHostedResource,
  resourceUploads,
  uploadHostedResource,
} from "./editor-hosted-resources.ts";
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
  const resources = document.querySelector<HTMLDetailsElement>(
    "#hosted-project-resources",
  )!;
  const resourceStatus = document.querySelector<HTMLElement>(
    "#hosted-resource-status",
  )!;
  const resourceList = document.querySelector<HTMLUListElement>(
    "#hosted-resource-list",
  )!;
  const resourceUpload = document.querySelector<HTMLElement>(
    "#hosted-resource-upload",
  )!;
  const resourceFiles = document.querySelector<HTMLInputElement>(
    "#hosted-resource-files",
  )!;
  const resourceFolder = document.querySelector<HTMLInputElement>(
    "#hosted-resource-folder",
  )!;
  const uploadFilesButton = document.querySelector<HTMLButtonElement>(
    "#hosted-resource-upload-button",
  )!;
  const uploadFolderButton = document.querySelector<HTMLButtonElement>(
    "#hosted-resource-folder-button",
  )!;
  resourceFolder.setAttribute("webkitdirectory", "");
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

  async function refreshResources(project: HostedProject, version: number) {
    resourceStatus.textContent = "Loading project resources";
    const mounts = await listHostedResources(project.id);
    if (version !== requestVersion) return;
    resourceList.replaceChildren();
    const uniqueBytes = new Map(
      mounts.map((mount) => [mount.expectedSha256, mount.size]),
    );
    const totalBytes = [...uniqueBytes.values()].reduce(
      (sum, size) => sum + size,
      0,
    );
    resourceStatus.textContent = `${mounts.length} resources · ${Math.ceil(totalBytes / (1024 * 1024))} / 1024 MiB`;
    if (mounts.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "No project resources yet";
      resourceList.append(empty);
    }
    for (const mount of mounts) {
      const row = document.createElement("li");
      const link = document.createElement("a");
      link.href = `/api/projects/${encodeURIComponent(project.id)}/resources/${encodeURIComponent(mount.id)}/content`;
      link.download = mount.displayName;
      link.textContent = mount.displayName;
      const detail = document.createElement("small");
      detail.textContent = `${mount.kind} · ${Math.ceil(mount.size / 1024)} KiB`;
      row.append(link, detail);
      if (project.role === "owner") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${mount.displayName}`);
        remove.addEventListener("click", () => {
          remove.disabled = true;
          void removeHostedResource(project.id, mount.id)
            .then(async () => {
              options.resourcesChanged(project.id);
              if (currentProject?.id === project.id)
                await refreshResources(project, requestVersion);
            })
            .catch((error: unknown) => {
              resourceStatus.textContent =
                error instanceof Error ? error.message : String(error);
              remove.disabled = false;
            });
        });
        row.append(remove);
      }
      resourceList.append(row);
    }
  }

  const artbin = initHostedArtbin({
    async mounted(projectId) {
      options.resourcesChanged(projectId);
      if (currentProject?.id === projectId)
        await refreshResources(currentProject, requestVersion);
    },
  });

  function uploadResources(folder: boolean) {
    const project = currentProject;
    if (!project || project.role !== "owner" || project.id !== projects.value)
      return;
    const input = folder ? resourceFolder : resourceFiles;
    const files = [...(input.files ?? [])];
    if (files.length === 0) return;
    let uploads: ReturnType<typeof resourceUploads>;
    try {
      uploads = resourceUploads(files, folder);
    } catch (error) {
      resourceStatus.textContent =
        error instanceof Error ? error.message : String(error);
      return;
    }
    uploadFilesButton.disabled = true;
    uploadFolderButton.disabled = true;
    void (async () => {
      try {
        for (const [index, upload] of uploads.entries()) {
          resourceStatus.textContent = `Uploading ${index + 1} of ${uploads.length}: ${upload.name}`;
          await uploadHostedResource(project.id, upload);
        }
        input.value = "";
        options.resourcesChanged(project.id);
        if (currentProject?.id === project.id) {
          await refreshResources(project, requestVersion);
          resourceStatus.textContent += ` · uploaded ${uploads.length}`;
        }
      } catch (error) {
        resourceStatus.textContent =
          error instanceof Error ? error.message : String(error);
      } finally {
        uploadFilesButton.disabled = false;
        uploadFolderButton.disabled = false;
      }
    })();
  }

  login.href = `/auth/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
  if (initialMap || initialProject) picker.open = true;

  async function loadProject(projectId: string, selectedMap?: string) {
    const version = ++requestVersion;
    currentProject = null;
    access.setProject(null);
    artbin.setProject(null);
    mapCreate.hidden = true;
    resources.hidden = true;
    resourceList.replaceChildren();
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
    artbin.setProject(response.project);
    resources.hidden = false;
    resourceUpload.hidden = response.project.role !== "owner";
    void refreshResources(response.project, version).catch((error: unknown) => {
      if (version === requestVersion)
        resourceStatus.textContent =
          error instanceof Error ? error.message : String(error);
    });
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
  uploadFilesButton.addEventListener("click", () => uploadResources(false));
  uploadFolderButton.addEventListener("click", () => uploadResources(true));
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
