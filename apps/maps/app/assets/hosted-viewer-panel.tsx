import {
  HostedBuildsResponseSchema,
  HostedProjectResponseSchema,
  HostedProjectsResponseSchema,
  HostedSessionResponseSchema,
  type HostedBuild,
  type HostedProjectMap,
  type HostedProjectSummary,
} from "@tea/maps-protocol";
import { clientEntry, on, type Handle } from "remix/component";
import { listHostedResources } from "./editor-hosted-resources.ts";
import { readHostedApi } from "./hosted-api.ts";
import { loadHostedWorldSource } from "./hosted-world-source.ts";
import { cameraFromUrlParameters } from "./remote-input.ts";

export const HostedViewerPanel = clientEntry(
  `${import.meta.url}#HostedViewerPanel`,
  function HostedViewerPanelComponent(handle: Handle) {
    let projects: readonly HostedProjectSummary[] = [];
    let maps: readonly HostedProjectMap[] = [];
    let builds: readonly HostedBuild[] = [];
    let projectId = "";
    let mapId = "";
    let buildId = "";
    let signedIn = false;
    let signedOut = false;
    let busy = false;
    let status = "Connecting to Maps service";
    let selectionVersion = 0;
    let initial: URLSearchParams;

    handle.queueTask(() => {
      initial = new URL(location.href).searchParams;
      void loadSession();
    });

    function showError(cause: unknown) {
      busy = false;
      status = cause instanceof Error ? cause.message : String(cause);
      handle.update();
    }

    async function loadBuilds(selectedMapId: string, preferredBuild?: string) {
      const version = ++selectionVersion;
      mapId = selectedMapId;
      buildId = "";
      builds = [];
      status = "Loading compiled builds";
      handle.update();
      const response = await readHostedApi(
        `/api/maps/${encodeURIComponent(selectedMapId)}/builds`,
        HostedBuildsResponseSchema,
      );
      if (version !== selectionVersion) return;
      builds = response.builds
        .filter(
          (build) =>
            build.status === "succeeded" &&
            build.result?.artifacts?.some(
              (artifact) => artifact.kind === "bsp",
            ),
        )
        .toSorted((left, right) => right.createdAt - left.createdAt);
      buildId = builds.some((build) => build.id === preferredBuild)
        ? preferredBuild!
        : (builds[0]?.id ?? "");
      status = builds.length
        ? "Choose a compiled build to view"
        : "No successful BSP build for this map yet";
      handle.update();
      if (preferredBuild && buildId === preferredBuild)
        void openSelectedBuild().catch(showError);
    }

    async function loadProject(
      selectedProjectId: string,
      preferredMap?: string,
      preferredBuild?: string,
    ) {
      const version = ++selectionVersion;
      projectId = selectedProjectId;
      mapId = "";
      buildId = "";
      maps = [];
      builds = [];
      status = "Loading project maps";
      handle.update();
      const response = await readHostedApi(
        `/api/projects/${encodeURIComponent(selectedProjectId)}`,
        HostedProjectResponseSchema,
      );
      if (version !== selectionVersion) return;
      maps = response.project.maps;
      mapId = maps.some((map) => map.id === preferredMap)
        ? preferredMap!
        : (maps[0]?.id ?? "");
      if (!mapId) {
        status = "This project has no maps yet";
        handle.update();
        return;
      }
      await loadBuilds(mapId, preferredBuild);
    }

    async function openSelectedBuild() {
      const build = builds.find((candidate) => candidate.id === buildId);
      const artifact = build?.result?.artifacts?.find(
        (candidate) => candidate.kind === "bsp",
      );
      if (!build || !artifact || !projectId || !mapId || busy) return;
      const version = selectionVersion;
      const selectedProjectId = projectId;
      const selectedMapId = mapId;
      busy = true;
      status = "Loading hosted project assets";
      handle.update();
      try {
        const path = `/api/maps/${encodeURIComponent(selectedMapId)}/builds/${encodeURIComponent(build.id)}/artifacts/${artifact.sha256}`;
        const mounts = await listHostedResources(selectedProjectId);
        const source = await loadHostedWorldSource(
          path,
          selectedProjectId,
          mounts,
        );
        if (
          version !== selectionVersion ||
          projectId !== selectedProjectId ||
          mapId !== selectedMapId ||
          buildId !== build.id
        )
          return;
        const camera =
          build.id === initial.get("hostedBuild")
            ? cameraFromUrlParameters(initial)
            : undefined;
        const label = `${maps.find((map) => map.id === mapId)?.name ?? "Map"} · ${build.quality}`;
        window.dispatchEvent(
          new CustomEvent("tea-maps-open-source", {
            detail: { source, label, camera },
          }),
        );
        const url = new URL(location.href);
        url.search = new URLSearchParams({
          hostedProject: projectId,
          hostedMap: mapId,
          hostedBuild: build.id,
          ...(camera ? { camera: initial.get("camera")! } : {}),
        }).toString();
        history.replaceState(null, "", url);
        initial.delete("hostedBuild");
      } finally {
        busy = false;
        handle.update();
      }
    }

    async function loadSession() {
      const version = ++selectionVersion;
      signedIn = false;
      signedOut = false;
      projects = [];
      maps = [];
      builds = [];
      projectId = "";
      mapId = "";
      buildId = "";
      status = "Connecting to Maps service";
      handle.update();
      try {
        const session = await readHostedApi(
          "/api/session",
          HostedSessionResponseSchema,
        );
        if (version !== selectionVersion) return;
        if (!session.user) {
          signedOut = true;
          status = "Sign in to browse hosted maps";
          handle.update();
          return;
        }
        signedIn = true;
        status = `Signed in as ${session.user.displayName}`;
        handle.update();
        const response = await readHostedApi(
          "/api/projects",
          HostedProjectsResponseSchema,
        );
        if (version !== selectionVersion) return;
        projects = response.projects;
        projectId = projects.some(
          (project) => project.id === initial.get("hostedProject"),
        )
          ? initial.get("hostedProject")!
          : (projects[0]?.id ?? "");
        if (!projectId) {
          status = "No hosted projects are available";
          handle.update();
          return;
        }
        await loadProject(
          projectId,
          initial.get("hostedMap") ?? undefined,
          initial.get("hostedBuild") ?? undefined,
        );
      } catch (cause) {
        showError(cause);
      }
    }

    async function logout() {
      try {
        const response = await fetch("/auth/logout", { method: "POST" });
        if (!response.ok)
          throw new Error(`Sign out failed (${response.status})`);
        await loadSession();
      } catch (cause) {
        showError(cause);
      }
    }

    return () => (
      <section class="hosted" aria-label="Hosted maps">
        <h2>Hosted maps</h2>
        <p id="hosted-status" role="status">
          {status}
        </p>
        {signedOut ? (
          <a
            id="hosted-login"
            href={`/auth/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
            data-rmx-document
          >
            Sign in to Maps
          </a>
        ) : null}
        {signedIn ? (
          <button
            id="hosted-logout"
            type="button"
            mix={on("click", () => void logout())}
          >
            Sign out
          </button>
        ) : null}
        <label for="hosted-project">Project</label>
        <select
          id="hosted-project"
          value={projectId}
          disabled={!projects.length}
          mix={on<HTMLSelectElement>("change", (event) => {
            void loadProject(event.currentTarget.value).catch(showError);
          })}
        >
          {projects.map((project) => (
            <option value={project.id}>{project.name}</option>
          ))}
        </select>
        <label for="hosted-map">Map</label>
        <select
          id="hosted-map"
          value={mapId}
          disabled={!maps.length}
          mix={on<HTMLSelectElement>("change", (event) => {
            void loadBuilds(event.currentTarget.value).catch(showError);
          })}
        >
          {maps.map((map) => (
            <option value={map.id}>{map.name}</option>
          ))}
        </select>
        <label for="hosted-build">Compiled build</label>
        <select
          id="hosted-build"
          value={buildId}
          disabled={!builds.length}
          mix={on<HTMLSelectElement>("change", (event) => {
            buildId = event.currentTarget.value;
            handle.update();
          })}
        >
          {builds.map((build) => (
            <option value={build.id}>
              {build.quality} · version {build.mapVersion}
            </option>
          ))}
        </select>
        <button
          id="hosted-open"
          type="button"
          disabled={!buildId || busy}
          mix={on("click", () => void openSelectedBuild().catch(showError))}
        >
          Open compiled map
        </button>
        <button
          id="hosted-inspect"
          type="button"
          disabled={!mapId}
          mix={on("click", () => {
            if (mapId)
              location.href = `/editor?hostedMap=${encodeURIComponent(mapId)}`;
          })}
        >
          Inspect map source
        </button>
        <p class="hint">
          Build artifacts are private to project members. A map needs a
          successful build before it can open here.
        </p>
      </section>
    );
  },
);
