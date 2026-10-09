import { browserAssets } from "./assets/build-manifest.ts";
import { mapsStyles } from "./styles.ts";
import { HostedViewerPanel } from "./assets/hosted-viewer-panel.tsx";
import { ViewerSourcePanel } from "./assets/viewer-source-panel.tsx";
import { ViewerCameraPanel } from "./assets/viewer-camera-panel.tsx";
import { ViewerMovementPanel } from "./assets/viewer-movement-panel.tsx";
import { ViewerOverviewPanel } from "./assets/viewer-overview-panel.tsx";
import { ViewerWalkabilityPanel } from "./assets/viewer-walkability-panel.tsx";
import { ViewerAudioPanel } from "./assets/viewer-audio-panel.tsx";
import { ViewerDiagnosticsPanel } from "./assets/viewer-diagnostics-panel.tsx";
import { ViewerDropTarget, ViewerToolbar } from "./assets/viewer-chrome.tsx";

export function MapsPage() {
  return () => (
    <html lang="en" mix={mapsStyles}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#20221f" />
        <title>Viewer · Maps · Tea</title>
        <link rel="icon" href="/favicon.svg" />
        <link rel="stylesheet" href="/icons/style.css" />
      </head>
      <body>
        <main class="shell">
          <section class="viewport-panel" aria-label="Map viewer">
            <ViewerToolbar />
            <div id="viewport" class="viewport">
              <world-view controls="walk" />
              <div id="reticle" class="reticle" aria-hidden="true" hidden></div>
              <ViewerDropTarget />
            </div>
          </section>
          <nav class="viewer-nav" aria-label="Maps navigation">
            <a class="brand" href="/">
              tea<span>/</span>maps
            </a>
            <span>VIEWER</span>
            <a href="/editor">Editor</a>
            <a href="/projects">Projects</a>
          </nav>
          <aside class="viewer-dock" aria-label="Viewer controls">
            <header class="dock-header">
              <strong>MAP CONTROLS</strong>
              <span>TEA / MAPS</span>
            </header>
            <nav class="dock-tabs" aria-label="Control sections">
              <button
                type="button"
                data-dock-target="dock-open"
                aria-pressed="true"
              >
                Open
              </button>
              <button
                type="button"
                data-dock-target="dock-tools"
                aria-pressed="false"
              >
                Tools
              </button>
              <button
                type="button"
                data-dock-target="dock-hosted"
                aria-pressed="false"
              >
                Hosted
              </button>
            </nav>
            <div class="dock-scroll">
              <details
                id="dock-open"
                class="dock-section"
                name="viewer-dock"
                open
              >
                <summary>Open a map</summary>
                <div class="dock-section-body">
                  <ViewerSourcePanel />
                </div>
              </details>
              <details id="dock-tools" class="dock-section" name="viewer-dock">
                <summary>Map tools</summary>
                <div class="dock-section-body inspector-body">
                  <ViewerDiagnosticsPanel />
                  <ViewerCameraPanel />
                  <ViewerMovementPanel />
                  <ViewerOverviewPanel />
                  <ViewerWalkabilityPanel />
                  <ViewerAudioPanel />
                </div>
              </details>
              <details id="dock-hosted" class="dock-section" name="viewer-dock">
                <summary>Hosted maps</summary>
                <div class="dock-section-body">
                  <HostedViewerPanel />
                </div>
              </details>
            </div>
            <footer class="dock-footer">WASD / MOUSE TO EXPLORE</footer>
          </aside>
        </main>
        <script type="module" src={browserAssets.viewer}></script>
        <script type="module" src={browserAssets.entry}></script>
      </body>
    </html>
  );
}
