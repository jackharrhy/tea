import { browserAssets } from "./assets/build-manifest.ts";
import { EditorRecentProjects } from "./assets/editor-recent-projects-panel.tsx";
import { EditorHostedPresence } from "./assets/editor-hosted-presence-panel.tsx";
import { EditorHostedAccess } from "./assets/editor-hosted-access-panel.tsx";
import { EditorHostedResources } from "./assets/editor-hosted-resources-panel.tsx";
import { EditorHostedPicker } from "./assets/editor-hosted-picker-panel.tsx";
import { EditorHostedBuilds } from "./assets/editor-hosted-builds-panel.tsx";
import { EditorFov } from "./assets/editor-fov-panel.tsx";
import { EditorReferences } from "./assets/editor-references-panel.tsx";
import { EditorDetachedMaps } from "./assets/editor-detached-maps-panel.tsx";
import { EditorProjectMapSelector } from "./assets/editor-project-map-selector-panel.tsx";
import { EditorThemeControl } from "./assets/editor-theme-control.tsx";
import { EditorVersions } from "./assets/editor-versions-panel.tsx";
import { EditorProjectSync } from "./assets/editor-project-sync-panel.tsx";
import { EditorHostedSource } from "./assets/editor-hosted-source-panel.tsx";
import { EditorSourceComparison } from "./assets/editor-source-compare-panel.tsx";
import { EditorMaterialBrowser } from "./assets/editor-material-browser-panel.tsx";
import { EditorIssues } from "./assets/editor-issues-panel.tsx";
import { EditorVisibility } from "./assets/editor-visibility-panel.tsx";
import {
  EditorPerformancePanel,
  EditorPerformanceToggle,
} from "./assets/editor-performance-panel.tsx";
import { editorStyles } from "./editor-styles.ts";

export function EditorPage() {
  return () => (
    <html lang="en" mix={editorStyles}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#162923" />
        <title>Editor · Maps · Tea</title>
        <link rel="icon" href="/favicon.svg" />
      </head>
      <body>
        <main class="editor-shell">
          <header class="editor-header">
            <a class="editor-brand" href="/">
              tea/maps
            </a>
            <a href="/projects">Projects</a>
            <strong>Map editor</strong>
            <span id="editor-status" role="status">
              Starting…
            </span>
            <EditorThemeControl />
            <EditorPerformanceToggle />
          </header>
          <nav class="editor-toolbar" aria-label="Editor actions">
            <button id="new-map" type="button" disabled>
              New map
            </button>
            <button id="example-map" type="button" disabled>
              Example scene
            </button>
            <button id="open-map-button" type="button" disabled>
              Open .map
            </button>
            <input id="open-map" type="file" accept=".map,text/plain" />
            <button id="open-project" type="button" disabled>
              Open project
            </button>
            <EditorRecentProjects />
            <label for="project-maps">Project maps</label>
            <select id="project-maps" disabled>
              <option value="">No project open</option>
            </select>
            <button id="project-sync-open" type="button" disabled>
              Sync project
            </button>
            <span id="project-resource-info" role="status" />
            <details id="project-resource-diagnostics" hidden>
              <summary>Project resource messages</summary>
              <ul id="project-resource-messages" />
            </details>
            <button id="save-map" type="button" disabled>
              Save .map
            </button>
            <button id="export-normalized" type="button" disabled>
              Export normalized
            </button>
            <label for="checkpoint-label">Checkpoint label</label>
            <input id="checkpoint-label" type="text" placeholder="Optional" />
            <button id="create-checkpoint" type="button" disabled>
              Save checkpoint
            </button>
            <button id="show-versions" type="button" disabled>
              Recovery versions
            </button>
            <label for="game-profile">Game</label>
            <select id="game-profile">
              <option value="quake">Quake</option>
              <option value="goldsrc">GoldSrc</option>
              <option value="quake2">Quake II</option>
              <option value="gower">Gower Complex</option>
            </select>
            <label for="build-profile">Build profile</label>
            <select id="build-profile" disabled>
              <option value="preview">Preview</option>
              <option value="final">Final</option>
            </select>
            <button id="build-map" type="button" disabled>
              Build BSP
            </button>
            <button id="export-build" type="button" disabled>
              Export build
            </button>
            <span id="export-status" role="status" />
            <label for="include-build-source">
              <input id="include-build-source" type="checkbox" /> Include source
            </label>
            <label for="export-after-build">
              <input id="export-after-build" type="checkbox" /> Export after
              build
            </label>
            <span id="export-destination">Destination: Downloads</span>
            <button id="choose-export-directory" type="button" disabled>
              Choose export folder
            </button>
            <button id="use-export-downloads" type="button" hidden>
              Use Downloads
            </button>
            <span class="hint">
              Folder exports replace a file with the same map name.
            </span>
            <button id="toggle-compiled" type="button" disabled>
              Show compiled
            </button>
            <span id="build-status" role="status" />
            <details id="build-details" hidden>
              <summary>Build messages</summary>
              <pre id="build-output" />
            </details>
            <EditorHostedBuilds />
            <button id="add-box" type="button" disabled>
              Add box
            </button>
            <label for="viewport-tool">Viewport tool</label>
            <select id="viewport-tool" disabled>
              <option value="select">Select and move</option>
              <option value="face">Face</option>
              <option value="clip">Clip brush</option>
              <option value="hull">Convex hull brush</option>
              <option value="sweep">Sweep faces</option>
              <option value="vertex">Vertex edit</option>
              <option value="edge">Edge edit</option>
              <option value="rotate">Rotate</option>
              <option value="scale">Scale</option>
              <option value="shear">Shear</option>
              <option value="create">Draw shape</option>
              <option value="entity">Place point entity</option>
            </select>
            <label for="box-material">Brush texture</label>
            <input
              id="box-material"
              type="text"
              list="material-choices"
              value="DEV/GRID"
            />
            <datalist id="material-choices" />
            <button id="delete-selection" type="button" disabled>
              Delete selection
            </button>
            <button id="duplicate-selection" type="button" disabled>
              Duplicate
            </button>
            <button id="select-all" type="button" disabled>
              Select all
            </button>
            <button id="invert-selection" type="button" disabled>
              Invert selection
            </button>
            <details id="selection-brush-tools">
              <summary>Selection brushes</summary>
              <div
                class="selection-brush-actions"
                role="group"
                aria-label="Selection brush commands"
              >
                <button id="selection-brush-touching" type="button" disabled>
                  Select touching
                </button>
                <button id="selection-brush-inside" type="button" disabled>
                  Select enclosed
                </button>
                <label for="selection-brush-projection">2D plane</label>
                <select id="selection-brush-projection" disabled>
                  <option value="xy">XY</option>
                  <option value="xz">XZ</option>
                  <option value="yz">YZ</option>
                </select>
                <button id="selection-brush-projected" type="button" disabled>
                  Select enclosed in 2D
                </button>
              </div>
              <p>
                Selected structural brushes define the volume and are removed.
                Undo restores them.
              </p>
            </details>
            <button id="focus-selection" type="button" disabled>
              Focus selection
            </button>
            <button id="hide-selection" type="button" disabled>
              Hide selection
            </button>
            <button id="isolate-selection" type="button" disabled>
              Isolate selection
            </button>
            <button id="show-all" type="button" disabled>
              Show all
            </button>
            <button id="lock-selection" type="button" disabled>
              Lock selection
            </button>
            <button id="unlock-all" type="button" disabled>
              Unlock all
            </button>
            <label for="grid-size">Grid size</label>
            <select id="grid-size">
              {[1, 2, 4, 8, 16, 32, 64, 128, 256].map((size) => (
                <option value={String(size)} selected={size === 16}>
                  {size}
                </option>
              ))}
            </select>
            <label for="texture-lock">
              <input id="texture-lock" type="checkbox" checked /> Texture lock
            </label>
            <button id="snap-to-grid" type="button" disabled>
              Snap selection
            </button>
            <button id="repeat-commands" type="button" disabled>
              Repeat
            </button>
            <button id="clear-repeat-commands" type="button" disabled>
              Clear repeat
            </button>
            <button id="copy-selection" type="button" disabled>
              Copy
            </button>
            <button id="paste-cursor" type="button" disabled>
              Paste at pointer
            </button>
            <button id="paste-original" type="button" disabled>
              Paste in place
            </button>
            <div class="transform-tools" role="group" aria-label="Brush entity">
              <label for="brush-entity-classname">Brush entity</label>
              <input
                id="brush-entity-classname"
                type="text"
                list="brush-entity-classes"
                value="func_detail"
                autoComplete="off"
                spellCheck={false}
              />
              <datalist id="brush-entity-classes" />
              <button id="make-brush-entity" type="button" disabled>
                Make entity
              </button>
              <button id="make-structural" type="button" disabled>
                Make structural
              </button>
            </div>
            <div class="transform-tools" role="group" aria-label="Point entity">
              <label for="point-entity-classname">Point entity</label>
              <input
                id="point-entity-classname"
                type="text"
                list="point-entity-classes"
                value="info_player_start"
                autoComplete="off"
                spellCheck={false}
              />
              <datalist id="point-entity-classes" />
              <label for="point-origin-x">X</label>
              <input id="point-origin-x" type="number" value="0" />
              <label for="point-origin-y">Y</label>
              <input id="point-origin-y" type="number" value="0" />
              <label for="point-origin-z">Z</label>
              <input id="point-origin-z" type="number" value="64" />
              <button id="add-point-entity" type="button" disabled>
                Add point
              </button>
            </div>
            <div
              class="transform-tools"
              role="group"
              aria-label="Move selection"
            >
              <span>Move</span>
              <label for="move-x">X</label>
              <input id="move-x" type="number" value="16" />
              <label for="move-y">Y</label>
              <input id="move-y" type="number" value="0" />
              <label for="move-z">Z</label>
              <input id="move-z" type="number" value="0" />
              <button id="move-selection" type="button" disabled>
                Apply
              </button>
            </div>
            <div class="transform-tools" role="group" aria-label="Grid nudge">
              <span>Grid nudge</span>
              {(["X", "Y", "Z"] as const).map((axis) => (
                <span>
                  {axis}
                  <button
                    type="button"
                    data-nudge-axis={axis}
                    data-nudge-direction="-1"
                    disabled
                    aria-label={`Nudge ${axis} negative`}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    data-nudge-axis={axis}
                    data-nudge-direction="1"
                    disabled
                    aria-label={`Nudge ${axis} positive`}
                  >
                    +
                  </button>
                </span>
              ))}
            </div>
            <div
              class="transform-tools"
              role="group"
              aria-label="Rotate selection"
            >
              <span>Rotate</span>
              <label for="rotate-axis">Axis</label>
              <select id="rotate-axis">
                <option value="0">X</option>
                <option value="1">Y</option>
                <option value="2" selected>
                  Z
                </option>
              </select>
              <label for="rotate-degrees">Degrees</label>
              <input id="rotate-degrees" type="number" value="90" step="1" />
              <button id="rotate-selection" type="button" disabled>
                Apply
              </button>
            </div>
            <div
              class="transform-tools"
              role="group"
              aria-label="Scale selection"
            >
              <span>Scale</span>
              <label for="scale-x">X</label>
              <input
                id="scale-x"
                type="number"
                min="0.05"
                step="0.05"
                value="1.25"
              />
              <label for="scale-y">Y</label>
              <input
                id="scale-y"
                type="number"
                min="0.05"
                step="0.05"
                value="1.25"
              />
              <label for="scale-z">Z</label>
              <input
                id="scale-z"
                type="number"
                min="0.05"
                step="0.05"
                value="1.25"
              />
              <button id="scale-selection" type="button" disabled>
                Apply
              </button>
            </div>
            <details id="advanced-transforms">
              <summary>Shear and mirror</summary>
              <div class="advanced-transform-controls">
                <label for="shear-source-axis">Plane axis</label>
                <select id="shear-source-axis">
                  <option value="0">X</option>
                  <option value="1">Y</option>
                  <option value="2" selected>
                    Z
                  </option>
                </select>
                <label for="shear-target-axis">Move axis</label>
                <select id="shear-target-axis">
                  <option value="0" selected>
                    X
                  </option>
                  <option value="1">Y</option>
                  <option value="2">Z</option>
                </select>
                <label for="shear-offset">Offset</label>
                <input id="shear-offset" type="number" step="1" value="16" />
                <button id="shear-selection" type="button" disabled>
                  Shear
                </button>
                <span>Mirror around snapped center</span>
                <button id="flip-x" type="button" disabled>
                  Flip X
                </button>
                <button id="flip-y" type="button" disabled>
                  Flip Y
                </button>
                <button id="flip-z" type="button" disabled>
                  Flip Z
                </button>
              </div>
            </details>
            <div id="clip-tools" class="clip-tools" hidden>
              <span id="clip-points">Place two or three points</span>
              <div role="group" aria-label="Clip result">
                <button id="clip-back" type="button" aria-pressed="true">
                  Keep back
                </button>
                <button id="clip-split" type="button" aria-pressed="false">
                  Split
                </button>
                <button id="clip-front" type="button" aria-pressed="false">
                  Keep front
                </button>
              </div>
              <button id="apply-clip" type="button" disabled>
                Apply clip
              </button>
              <button id="reset-clip" type="button" disabled>
                Reset points
              </button>
              <p>
                Click two or three snapped points in a viewport, or double-click
                a face to match its plane. Drag an orange point to adjust it.
              </p>
            </div>
            <div id="hull-tools" class="hull-tools" hidden>
              <span id="hull-points">0 points</span>
              <button id="create-hull" type="button" disabled>
                Create hull
              </button>
              <button id="discard-hull" type="button" disabled>
                Discard points
              </button>
              <p>
                In the perspective viewport, click a reference face for one
                point, double-click for its vertices, or drag a rectangle. Enter
                creates the hull; Escape discards its points.
              </p>
            </div>
            <div id="sweep-tools" class="sweep-tools" hidden>
              <strong>Sweep selected faces</strong>
              <span id="sweep-count">0 brushes</span>
              <div class="sweep-fields">
                <span>Destination</span>
                <label for="sweep-translate-x">X</label>
                <input
                  id="sweep-translate-x"
                  type="number"
                  step="1"
                  value="0"
                />
                <label for="sweep-translate-y">Y</label>
                <input
                  id="sweep-translate-y"
                  type="number"
                  step="1"
                  value="0"
                />
                <label for="sweep-translate-z">Z</label>
                <input
                  id="sweep-translate-z"
                  type="number"
                  step="1"
                  value="64"
                />
                <span>Rotation</span>
                <label for="sweep-rotate-x">X</label>
                <input id="sweep-rotate-x" type="number" step="5" value="0" />
                <label for="sweep-rotate-y">Y</label>
                <input id="sweep-rotate-y" type="number" step="5" value="0" />
                <label for="sweep-rotate-z">Z</label>
                <input id="sweep-rotate-z" type="number" step="5" value="0" />
                <label for="sweep-scale">Scale</label>
                <input
                  id="sweep-scale"
                  type="number"
                  min="0.05"
                  max="20"
                  step="0.05"
                  value="1"
                />
                <label for="sweep-path">Path</label>
                <select id="sweep-path">
                  <option value="straight">Straight</option>
                  <option value="arc">Arc</option>
                  <option value="s-bend">S-bend</option>
                </select>
                <label for="sweep-segments">Segments</label>
                <input
                  id="sweep-segments"
                  type="number"
                  min="1"
                  max="128"
                  step="1"
                  value="4"
                />
                <label for="sweep-iterations">Iterations</label>
                <input
                  id="sweep-iterations"
                  type="number"
                  min="1"
                  max="64"
                  step="1"
                  value="1"
                />
                <label for="sweep-snap">
                  <input id="sweep-snap" type="checkbox" /> Snap vertices
                </label>
                <button id="reset-sweep" type="button">
                  Reset
                </button>
                <button id="apply-sweep" type="button" disabled>
                  Apply sweep
                </button>
              </div>
              <p>
                Drag the destination cap in the perspective viewport to move,
                rotate, or scale it. Enter applies; Escape resets, then leaves
                the tool.
              </p>
            </div>
            <div id="topology-tools" class="topology-tools" hidden>
              <strong id="topology-title">Vertex edit</strong>
              <span>
                <b id="topology-count">0</b> handles selected
              </span>
              <button id="delete-topology" type="button" disabled>
                Delete handles
              </button>
              <p>
                Click or lasso handles on selected brushes. Ctrl/Command adds
                handles or changes snap mode; Shift+Alt-click a vertex to snap
                to it. Arrow keys nudge by one grid step. Shift-drag a green
                surface handle to add a vertex. Escape clears handles before
                leaving the tool.
              </p>
            </div>
            <div id="shape-tools" class="shape-tools" hidden>
              <strong>Simple shape</strong>
              <span id="shape-result">Drag to draw</span>
              <label for="shape-kind">Shape</label>
              <select id="shape-kind">
                <option value="cuboid">Cuboid</option>
                <option value="stairs">Stairs</option>
                <option value="arch">Arch</option>
                <option value="cylinder">Cylinder</option>
                <option value="cone">Cone</option>
                <option value="uv-sphere">UV spheroid</option>
                <option value="ico-sphere">Icosphere</option>
              </select>
              <div id="shape-circle-fields" class="shape-fields" hidden>
                <label for="shape-axis">Axis</label>
                <select id="shape-axis">
                  <option value="0">X</option>
                  <option value="1">Y</option>
                  <option value="2" selected>
                    Z
                  </option>
                </select>
                <label for="shape-sides">Sides</label>
                <input
                  id="shape-sides"
                  type="number"
                  min="3"
                  max="96"
                  step="1"
                  value="8"
                />
                <label for="shape-circle-mode">Circle</label>
                <select id="shape-circle-mode">
                  <option value="edge-aligned">Edge aligned</option>
                  <option value="vertex-aligned">Vertex aligned</option>
                  <option value="scalable">Scalable grid</option>
                </select>
              </div>
              <div id="shape-hollow-fields" class="shape-fields" hidden>
                <label id="shape-hollow-label" for="shape-hollow">
                  <input id="shape-hollow" type="checkbox" /> Hollow
                </label>
                <label for="shape-thickness">Thickness</label>
                <input
                  id="shape-thickness"
                  type="number"
                  min="1"
                  max="1024"
                  step="1"
                  value="16"
                />
              </div>
              <div id="shape-uv-fields" class="shape-fields" hidden>
                <label for="shape-rings">Rings</label>
                <input
                  id="shape-rings"
                  type="number"
                  min="1"
                  max="32"
                  step="1"
                  value="8"
                />
              </div>
              <div id="shape-ico-fields" class="shape-fields" hidden>
                <label for="shape-accuracy">Accuracy</label>
                <input
                  id="shape-accuracy"
                  type="number"
                  min="1"
                  max="3"
                  step="1"
                  value="1"
                />
              </div>
              <div id="shape-stair-fields" class="shape-fields" hidden>
                <label for="shape-step-height">Step height</label>
                <input
                  id="shape-step-height"
                  type="number"
                  min="1"
                  max="1024"
                  step="1"
                  value="16"
                />
                <label for="shape-stair-direction">Direction</label>
                <select id="shape-stair-direction">
                  <option value="positive-x">+X</option>
                  <option value="negative-x">−X</option>
                  <option value="positive-y">+Y</option>
                  <option value="negative-y">−Y</option>
                </select>
              </div>
              <p>
                Drag in a viewport to size the shape. Shift makes the visible
                axes equal; Shift+Alt makes a cube in perspective.
              </p>
            </div>
            <div id="transform-tool" class="transform-tool" hidden>
              <strong id="transform-title">Rotate</strong>
              <span>Pivot</span>
              <label for="transform-pivot-x">X</label>
              <input id="transform-pivot-x" type="number" step="1" value="0" />
              <label for="transform-pivot-y">Y</label>
              <input id="transform-pivot-y" type="number" step="1" value="0" />
              <label for="transform-pivot-z">Z</label>
              <input id="transform-pivot-z" type="number" step="1" value="0" />
              <button id="reset-transform-pivot" type="button">
                Reset pivot
              </button>
              <label for="transform-update-angles">
                <input id="transform-update-angles" type="checkbox" checked />{" "}
                Update entity angles
              </label>
              <button id="apply-transform-tool" type="button" disabled>
                Apply numeric transform
              </button>
              <p>
                Drag the viewport handles to transform the selection. Set exact
                rotation, scale, or shear values in the toolbar above; the pivot
                also applies to those commands while this tool is active.
              </p>
            </div>
            <details id="csg-tools">
              <summary>Constructive geometry</summary>
              <div
                class="csg-actions"
                role="group"
                aria-label="Constructive geometry commands"
              >
                <button id="csg-merge" type="button" disabled>
                  Convex merge
                </button>
                <button id="csg-intersect" type="button" disabled>
                  Intersect
                </button>
                <button id="csg-subtract" type="button" disabled>
                  Subtract
                </button>
                <label for="csg-thickness">Hollow wall thickness</label>
                <input
                  id="csg-thickness"
                  type="number"
                  min="1"
                  step="1"
                  value="16"
                />
                <button id="csg-hollow" type="button" disabled>
                  Hollow
                </button>
              </div>
              <p>
                Merge and Intersect need at least two brushes. Subtract uses
                selected brushes as cutters and removes them.
              </p>
            </details>
            <details id="group-tools">
              <summary>Groups</summary>
              <div class="group-controls" role="group" aria-label="Groups">
                <label for="group-name">Name</label>
                <input
                  id="group-name"
                  type="text"
                  value="Group"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button id="group-selection" type="button" disabled>
                  Group selection
                </button>
                <button id="rename-group" type="button" disabled>
                  Rename
                </button>
                <button id="open-group" type="button" disabled>
                  Open group
                </button>
                <button id="close-group" type="button" disabled>
                  Close group
                </button>
                <button id="linked-duplicate-group" type="button" disabled>
                  Linked duplicate
                </button>
                <button id="unlink-group" type="button" disabled>
                  Unlink
                </button>
                <button id="ungroup-selection" type="button" disabled>
                  Ungroup
                </button>
              </div>
            </details>
            <details id="layer-tools">
              <summary>Layers</summary>
              <div class="layer-controls">
                <label for="layer-select">Layer</label>
                <select id="layer-select" aria-label="Map layer" />
                <span id="layer-count" />
                <label for="layer-name">Name</label>
                <input id="layer-name" type="text" autoComplete="off" />
                <button id="rename-layer" type="button" disabled>
                  Rename
                </button>
                <button id="activate-layer" type="button" disabled>
                  Make active
                </button>
                <button id="move-to-layer" type="button" disabled>
                  Move selection
                </button>
                <button id="select-layer-contents" type="button" disabled>
                  Select contents
                </button>
                <button id="isolate-layer" type="button" disabled>
                  Isolate
                </button>
                <label for="layer-hidden">
                  <input id="layer-hidden" type="checkbox" /> Hidden
                </label>
                <label for="layer-locked">
                  <input id="layer-locked" type="checkbox" /> Locked
                </label>
                <label for="layer-omit">
                  <input id="layer-omit" type="checkbox" /> Omit from build
                </label>
                <button id="layer-up" type="button" disabled>
                  Move up
                </button>
                <button id="layer-down" type="button" disabled>
                  Move down
                </button>
                <button id="remove-layer" type="button" disabled>
                  Remove layer
                </button>
                <label for="new-layer-name">New layer</label>
                <input
                  id="new-layer-name"
                  type="text"
                  value="Layer"
                  autoComplete="off"
                />
                <button id="create-layer" type="button" disabled>
                  Add layer
                </button>
                <button id="show-all-layers" type="button" disabled>
                  Show all
                </button>
                <button id="hide-all-layers" type="button" disabled>
                  Hide all
                </button>
                <button id="unlock-all-layers" type="button" disabled>
                  Unlock all
                </button>
                <button id="lock-all-layers" type="button" disabled>
                  Lock all
                </button>
              </div>
            </details>
            <EditorReferences />
            <button id="undo" type="button" disabled>
              Undo
            </button>
            <button id="redo" type="button" disabled>
              Redo
            </button>
            <button id="download-map" type="button" disabled>
              Download .map
            </button>
          </nav>
          <details id="hosted-editor-picker" class="hosted-editor-picker">
            <summary>Hosted maps</summary>
            <div class="hosted-editor-fields">
              <EditorHostedPicker />
              <EditorHostedResources />
              <EditorHostedAccess />
              <button id="hosted-source-open" type="button" disabled>
                Edit hosted source
              </button>
              <EditorHostedPresence />
              <EditorDetachedMaps />
              <p>
                Hosted members can edit with live sync. Source changes replace
                the hosted map after a version check. Recovery copies and source
                drafts stay on this device.
              </p>
            </div>
          </details>
          <div class="editor-workspace">
            <section class="viewports" aria-label="Map viewports">
              <div class="viewport-frame">
                <div class="perspective-header">
                  <span id="perspective-label">Perspective</span>
                  <EditorFov />
                  <button
                    id="perspective-only"
                    type="button"
                    aria-pressed="false"
                    aria-label="Show Perspective only"
                    disabled
                  >
                    Expand
                  </button>
                </div>
                <canvas
                  id="perspective"
                  aria-label="Perspective map viewport"
                />
              </div>
              <div class="viewport-frame">
                <span>Top (XY)</span>
                <canvas id="xy" aria-label="Top map viewport" />
              </div>
              <div class="viewport-frame">
                <span>Front (XZ)</span>
                <canvas id="xz" aria-label="Front map viewport" />
              </div>
              <div class="viewport-frame">
                <span>Side (YZ)</span>
                <canvas id="yz" aria-label="Side map viewport" />
              </div>
              <div
                class="viewport-resizer column-resizer"
                role="separator"
                aria-label="Resize viewport columns"
                aria-orientation="vertical"
                aria-valuemin={30}
                aria-valuemax={76}
                aria-valuenow={50}
                tabIndex={0}
                data-resize="column"
              />
              <div
                class="viewport-resizer row-resizer"
                role="separator"
                aria-label="Resize viewport rows"
                aria-orientation="horizontal"
                aria-valuemin={20}
                aria-valuemax={80}
                aria-valuenow={50}
                tabIndex={0}
                data-resize="row"
              />
              <div
                class="viewport-resizer cross-resizer"
                role="separator"
                aria-label="Resize viewport rows and columns"
                aria-valuetext="Column 50%, row 50%"
                tabIndex={0}
                data-resize="cross"
              />
            </section>
            <div
              id="inspector-resizer"
              role="separator"
              aria-label="Resize inspector"
              aria-orientation="vertical"
              aria-valuemin={240}
              aria-valuemax={520}
              aria-valuenow={320}
              tabIndex={0}
              data-resize="inspector"
            />
            <aside class="source-panel">
              <h1>Source</h1>
              <p id="selection-info">No selection</p>
              <EditorIssues />
              <EditorVisibility />
              <div id="face-inspector" hidden>
                <h2>Brush and face</h2>
                <p id="face-inspector-summary" />
                <label for="selected-face">Face</label>
                <select id="selected-face" aria-label="Select brush face" />
                <div id="face-geometry" hidden>
                  <h3>Face geometry</h3>
                  <label for="face-distance">Distance</label>
                  <input id="face-distance" type="number" step="1" value="16" />
                  <div class="face-geometry-actions">
                    <button id="extrude-face" type="button" disabled>
                      Extrude
                    </button>
                    <button id="split-face" type="button" disabled>
                      Split
                    </button>
                    <button id="stamp-face" type="button" disabled>
                      Stamp
                    </button>
                  </div>
                </div>
                <h3>Texture</h3>
                <label for="selected-material">Material</label>
                <div class="face-material-actions">
                  <input
                    id="selected-material"
                    type="text"
                    list="material-choices"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button id="apply-material" type="button" disabled>
                    Apply
                  </button>
                </div>
                <div id="face-projection" hidden>
                  <h3>Face projection</h3>
                  <div class="face-projection-fields">
                    <label for="texture-offset-u">U offset</label>
                    <input id="texture-offset-u" type="number" step="1" />
                    <label for="texture-offset-v">V offset</label>
                    <input id="texture-offset-v" type="number" step="1" />
                    <label for="texture-scale-u">U scale</label>
                    <input id="texture-scale-u" type="number" step="0.25" />
                    <label for="texture-scale-v">V scale</label>
                    <input id="texture-scale-v" type="number" step="0.25" />
                    <label for="texture-rotation">Rotation (°)</label>
                    <input id="texture-rotation" type="number" step="15" />
                  </div>
                  <div class="uv-editor-frame">
                    <svg
                      id="uv-editor"
                      viewBox="0 0 320 220"
                      role="application"
                      aria-label="Selected face UV editor"
                      tabIndex={0}
                    />
                    <p id="uv-editor-status" role="status">
                      Select a brush face
                    </p>
                    <div class="uv-editor-controls">
                      <button id="uv-frame" type="button">
                        Frame face
                      </button>
                      <button id="uv-reset-pivot" type="button">
                        Reset UV origin
                      </button>
                      <label for="uv-grid-x">Grid X</label>
                      <input
                        id="uv-grid-x"
                        type="number"
                        min="1"
                        max="16"
                        step="1"
                        value="1"
                      />
                      <label for="uv-grid-y">Grid Y</label>
                      <input
                        id="uv-grid-y"
                        type="number"
                        min="1"
                        max="16"
                        step="1"
                        value="1"
                      />
                    </div>
                    <p>
                      Drag to offset. Drag the ring to rotate or the handles to
                      scale. Middle or right drag pans; wheel zooms.
                      Ctrl/Command bypasses snapping.
                    </p>
                  </div>
                </div>
                <details id="texture-alignment">
                  <summary>Align texture</summary>
                  <label for="texture-alignment-operation">Operation</label>
                  <select id="texture-alignment-operation">
                    <option value="reset">Reset face projection</option>
                    <option value="world">Align to world axes</option>
                    <option value="flip-u">Flip horizontally</option>
                    <option value="flip-v">Flip vertically</option>
                    <option value="rotate-ccw">Rotate 90° left</option>
                    <option value="rotate-cw">Rotate 90° right</option>
                    <option value="align-edge">Align to face edge</option>
                    <option value="justify-u-min">Justify left</option>
                    <option value="justify-u-max">Justify right</option>
                    <option value="justify-v-min">Justify top</option>
                    <option value="justify-v-max">Justify bottom</option>
                    <option value="fit-u">Fit horizontally</option>
                    <option value="fit-v">Fit vertically</option>
                    <option value="auto-fit">Fit to face</option>
                  </select>
                  <div class="texture-size-fields">
                    <label for="texture-width">Texture width</label>
                    <input id="texture-width" type="number" min="1" step="1" />
                    <label for="texture-height">Texture height</label>
                    <input id="texture-height" type="number" min="1" step="1" />
                  </div>
                  <p>
                    Fit and justify use project texture sizes, or both
                    dimensions entered here.
                  </p>
                  <label for="texture-align-reverse">
                    <input id="texture-align-reverse" type="checkbox" />
                    Reverse direction
                  </label>
                  <label for="texture-align-subdivide">
                    <input id="texture-align-subdivide" type="checkbox" />
                    Subdivide when fitting
                  </label>
                  <button id="apply-texture-alignment" type="button" disabled>
                    Align selection
                  </button>
                </details>
                <details id="surface-attributes" hidden>
                  <summary>Quake II surface</summary>
                  <fieldset>
                    <legend>Contents</legend>
                    <div id="surface-contents" class="surface-flag-grid" />
                    <p id="surface-unknown-contents" hidden />
                  </fieldset>
                  <fieldset>
                    <legend>Surface flags</legend>
                    <div id="surface-flags" class="surface-flag-grid" />
                    <p id="surface-unknown-flags" hidden />
                  </fieldset>
                  <label for="surface-value" id="surface-value-label">
                    Light value
                  </label>
                  <input id="surface-value" type="number" step="1" />
                </details>
              </div>
              <EditorMaterialBrowser />
              <div id="point-entity-inspector" hidden>
                <h2>Selected point entity</h2>
                <label for="selected-point-classname">Classname</label>
                <input id="selected-point-classname" type="text" />
                <label for="selected-point-origin">Origin (X Y Z)</label>
                <input id="selected-point-origin" type="text" />
                <button id="update-point-entity" type="button" disabled>
                  Update entity
                </button>
              </div>
              <div id="entity-properties" hidden>
                <h2>Entity properties</h2>
                <div
                  id="entity-property-list"
                  aria-label="Existing properties"
                />
                <label for="entity-property-key">Key</label>
                <input
                  id="entity-property-key"
                  type="text"
                  autoComplete="off"
                />
                <label for="entity-property-value">Value</label>
                <input id="entity-property-value" type="text" />
                <label
                  id="entity-property-protection-option"
                  for="entity-property-protected"
                  hidden
                >
                  <input id="entity-property-protected" type="checkbox" />
                  Keep new property independent in this linked copy
                </label>
                <div class="entity-property-actions">
                  <button id="save-entity-property" type="button" disabled>
                    Save property
                  </button>
                  <button id="remove-entity-property" type="button" disabled>
                    Remove property
                  </button>
                </div>
              </div>
              <label for="map-source">Valve map source</label>
              <p id="source-save-warning" role="status" hidden />
              <textarea
                id="map-source"
                spellCheck={false}
                aria-label="Valve map source"
                disabled
              />
              <button id="apply-source" type="button" disabled>
                Apply source
              </button>
              <p>
                Choose a viewport tool to draw, move, or place objects.
                Middle-drag pans; right-drag looks around in Perspective. Apply
                source edits before using viewport tools.
              </p>
            </aside>
            <EditorProjectMapSelector />
          </div>
        </main>
        <EditorPerformancePanel />
        <dialog id="switch-map-dialog" aria-labelledby="switch-map-title">
          <h2 id="switch-map-title">Save this map?</h2>
          <p>Choose what to do with changes before opening another map.</p>
          <form method="dialog">
            <button value="save">Save</button>
            <button value="discard">Discard</button>
            <button value="cancel">Cancel</button>
          </form>
        </dialog>
        <EditorVersions />
        <EditorProjectSync />
        <EditorSourceComparison />
        <EditorHostedSource />
        <div
          id="viewport-context-menu"
          role="menu"
          aria-label="Map view actions"
          hidden
        />
        <script type="module" src={browserAssets.editor}></script>
        <script type="module" src={browserAssets.entry}></script>
      </body>
    </html>
  );
}
