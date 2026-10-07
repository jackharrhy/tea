import { browserAssets } from "./assets/build-manifest.ts";
import { projectsStyles } from "./projects-styles.ts";
import { NewMapSetup } from "./assets/new-map-setup.tsx";

export function NewMapPage() {
  return () => (
    <html lang="en" mix={projectsStyles}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#10221c" />
        <title>New map · Maps · Tea</title>
        <link rel="icon" href="/favicon.svg" />
      </head>
      <body>
        <main class="projects-content">
          <header class="projects-header">
            <a class="projects-brand" href="/">
              tea/maps
            </a>
            <nav aria-label="Maps pages">
              <a href="/">Viewer</a>
              <a href="/projects">Projects</a>
              <a href="/editor">Editor</a>
            </nav>
          </header>
          <section class="project-detail">
            <h1>New local map</h1>
            <p>
              Choose a game and source format. Save the map to a file from the
              editor.
            </p>
            <NewMapSetup />
          </section>
        </main>
        <script type="module" src={browserAssets.entry}></script>
      </body>
    </html>
  );
}
