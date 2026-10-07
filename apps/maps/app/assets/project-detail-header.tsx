import type { HostedProject } from "@tea/maps-protocol";
import type { Handle } from "remix/component";

const gameNames = {
  quake: "Quake",
  goldsrc: "GoldSrc",
  gower: "Gower Complex",
};

export function ProjectDetailHeader(
  handle: Handle<{
    project: HostedProject;
    section: "maps" | "new-map" | "resources" | "access";
  }>,
) {
  return () => {
    const { project, section } = handle.props;
    const projectPath = `/projects/${encodeURIComponent(project.id)}`;
    return (
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
            href={projectPath}
            aria-current={section === "maps" ? "page" : undefined}
            data-rmx-document
          >
            Maps
          </a>
          <a
            href={`${projectPath}/resources`}
            aria-current={section === "resources" ? "page" : undefined}
            data-rmx-document
          >
            Resources
          </a>
          {project.role === "owner" ? (
            <a
              id="project-access-tab"
              href={`${projectPath}/access`}
              aria-current={section === "access" ? "page" : undefined}
              data-rmx-document
            >
              Access
            </a>
          ) : null}
          {project.role !== "viewer" ? (
            <a
              id="project-new-map-tab"
              href={`${projectPath}/new-map`}
              aria-current={section === "new-map" ? "page" : undefined}
              data-rmx-document
            >
              New map
            </a>
          ) : null}
        </nav>
      </div>
    );
  };
}
