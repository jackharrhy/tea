import {
  HostedProjectsResponseSchema,
  HostedSessionResponseSchema,
  type HostedProjectSummary,
} from "@tea/maps-protocol";
import { clientEntry, on, type Handle } from "remix/component";
import { createHostedProject } from "./editor-hosted-create.ts";
import { readHostedApi } from "./hosted-api.ts";

const gameNames = {
  quake: "Quake",
  goldsrc: "GoldSrc",
  gower: "Gower Complex",
};

export const HostedProjects = clientEntry(
  `${import.meta.url}#HostedProjects`,
  function HostedProjectsComponent(handle: Handle) {
    let projects: readonly HostedProjectSummary[] | null = null;
    let signedInName: string | null = null;
    let signInRequired = false;
    let creating = false;
    let status = "Loading projects…";

    handle.queueTask(() => {
      void (async () => {
        try {
          const session = await readHostedApi(
            "/api/session",
            HostedSessionResponseSchema,
          );
          if (!session.user) {
            signInRequired = true;
            status = "Sign in to browse hosted projects";
          } else {
            signedInName = session.user.displayName;
            const response = await readHostedApi(
              "/api/projects",
              HostedProjectsResponseSchema,
            );
            projects = response.projects;
            status = `Signed in as ${signedInName}`;
          }
        } catch (cause) {
          status = `Hosted projects are unavailable: ${message(cause)}`;
        }
        handle.update();
      })();
    });

    async function createProject(event: Event) {
      event.preventDefault();
      if (creating) return;
      const data = new FormData(event.currentTarget as HTMLFormElement);
      creating = true;
      status = "Creating hosted project";
      handle.update();
      try {
        const project = await createHostedProject(
          String(data.get("name") ?? ""),
          String(data.get("game") ?? "quake"),
        );
        location.href = `/projects/${encodeURIComponent(project.id)}`;
      } catch (cause) {
        creating = false;
        status = message(cause);
        handle.update();
      }
    }

    return () => (
      <section aria-labelledby="hosted-projects-title">
        <h2 id="hosted-projects-title">Hosted projects</h2>
        <p id="projects-status" role="status">
          {status}
        </p>
        {signInRequired ? (
          <a
            id="projects-login"
            href="/auth/login?returnTo=%2Fprojects"
            data-rmx-document
          >
            Sign in
          </a>
        ) : null}
        <div id="hosted-projects-list" class="project-list">
          {projects === null
            ? null
            : projects.length === 0
              ? "No hosted projects yet"
              : projects.map((project) => (
                  <a
                    class="project-row"
                    href={`/projects/${encodeURIComponent(project.id)}`}
                    data-rmx-document
                  >
                    <strong>{project.name}</strong>
                    <small>
                      {gameNames[project.game]} · {project.role}
                    </small>
                  </a>
                ))}
        </div>
        {signedInName ? (
          <details id="projects-create">
            <summary>Create hosted project</summary>
            <form
              id="projects-create-form"
              mix={on<HTMLFormElement>("submit", createProject)}
            >
              <label for="projects-create-name">Project name</label>
              <input
                id="projects-create-name"
                name="name"
                required
                maxLength={120}
              />
              <label for="projects-create-game">Game</label>
              <select id="projects-create-game" name="game">
                <option value="quake">Quake</option>
                <option value="goldsrc">GoldSrc</option>
                <option value="gower">Gower Complex</option>
              </select>
              <button type="submit" disabled={creating}>
                Create project
              </button>
            </form>
          </details>
        ) : null}
      </section>
    );
  },
);

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
