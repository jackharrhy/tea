import type { Handle } from "remix/component";
import { browserAssets } from "./assets/build-manifest.ts";
import { projectsStyles } from "./projects-styles.ts";
import { RecentProjects, RecoveredMaps } from "./assets/recovered-maps.tsx";
import { HostedProjects } from "./assets/hosted-projects.tsx";
import { ProjectMaps } from "./assets/project-maps.tsx";
import { ProjectNewMap } from "./assets/project-new-map.tsx";
import { ProjectAccess } from "./assets/project-access-page.tsx";

export function ProjectsPage(
  handle: Handle<{
    projectId?: string;
    section?: "maps" | "new-map" | "resources" | "access";
  }>,
) {
  return () => (
    <html lang="en" mix={projectsStyles}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#10221c" />
        <title>Projects · Maps · Tea</title>
        <link rel="icon" href="/favicon.svg" />
      </head>
      <body>
        <main
          id="projects-app"
          data-project-id={handle.props.projectId ?? ""}
          data-section={handle.props.section ?? "maps"}
        >
          <header class="projects-header">
            <a class="projects-brand" href="/" data-rmx-document>
              tea/maps
            </a>
            <nav aria-label="Maps pages">
              <a href="/" data-rmx-document>
                Viewer
              </a>
              <a href="/editor" data-rmx-document>
                Editor
              </a>
              <a
                href="/projects"
                data-rmx-document
                aria-current={handle.props.projectId ? undefined : "page"}
              >
                Projects
              </a>
            </nav>
            {handle.props.projectId && handle.props.section === "resources" ? (
              <a
                id="projects-login"
                href="/auth/login?returnTo=/projects"
                data-rmx-document
                hidden
              >
                Sign in
              </a>
            ) : null}
          </header>
          <div class="projects-content">
            {handle.props.projectId && handle.props.section === "resources" ? (
              <p id="projects-status" role="status">
                Loading projects…
              </p>
            ) : null}
            {!handle.props.projectId ? (
              <>
                <section class="projects-intro">
                  <h1>Projects</h1>
                  <p>
                    Open hosted maps or return to a local project on this
                    device.
                  </p>
                </section>
                <div class="projects-columns">
                  <HostedProjects />
                  <section aria-labelledby="local-projects-title">
                    <h2 id="local-projects-title">Recent local projects</h2>
                    <RecentProjects />
                    <h3>Recovered maps</h3>
                    <RecoveredMaps />
                    <p class="projects-note">
                      Project folders stay on this device. Open a folder from
                      the editor, or{" "}
                      <a href="/new-map" data-rmx-document>
                        create a local map
                      </a>
                      .
                    </p>
                  </section>
                </div>
              </>
            ) : !handle.props.section || handle.props.section === "maps" ? (
              <ProjectMaps projectId={handle.props.projectId} />
            ) : handle.props.section === "new-map" ? (
              <ProjectNewMap projectId={handle.props.projectId} />
            ) : handle.props.section === "access" ? (
              <ProjectAccess projectId={handle.props.projectId} />
            ) : (
              <section class="project-detail">
                <a href="/projects" data-rmx-document>
                  ← All projects
                </a>
                <div class="project-title">
                  <div>
                    <h1 id="project-name">Project</h1>
                    <p id="project-meta" />
                  </div>
                  <a
                    id="project-manage"
                    href={`/editor?hostedProject=${handle.props.projectId}`}
                    data-rmx-document
                  >
                    Manage in editor
                  </a>
                </div>
                <nav class="project-tabs" aria-label="Project pages">
                  <a
                    href={`/projects/${handle.props.projectId}`}
                    data-rmx-document
                  >
                    Maps
                  </a>
                  <a
                    href={`/projects/${handle.props.projectId}/resources`}
                    data-rmx-document
                    aria-current={
                      handle.props.section === "resources" ? "page" : undefined
                    }
                  >
                    Resources
                  </a>
                  <a
                    id="project-access-tab"
                    href={`/projects/${handle.props.projectId}/access`}
                    data-rmx-document
                    hidden
                  >
                    Access
                  </a>
                  <a
                    id="project-new-map-tab"
                    href={`/projects/${handle.props.projectId}/new-map`}
                    data-rmx-document
                    hidden
                  >
                    New map
                  </a>
                </nav>
                {handle.props.section === "resources" ? (
                  <>
                    <h2>Resources</h2>
                    <p>Project members can download mounted resources.</p>
                    <p id="project-resource-status" role="status" />
                    <div id="project-resource-list" class="project-list" />
                    <section id="project-resource-upload" hidden>
                      <label for="project-resource-files">
                        Upload resources
                      </label>
                      <input
                        id="project-resource-files"
                        type="file"
                        multiple
                        accept=".wad,.lmp,.pcx,.fgd,.def,.ent,.spr"
                      />
                      <button id="project-resource-upload-button" type="button">
                        Upload files
                      </button>
                      <label for="project-resource-folder">
                        Game asset folder
                      </label>
                      <input
                        id="project-resource-folder"
                        type="file"
                        multiple
                      />
                      <button id="project-resource-folder-button" type="button">
                        Upload folder
                      </button>
                    </section>
                    <section
                      id="hosted-artbin-import"
                      class="project-artbin"
                      hidden
                    >
                      <h3>Import from Artbin</h3>
                      <form id="hosted-artbin-search">
                        <label for="hosted-artbin-query">Search assets</label>
                        <input
                          id="hosted-artbin-query"
                          type="search"
                          placeholder="WAD, palette, texture…"
                        />
                        <button type="submit">Search Artbin</button>
                      </form>
                      <p id="hosted-artbin-status" role="status" />
                      <ul id="hosted-artbin-results" class="project-list" />
                      <button id="hosted-artbin-next" type="button" hidden>
                        Load more
                      </button>
                    </section>
                  </>
                ) : null}
              </section>
            )}
          </div>
        </main>
        {!handle.props.projectId ||
        !handle.props.section ||
        handle.props.section === "maps" ||
        handle.props.section === "new-map" ||
        handle.props.section === "access" ? (
          <script type="module" src={browserAssets.entry}></script>
        ) : (
          <script type="module" src={browserAssets.projects}></script>
        )}
      </body>
    </html>
  );
}
