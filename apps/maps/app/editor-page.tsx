import { browserAssets } from "./assets/build-manifest.ts";
import { EditorRecentProjects } from "./assets/editor-recent-projects-panel.tsx";
import { EditorHostedPresence } from "./assets/editor-hosted-presence-panel.tsx";
import { EditorHostedAccess } from "./assets/editor-hosted-access-panel.tsx";
import { EditorHostedResources } from "./assets/editor-hosted-resources-panel.tsx";
import { EditorHostedPicker } from "./assets/editor-hosted-picker-panel.tsx";
import { EditorHostedBuilds } from "./assets/editor-hosted-builds-panel.tsx";
import { EditorFov } from "./assets/editor-fov-panel.tsx";
import { EditorReferences } from "./assets/editor-references-panel.tsx";
import { EditorLayers } from "./assets/editor-layers-panel.tsx";
import { EditorGroups } from "./assets/editor-groups-panel.tsx";
import { EditorExportSettings } from "./assets/editor-export-settings-panel.tsx";
import { EditorBuildControls } from "./assets/editor-build-controls-panel.tsx";
import { EditorDocumentControls } from "./assets/editor-document-controls-panel.tsx";
import { EditorSourcePanel } from "./assets/editor-source-panel.tsx";
import { EditorProjectContextPanel } from "./assets/editor-project-context-panel.tsx";
import { EditorSelectionCommands } from "./assets/editor-selection-commands-panel.tsx";
import { EditorEditActions } from "./assets/editor-edit-actions-panel.tsx";
import { EditorToolSettings } from "./assets/editor-tool-settings-panel.tsx";
import { EditorHistory } from "./assets/editor-history-panel.tsx";
import { EditorEntityCreation } from "./assets/editor-entity-creation-panel.tsx";
import { EditorTransforms } from "./assets/editor-transforms-panel.tsx";
import { EditorGeometry, EditorCsg } from "./assets/editor-geometry-panel.tsx";
import { EditorEntityInspector } from "./assets/editor-entity-inspector-panel.tsx";
import { EditorFaceBasics } from "./assets/editor-face-basics-panel.tsx";
import {
  EditorFaceProjectionFields,
  EditorTextureAlignment,
} from "./assets/editor-face-texture-panel.tsx";
import { EditorSurface } from "./assets/editor-surface-panel.tsx";
import { EditorUvControls } from "./assets/editor-uv-controls-panel.tsx";
import { EditorSwitchMapDialog } from "./assets/editor-switch-map-panel.tsx";
import { EditorClipHull } from "./assets/editor-clip-hull-panel.tsx";
import { EditorSweepPanel } from "./assets/editor-sweep-panel.tsx";
import { EditorTopologyPanel } from "./assets/editor-topology-panel.tsx";
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
            <EditorDocumentControls />
            <EditorRecentProjects />
            <EditorProjectContextPanel />
            <button id="project-sync-open" type="button" disabled>
              Sync project
            </button>
            <EditorBuildControls />
            <EditorExportSettings />
            <EditorHostedBuilds />
            <EditorGeometry />
            <EditorToolSettings />
            <EditorSelectionCommands />
            <EditorEditActions />
            <EditorEntityCreation />
            <EditorTransforms />
            <EditorClipHull />
            <EditorSweepPanel />
            <EditorTopologyPanel />
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
            <EditorCsg />
            <EditorGroups />
            <EditorLayers />
            <EditorReferences />
            <EditorHistory />
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
                <EditorFaceBasics />
                <div id="face-projection" hidden>
                  <h3>Face projection</h3>
                  <EditorFaceProjectionFields />
                  <div class="uv-editor-frame">
                    <svg
                      id="uv-editor"
                      viewBox="0 0 320 220"
                      role="application"
                      aria-label="Selected face UV editor"
                      tabIndex={0}
                    />
                    <EditorUvControls />
                  </div>
                </div>
                <EditorTextureAlignment />
                <EditorSurface />
              </div>
              <EditorMaterialBrowser />
              <EditorEntityInspector />
              <EditorSourcePanel />
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
        <EditorSwitchMapDialog />
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
