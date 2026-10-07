import {
  HostedProjectResponseSchema,
  HostedSessionResponseSchema,
  type HostedProject,
} from "@tea/maps-protocol";
import { clientEntry, on, type Handle } from "remix/component";
import { readHostedApi } from "./hosted-api.ts";
import { openLinkedLocalProject } from "./project-local.ts";

const gameNames = {
  quake: "Quake",
  goldsrc: "GoldSrc",
  gower: "Gower Complex",
};

export const ProjectMaps = clientEntry(
  `${import.meta.url}#ProjectMaps`,
  function ProjectMapsComponent(handle: Handle<{ projectId: string }>) {
    let project: HostedProject | null = null;
    let signInRequired = false;
    let openingLocal = false;
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
            status = "";
          }
        } catch (cause) {
          status = message(cause);
        }
        handle.update();
      })();
    });

    async function openLocalProject() {
      if (!project || openingLocal) return;
      openingLocal = true;
      status = "";
      handle.update();
      try {
        const recentId = await openLinkedLocalProject(project);
        if (recentId)
          location.href = `/editor?recentProject=${encodeURIComponent(recentId)}`;
      } catch (cause) {
        status = message(cause);
      } finally {
        openingLocal = false;
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
            <a href="/projects" data-rmx-document>
              ← All projects
            </a>
            <div class="project-title">
              <div>
                <h1 id="project-name">{project.name}</h1>
                <p id="project-meta">
                  {gameNames[project.game]} · {project.role}
                </p>
              </div>
              <a
                id="project-manage"
                href={`/editor?hostedProject=${encodeURIComponent(project.id)}`}
                data-rmx-document
              >
                Manage in editor
              </a>
            </div>
            <nav class="project-tabs" aria-label="Project pages">
              <a
                href={`/projects/${encodeURIComponent(project.id)}`}
                aria-current="page"
                data-rmx-document
              >
                Maps
              </a>
              <a
                href={`/projects/${encodeURIComponent(project.id)}/resources`}
                data-rmx-document
              >
                Resources
              </a>
              {project.role === "owner" ? (
                <a
                  id="project-access-tab"
                  href={`/projects/${encodeURIComponent(project.id)}/access`}
                  data-rmx-document
                >
                  Access
                </a>
              ) : null}
              {project.role !== "viewer" ? (
                <a
                  id="project-new-map-tab"
                  href={`/projects/${encodeURIComponent(project.id)}/new-map`}
                  data-rmx-document
                >
                  New map
                </a>
              ) : null}
              <button
                id="project-open-local"
                type="button"
                disabled={openingLocal}
                mix={on("click", () => void openLocalProject())}
              >
                Open local project
              </button>
            </nav>
            <h2>Maps</h2>
            <div id="project-maps-list" class="project-list">
              {project.maps.length === 0
                ? "No maps in this project yet"
                : project.maps.map((map) => (
                    <div class="project-row">
                      <strong>{map.name}</strong>
                      <small>
                        {map.format === "quake" ? "Classic Quake" : "Valve 220"}
                      </small>
                      <div class="project-actions">
                        <a
                          href={`/editor?hostedMap=${encodeURIComponent(map.id)}`}
                          data-rmx-document
                        >
                          Open in editor
                        </a>
                        <a
                          href={`/?hostedProject=${encodeURIComponent(handle.props.projectId)}&hostedMap=${encodeURIComponent(map.id)}`}
                          data-rmx-document
                        >
                          View a build
                        </a>
                      </div>
                    </div>
                  ))}
            </div>
          </div>
        ) : null}
      </section>
    );
  },
);

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
