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
                <ViewerDiagnosticsPanel />
                <ViewerCameraPanel />
                <ViewerMovementPanel />
                <ViewerOverviewPanel />
                <ViewerWalkabilityPanel />
                <ViewerAudioPanel />
              </div>
            </details>
            <HostedViewerPanel />
          </aside>
          <section class="viewport-panel" aria-label="Map viewer">
            <ViewerToolbar />
            <div id="viewport" class="viewport">
              <div id="reticle" class="reticle" aria-hidden="true" hidden></div>
              <ViewerDropTarget />
            </div>
          </section>
        </main>
        <script type="module" src={browserAssets.viewer}></script>
        <script type="module" src={browserAssets.entry}></script>
      </body>
    </html>
  );
}
