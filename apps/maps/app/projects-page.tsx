import type { Handle } from "remix/component";
import { browserAssets } from "./assets/build-manifest.ts";
import { projectsStyles } from "./projects-styles.ts";
import {
  OpenLocalProject,
  RecentProjects,
  RecoveredMaps,
} from "./assets/recovered-maps.tsx";
import { HostedProjects } from "./assets/hosted-projects.tsx";
import { ProjectMaps } from "./assets/project-maps.tsx";
import { ProjectNewMap } from "./assets/project-new-map.tsx";
import { ProjectAccess } from "./assets/project-access-page.tsx";
import { ProjectResources } from "./assets/project-resources-page.tsx";

export function ProjectsPage(
  handle: Handle<{
    projectId?: string;
    section?: "maps" | "new-map" | "resources" | "access";
    createRequested?: boolean;
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
        <main id="projects-app">
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
          </header>
          <div class="projects-content">
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
                  <HostedProjects
                    createRequested={handle.props.createRequested ?? false}
                  />
                  <section aria-labelledby="local-projects-title">
                    <h2 id="local-projects-title">Recent local projects</h2>
                    <OpenLocalProject />
                    <RecentProjects />
                    <h3>Recovered maps</h3>
                    <RecoveredMaps />
                    <p class="projects-note">
                      Project folders stay on this device. You can also{" "}
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
              <ProjectResources projectId={handle.props.projectId} />
            )}
          </div>
        </main>
        <script type="module" src={browserAssets.entry}></script>
      </body>
    </html>
  );
}
