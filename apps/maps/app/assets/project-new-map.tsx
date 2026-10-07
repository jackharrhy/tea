import {
  HostedProjectResponseSchema,
  HostedSessionResponseSchema,
  type HostedProject,
} from "@tea/maps-protocol";
import { clientEntry, on, type Handle } from "remix/component";
import { createHostedMap } from "./editor-hosted-create.ts";
import { readHostedApi } from "./hosted-api.ts";
import { ProjectDetailHeader } from "./project-detail-header.tsx";

export const ProjectNewMap = clientEntry(
  `${import.meta.url}#ProjectNewMap`,
  function ProjectNewMapComponent(handle: Handle<{ projectId: string }>) {
    let project: HostedProject | null = null;
    let signInRequired = false;
    let creating = false;
    let status = "Loading project…";

    handle.queueTask(() => {
      void (async () => {
        try {
          const session = await readHostedApi(
            "/api/session",
            HostedSessionResponseSchema,
          );
          if (!session.user) {
            signInRequired = true;
            status = "Sign in to open this project";
          } else {
            const response = await readHostedApi(
              `/api/projects/${encodeURIComponent(handle.props.projectId)}`,
              HostedProjectResponseSchema,
            );
            project = response.project;
            document.title = `${project.name} · Maps · Tea`;
            status =
              project.role === "viewer"
                ? "Editor access required to create a map"
                : "";
          }
        } catch (cause) {
          status = message(cause);
        }
        handle.update();
      })();
    });

    async function submit(event: Event) {
      event.preventDefault();
      if (!project || project.role === "viewer" || creating) return;
      const form = event.currentTarget as HTMLFormElement;
      const data = new FormData(form);
      const sourceFile =
        form.querySelector<HTMLInputElement>("#project-map-file")?.files?.[0] ??
        null;
      creating = true;
      status = "Creating hosted map";
      handle.update();
      try {
        const map = await createHostedMap(
          project.id,
          project.game,
          String(data.get("name") ?? ""),
          String(data.get("format") ?? "valve-220"),
          sourceFile,
        );
        location.href = `/editor?hostedMap=${encodeURIComponent(map.id)}`;
      } catch (cause) {
        creating = false;
        status = message(cause);
        handle.update();
      }
    }

    return () => (
      <section class="project-detail">
        <p id="projects-status" role="status">
          {status}
        </p>
        {signInRequired ? (
          <a
            id="projects-login"
            href={`/auth/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
            data-rmx-document
          >
            Sign in
          </a>
        ) : null}
        {project ? (
          <div>
            <ProjectDetailHeader project={project} section="new-map" />
            <section id="project-map-create" hidden={project.role === "viewer"}>
              <h2>New map</h2>
              <form
                id="project-map-create-form"
                mix={on<HTMLFormElement>("submit", submit)}
              >
                <label for="project-map-name">Map name</label>
                <input
                  id="project-map-name"
                  name="name"
                  defaultValue="untitled.map"
                  required
                  maxLength={120}
                />
                <label for="project-map-format">Format</label>
                <select
                  id="project-map-format"
                  name="format"
                  defaultValue="valve-220"
                >
                  <option value="valve-220">Valve 220</option>
                  <option value="quake" hidden={project.game !== "quake"}>
                    Classic Quake
                  </option>
                </select>
                <label for="project-map-file">
                  Existing .map file (optional)
                </label>
                <input
                  id="project-map-file"
                  type="file"
                  accept=".map,text/plain"
                />
                <button type="submit" disabled={creating}>
                  Create map
                </button>
              </form>
            </section>
          </div>
        ) : null}
      </section>
    );
  },
);

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
