import { browserAssets } from "./assets/build-manifest.ts";
import { projectsStyles } from "./projects-styles.ts";

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
            <form action="/editor" method="get" id="new-map-form">
              <input type="hidden" name="newMap" value="1" />
              <label for="new-map-name">Map name</label>
              <input
                id="new-map-name"
                name="name"
                value="untitled.map"
                required
                maxLength={120}
                autoFocus
              />
              <label for="new-map-game">Game</label>
              <select id="new-map-game" name="game">
                <option value="quake">Quake</option>
                <option value="goldsrc">GoldSrc</option>
                <option value="quake2">Quake II</option>
                <option value="gower">Gower Complex</option>
              </select>
              <label for="new-map-format">Map format</label>
              <select id="new-map-format" name="format">
                <option value="valve-220">Valve 220</option>
                <option value="quake">Classic Quake</option>
              </select>
              <p id="new-map-game-description" class="projects-note" />
              <button type="submit">Open editor</button>
            </form>
          </section>
        </main>
        <script type="module" src={browserAssets.newMap}></script>
      </body>
    </html>
  );
}
