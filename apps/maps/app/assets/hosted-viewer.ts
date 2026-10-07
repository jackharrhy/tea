import {
  HostedBuildsResponseSchema,
  HostedProjectResponseSchema,
  HostedProjectsResponseSchema,
  HostedSessionResponseSchema,
  type HostedBuild,
} from "@tea/maps-protocol";
import type { CameraState, WorldSource } from "@tea/maps-renderer";
import { readHostedApi } from "./hosted-api.ts";
import { listHostedResources } from "./editor-hosted-resources.ts";
import { loadHostedWorldSource } from "./hosted-world-source.ts";
import { cameraFromUrlParameters } from "./remote-input.ts";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clear(select: HTMLSelectElement) {
  select.replaceChildren();
  select.disabled = true;
}

export function initHostedViewer(
  open: (source: WorldSource, label: string, camera?: CameraState) => void,
  replaceQuery: (parameters: Record<string, string>) => void,
): void {
  const status = document.querySelector<HTMLElement>("#hosted-status")!;
  const login = document.querySelector<HTMLAnchorElement>("#hosted-login")!;
  const logout = document.querySelector<HTMLButtonElement>("#hosted-logout")!;
  const projects =
    document.querySelector<HTMLSelectElement>("#hosted-project")!;
  const maps = document.querySelector<HTMLSelectElement>("#hosted-map")!;
  const builds = document.querySelector<HTMLSelectElement>("#hosted-build")!;
  const openButton = document.querySelector<HTMLButtonElement>("#hosted-open")!;
  const inspectButton =
    document.querySelector<HTMLButtonElement>("#hosted-inspect")!;
  const initial = new URL(location.href).searchParams;
  const initialProject = initial.get("hostedProject");
  const initialMap = initial.get("hostedMap");
  const initialBuild = initial.get("hostedBuild");
  let requestedCamera = cameraFromUrlParameters(initial);
  let availableBuilds: HostedBuild[] = [];
  let selectionVersion = 0;

  login.href = `/auth/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`;

  function showError(error: unknown) {
    status.textContent = message(error);
  }

  async function loadBuilds(mapId: string, preferredBuild?: string) {
    const version = ++selectionVersion;
    clear(builds);
    openButton.disabled = true;
    status.textContent = "Loading compiled builds";
    const response = await readHostedApi(
      `/api/maps/${encodeURIComponent(mapId)}/builds`,
      HostedBuildsResponseSchema,
    );
    if (version !== selectionVersion) return;
    availableBuilds = response.builds
      .filter(
        (build) =>
          build.status === "succeeded" &&
          build.result?.artifacts?.some((artifact) => artifact.kind === "bsp"),
      )
      .toSorted((left, right) => right.createdAt - left.createdAt);
    for (const build of availableBuilds) {
      builds.add(
        new Option(`${build.quality} · version ${build.mapVersion}`, build.id),
      );
    }
    if (
      preferredBuild &&
      availableBuilds.some((build) => build.id === preferredBuild)
    ) {
      builds.value = preferredBuild;
    }
    builds.disabled = availableBuilds.length === 0;
    openButton.disabled = builds.disabled;
    status.textContent = availableBuilds.length
      ? "Choose a compiled build to view"
      : "No successful BSP build for this map yet";
    if (preferredBuild && builds.value === preferredBuild)
      void openSelectedBuild().catch(showError);
  }

  async function loadProject(
    projectId: string,
    preferredMap?: string,
    preferredBuild?: string,
  ) {
    const version = ++selectionVersion;
    clear(maps);
    clear(builds);
    openButton.disabled = true;
    inspectButton.disabled = true;
    status.textContent = "Loading project maps";
    const response = await readHostedApi(
      `/api/projects/${encodeURIComponent(projectId)}`,
      HostedProjectResponseSchema,
    );
    if (version !== selectionVersion) return;
    for (const map of response.project.maps)
      maps.add(new Option(map.name, map.id));
    if (
      preferredMap &&
      response.project.maps.some((map) => map.id === preferredMap)
    ) {
      maps.value = preferredMap;
    }
    maps.disabled = response.project.maps.length === 0;
    inspectButton.disabled = maps.disabled;
    if (maps.disabled) {
      status.textContent = "This project has no maps yet";
      return;
    }
    await loadBuilds(maps.value, preferredBuild);
  }

  async function openSelectedBuild() {
    const build = availableBuilds.find(
      (candidate) => candidate.id === builds.value,
    );
    const artifact = build?.result?.artifacts?.find(
      (item) => item.kind === "bsp",
    );
    if (!build || !artifact) return;
    const version = selectionVersion;
    const projectId = projects.value;
    const mapId = maps.value;
    openButton.disabled = true;
    status.textContent = "Loading hosted project assets";
    const path = `/api/maps/${encodeURIComponent(mapId)}/builds/${encodeURIComponent(build.id)}/artifacts/${artifact.sha256}`;
    const source = await listHostedResources(projectId)
      .then((mounts) => loadHostedWorldSource(path, projectId, mounts))
      .finally(() => {
        if (version === selectionVersion) openButton.disabled = false;
      });
    if (
      version !== selectionVersion ||
      projects.value !== projectId ||
      maps.value !== mapId ||
      builds.value !== build.id
    )
      return;
    const camera = build.id === initialBuild ? requestedCamera : undefined;
    requestedCamera = undefined;
    open(
      source,
      `${maps.selectedOptions[0]?.textContent ?? "Map"} · ${build.quality}`,
      camera,
    );
    replaceQuery({
      hostedProject: projects.value,
      hostedMap: maps.value,
      hostedBuild: build.id,
      ...(camera ? { camera: initial.get("camera")! } : {}),
    });
  }

  async function loadSession() {
    ++selectionVersion;
    clear(projects);
    clear(maps);
    clear(builds);
    openButton.disabled = true;
    inspectButton.disabled = true;
    login.hidden = true;
    logout.hidden = true;
    status.textContent = "Connecting to Maps service";
    const session = await readHostedApi(
      "/api/session",
      HostedSessionResponseSchema,
    );
    if (!session.user) {
      login.hidden = false;
      status.textContent = "Sign in to browse hosted maps";
      return;
    }
    logout.hidden = false;
    status.textContent = `Signed in as ${session.user.displayName}`;
    const response = await readHostedApi(
      "/api/projects",
      HostedProjectsResponseSchema,
    );
    for (const project of response.projects) {
      projects.add(new Option(project.name, project.id));
    }
    if (
      initialProject &&
      response.projects.some((project) => project.id === initialProject)
    ) {
      projects.value = initialProject;
    }
    projects.disabled = response.projects.length === 0;
    if (projects.disabled) {
      status.textContent = "No hosted projects are available";
      return;
    }
    await loadProject(
      projects.value,
      initialMap ?? undefined,
      initialBuild ?? undefined,
    );
  }

  projects.addEventListener("change", () => {
    void loadProject(projects.value).catch(showError);
  });
  maps.addEventListener("change", () => {
    void loadBuilds(maps.value).catch(showError);
  });
  openButton.addEventListener("click", () => {
    void openSelectedBuild().catch(showError);
  });
  inspectButton.addEventListener("click", () => {
    if (!maps.value) return;
    location.href = `/editor?hostedMap=${encodeURIComponent(maps.value)}`;
  });
  logout.addEventListener("click", async () => {
    try {
      const response = await fetch("/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error(`Sign out failed (${response.status})`);
      await loadSession();
    } catch (error) {
      showError(error);
    }
  });
  void loadSession().catch(showError);
}
