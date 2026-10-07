import type { Handle } from "remix/component";
import { browserAssets } from "./assets/build-manifest.ts";
import { projectsStyles } from "./projects-styles.ts";
import { RecoveredMaps } from "./assets/recovered-maps.tsx";

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
            <a
              id="projects-login"
              href="/auth/login?returnTo=/projects"
              data-rmx-document
              hidden
            >
              Sign in
            </a>
          </header>
          <div class="projects-content">
            <p id="projects-status" role="status">
              Loading projects…
            </p>
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
                  <section aria-labelledby="hosted-projects-title">
                    <h2 id="hosted-projects-title">Hosted projects</h2>
                    <div id="hosted-projects-list" class="project-list" />
                    <details id="projects-create" hidden>
                      <summary>Create hosted project</summary>
                      <form id="projects-create-form">
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
                        <button type="submit">Create project</button>
                      </form>
                    </details>
                  </section>
                  <section aria-labelledby="local-projects-title">
                    <h2 id="local-projects-title">Recent local projects</h2>
                    <div id="local-projects-list" class="project-list" />
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
                    aria-current={
                      !handle.props.section || handle.props.section === "maps"
                        ? "page"
                        : undefined
                    }
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
                    aria-current={
                      handle.props.section === "access" ? "page" : undefined
                    }
                    hidden
                  >
                    Access
                  </a>
                  <a
                    id="project-new-map-tab"
                    href={`/projects/${handle.props.projectId}/new-map`}
                    data-rmx-document
                    aria-current={
                      handle.props.section === "new-map" ? "page" : undefined
                    }
                    hidden
                  >
                    New map
                  </a>
                  {!handle.props.section || handle.props.section === "maps" ? (
                    <button id="project-open-local" type="button">
                      Open local project
                    </button>
                  ) : null}
                </nav>
                {!handle.props.section || handle.props.section === "maps" ? (
                  <>
                    <h2>Maps</h2>
                    <div id="project-maps-list" class="project-list" />
                  </>
                ) : null}
                {handle.props.section === "new-map" ? (
                  <section id="project-map-create" hidden>
                    <h2>New map</h2>
                    <form id="project-map-create-form">
                      <label for="project-map-name">Map name</label>
                      <input
                        id="project-map-name"
                        name="name"
                        value="untitled.map"
                        required
                        maxLength={120}
                      />
                      <label for="project-map-format">Format</label>
                      <select id="project-map-format" name="format">
                        <option value="valve-220">Valve 220</option>
                        <option value="quake">Classic Quake</option>
                      </select>
                      <label for="project-map-file">
                        Existing .map file (optional)
                      </label>
                      <input
                        id="project-map-file"
                        type="file"
                        accept=".map,text/plain"
                      />
                      <button type="submit">Create map</button>
                    </form>
                  </section>
                ) : null}
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
                {handle.props.section === "access" ? (
                  <>
                    <h2>Access</h2>
                    <p>
                      Grant editor or viewer access to people who have signed in
                      to Maps.
                    </p>
                    <label for="project-access-search">Search people</label>
                    <input
                      id="project-access-search"
                      type="search"
                      autocomplete="off"
                    />
                    <p id="project-access-status" role="status" />
                    <div id="project-access-list" class="project-list" />
                  </>
                ) : null}
              </section>
            )}
          </div>
        </main>
        <script type="module" src={browserAssets.entry}></script>
        <script type="module" src={browserAssets.projects}></script>
      </body>
    </html>
  );
}
