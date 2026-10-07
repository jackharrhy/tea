import { browserAssets } from "./assets/build-manifest.ts";
import { examples } from "./assets/examples.ts";
import { mapsStyles } from "./styles.ts";

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
            <form id="example-form">
              <label for="example">Explore an example</label>
              <select id="example" name="example">
                {examples
                  .filter((example) => example.selectable)
                  .map((example) => (
                    <option value={example.id}>{example.label}</option>
                  ))}
                <optgroup id="local-examples" label="Local fixtures"></optgroup>
              </select>
              <button type="submit">Open example</button>
              <p class="hint">Generated maps; no game files needed.</p>
              <p id="local-fixtures-status" class="hint" role="status"></p>
            </form>
            <form id="files-form">
              <label for="files">Local map and assets</label>
              <input
                id="files"
                name="files"
                type="file"
                multiple
                accept=".bsp,.wad,.lmp,.pal,.pcx,.wal,.spr,.wav,.mp3,.ogg,.tga,.png,.jpg,.jpeg"
              />
              <button type="submit">Open files</button>
              <p class="hint">
                Files stay in this browser. Include the map’s WADs for its
                textures.
              </p>
            </form>
            <form id="folder-form">
              <label for="folder">Local game folder</label>
              <input id="folder" type="file" multiple />
              <label for="folder-map">Map in folder</label>
              <select id="folder-map" disabled></select>
              <button id="folder-open" type="submit" disabled>
                Open folder map
              </button>
              <p id="folder-status" class="hint" role="status">
                Choose a game or mod folder containing maps and assets. Files
                stay in this browser.
              </p>
            </form>
            <form id="url-form">
              <label for="bsp-url">BSP URL</label>
              <input
                id="bsp-url"
                name="bsp"
                type="text"
                placeholder="https://example.com/maps/map.bsp"
                required
              />
              <label for="game-base-url">Game asset root (optional)</label>
              <input
                id="game-base-url"
                name="gameBase"
                type="text"
                placeholder="https://example.com/game/"
              />
              <details class="url-overrides">
                <summary>Asset overrides</summary>
                <div class="url-overrides-fields">
                  <label for="palette-url">Palette URL</label>
                  <input
                    id="palette-url"
                    type="text"
                    placeholder="gfx/palette.lmp"
                  />
                  <label for="wad-base-url">WAD base URL</label>
                  <input
                    id="wad-base-url"
                    type="text"
                    placeholder="https://example.com/wads/"
                  />
                  <label for="skybox-base-url">Skybox base URL</label>
                  <input
                    id="skybox-base-url"
                    type="text"
                    placeholder="https://example.com/env/"
                  />
                  <label for="sprite-base-url">Sprite base URL</label>
                  <input
                    id="sprite-base-url"
                    type="text"
                    placeholder="https://example.com/sprites/"
                  />
                  <label for="sound-base-url">Sound base URL</label>
                  <input
                    id="sound-base-url"
                    type="text"
                    placeholder="https://example.com/sound/"
                  />
                </div>
              </details>
              <button type="submit">Open URL</button>
              <p class="hint">Remote hosts must allow browser CORS requests.</p>
            </form>
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
                <section aria-label="Camera controls">
                  <h2>Camera</h2>
                  <label class="toggle" for="show-reticle">
                    <input id="show-reticle" type="checkbox" checked />
                    Show reticle
                  </label>
                  <label for="movement-mode">Movement</label>
                  <select id="movement-mode" disabled>
                    <option value="walk">Walk</option>
                    <option value="fly">Fly</option>
                  </select>
                  <label for="field-of-view">Field of view</label>
                  <input
                    id="field-of-view"
                    type="number"
                    min="45"
                    max="110"
                    step="1"
                    value="75"
                    disabled
                  />
                  <button id="reset-camera" type="button" disabled>
                    Reset camera
                  </button>
                  <output id="camera-position" class="hint">
                    Position: —
                  </output>
                  <output id="camera-angles" class="hint">
                    Yaw / pitch: —
                  </output>
                  <button id="copy-camera-link" type="button" disabled>
                    Copy view link
                  </button>
                </section>
                <section aria-label="Movement settings">
                  <details class="movement-settings">
                    <summary>Movement settings</summary>
                    <div class="movement-fields">
                      <label for="movement-max-speed">Max speed</label>
                      <input
                        id="movement-max-speed"
                        type="number"
                        min="100"
                        max="400"
                        step="1"
                        disabled
                      />
                      <label for="movement-accelerate">
                        Ground acceleration
                      </label>
                      <input
                        id="movement-accelerate"
                        type="number"
                        min="1"
                        max="20"
                        step="0.1"
                        disabled
                      />
                      <label for="movement-air-accelerate">
                        Air acceleration
                      </label>
                      <input
                        id="movement-air-accelerate"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        disabled
                      />
                      <label for="movement-friction">Friction</label>
                      <input
                        id="movement-friction"
                        type="number"
                        min="0"
                        max="10"
                        step="0.1"
                        disabled
                      />
                      <label for="movement-stop-speed">Stop speed</label>
                      <input
                        id="movement-stop-speed"
                        type="number"
                        min="0"
                        max="200"
                        step="1"
                        disabled
                      />
                      <label for="movement-mouse-sensitivity">
                        Mouse sensitivity
                      </label>
                      <input
                        id="movement-mouse-sensitivity"
                        type="number"
                        min="0.1"
                        max="10"
                        step="0.1"
                        disabled
                      />
                      <label for="movement-mouse-acceleration">
                        Mouse acceleration
                      </label>
                      <input
                        id="movement-mouse-acceleration"
                        type="number"
                        min="0"
                        max="0.1"
                        step="0.002"
                        disabled
                      />
                      <label for="movement-view-bob">View bob</label>
                      <input
                        id="movement-view-bob"
                        type="number"
                        min="0"
                        max="2"
                        step="0.05"
                        disabled
                      />
                    </div>
                  </details>
                </section>
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
            <section class="hosted" aria-label="Hosted maps">
              <h2>Hosted maps</h2>
              <p id="hosted-status" role="status">
                Connecting to Maps service
              </p>
              <a id="hosted-login" href="/auth/login?returnTo=/" hidden>
                Sign in to Maps
              </a>
              <button id="hosted-logout" type="button" hidden>
                Sign out
              </button>
              <label for="hosted-project">Project</label>
              <select id="hosted-project" disabled></select>
              <label for="hosted-map">Map</label>
              <select id="hosted-map" disabled></select>
              <label for="hosted-build">Compiled build</label>
              <select id="hosted-build" disabled></select>
              <button id="hosted-open" type="button" disabled>
                Open compiled map
              </button>
              <button id="hosted-inspect" type="button" disabled>
                Inspect map source
              </button>
              <p class="hint">
                Build artifacts are private to project members. A map needs a
                successful build before it can open here.
              </p>
            </section>
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
      </body>
    </html>
  );
}
