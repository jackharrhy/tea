import { browserAssets } from "./assets/build-manifest.ts";
import { mapsStyles } from "./styles.ts";
import { HostedViewerPanel } from "./assets/hosted-viewer-panel.tsx";
import { ViewerSourcePanel } from "./assets/viewer-source-panel.tsx";
import { ViewerCameraPanel } from "./assets/viewer-camera-panel.tsx";
import { ViewerMovementPanel } from "./assets/viewer-movement-panel.tsx";

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
                <section aria-label="Map overview">
                  <h2>Overview</h2>
                  <label for="overview-size">Image size</label>
                  <select id="overview-size">
                    <option value="512">512 × 512</option>
                    <option value="1024" selected>
                      1024 × 1024
                    </option>
                    <option value="1024x768">1024 × 768</option>
                    <option value="2048">2048 × 2048</option>
                  </select>
                  <label for="overview-lighting">Lighting</label>
                  <select id="overview-lighting">
                    <option value="lightmapped">Lightmapped</option>
                    <option value="fullbright">Fullbright</option>
                  </select>
                  <label for="overview-rotation">Rotation</label>
                  <select id="overview-rotation">
                    <option value="auto">Auto</option>
                    <option value="0">0°</option>
                    <option value="90">90°</option>
                  </select>
                  <label class="toggle" for="overview-cutaway">
                    <input id="overview-cutaway" type="checkbox" checked />
                    Auto cutaway with walkability graph
                  </label>
                  <label for="overview-z-min">Lower height</label>
                  <input id="overview-z-min" type="number" step="1" disabled />
                  <label for="overview-z-max">Upper height</label>
                  <input id="overview-z-max" type="number" step="1" disabled />
                  <label class="toggle" for="overview-transparent">
                    <input id="overview-transparent" type="checkbox" checked />
                    Transparent background
                  </label>
                  <output id="overview-status" class="hint">
                    Load a map to export
                  </output>
                  <button id="download-overview" type="button" disabled>
                    Download overview
                  </button>
                </section>
                <section aria-label="Walkability graph">
                  <h2>Walkability</h2>
                  <label for="walkability-spacing">Sample spacing</label>
                  <input
                    id="walkability-spacing"
                    type="number"
                    min="8"
                    max="128"
                    step="1"
                    value="32"
                  />
                  <label class="toggle" for="walkability-jumps">
                    <input id="walkability-jumps" type="checkbox" checked />
                    Probe jumps
                  </label>
                  <button id="generate-walkability" type="button" disabled>
                    Generate graph
                  </button>
                  <label class="toggle" for="show-walkability">
                    <input id="show-walkability" type="checkbox" disabled />
                    Show graph
                  </label>
                  <output id="walkability-details">No graph loaded</output>
                  <button id="download-walkability" type="button" disabled>
                    Download sidecar
                  </button>
                  <label for="walkability-file">Load sidecar</label>
                  <input
                    id="walkability-file"
                    type="file"
                    accept=".json,application/json"
                    disabled
                  />
                  <button id="clear-walkability" type="button" disabled>
                    Clear graph
                  </button>
                </section>
                <section aria-label="Map audio">
                  <h2>Audio</h2>
                  <output id="audio-details">Load a map to enable sound</output>
                  <output id="audio-room" class="hint">
                    Room: —
                  </output>
                  <button id="enable-audio" type="button" disabled>
                    Enable sound
                  </button>
                  <label class="toggle" for="mute-audio">
                    <input id="mute-audio" type="checkbox" disabled />
                    Mute
                  </label>
                  <label for="audio-volume">Volume</label>
                  <input
                    id="audio-volume"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value="0.8"
                    disabled
                  />
                  <label for="player-volume">Footstep volume</label>
                  <input
                    id="player-volume"
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value="1"
                    disabled
                  />
                  <label for="music-volume">Music volume</label>
                  <input
                    id="music-volume"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value="1"
                    disabled
                  />
                  <label for="music-track">Music track</label>
                  <select id="music-track" disabled>
                    <option value="">No map music</option>
                  </select>
                  <output id="music-status" class="hint">
                    No map music
                  </output>
                  <button id="play-music" type="button" disabled>
                    Play music
                  </button>
                  <button id="stop-music" type="button" disabled>
                    Stop music
                  </button>
                </section>
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
