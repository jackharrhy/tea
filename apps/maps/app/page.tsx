import { browserAssets } from "./assets/build-manifest.ts";
import { mapsStyles } from "./styles.ts";
import { HostedViewerPanel } from "./assets/hosted-viewer-panel.tsx";
import { ViewerSourcePanel } from "./assets/viewer-source-panel.tsx";
import { ViewerCameraPanel } from "./assets/viewer-camera-panel.tsx";
import { ViewerMovementPanel } from "./assets/viewer-movement-panel.tsx";
import { ViewerOverviewPanel } from "./assets/viewer-overview-panel.tsx";
import { ViewerWalkabilityPanel } from "./assets/viewer-walkability-panel.tsx";
import { ViewerAudioPanel } from "./assets/viewer-audio-panel.tsx";

export function MapsPage() {
  return () => (
    <html lang="en" mix={mapsStyles}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#10221c" />
        <title>Maps · Tea</title>
        <link rel="icon" href="/favicon.svg" />
      </head>
      <body>
        <main class="shell">
          <aside class="sidebar">
            <a class="brand" href="/">
              tea/maps
            </a>
            <a href="/editor">Open map editor →</a>
            <a href="/new-map">Create local map →</a>
            <a href="/projects">Projects →</a>
            <h1>Explore a map</h1>
            <p>
              Open a BSP with its WADs and other assets, or load a hosted map by
              URL.
            </p>
            <ViewerSourcePanel />
            <details class="inspector" open>
              <summary>Map tools</summary>
              <div class="inspector-body">
                <section aria-label="Map details">
                  <h2>Map details</h2>
                  <output id="map-details">Load a map to inspect it</output>
                  <output id="map-warnings" class="hint"></output>
                </section>
                <section aria-label="Entity support">
                  <details class="entity-support">
                    <summary>Entity support</summary>
                    <output id="entity-counts">
                      Load a map to inspect entities
                    </output>
                    <ul id="entity-classes"></ul>
                  </details>
                </section>
                <ViewerCameraPanel />
                <ViewerMovementPanel />
                <ViewerOverviewPanel />
                <ViewerWalkabilityPanel />
                <ViewerAudioPanel />
                <output id="map-tool-status" role="status"></output>
              </div>
            </details>
            <HostedViewerPanel />
          </aside>
          <section class="viewport-panel" aria-label="Map viewer">
            <div class="toolbar">
              <strong id="map-name">No map open</strong>
              <span id="viewer-status" role="status">
                Choose a map to begin
              </span>
            </div>
            <div id="viewport" class="viewport">
              <div id="reticle" class="reticle" aria-hidden="true" hidden></div>
              <div id="drop-target" class="drop-target" role="status" hidden>
                Drop a BSP with its map assets
              </div>
            </div>
          </section>
        </main>
        <script type="module" src={browserAssets.viewer}></script>
        <script type="module" src={browserAssets.entry}></script>
      </body>
    </html>
  );
}
