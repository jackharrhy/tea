import { browserAssets } from "./assets/build-manifest.ts";
import { EditorRecentProjects } from "./assets/editor-recent-projects-panel.tsx";
import {
  EditorHostedPresence,
  EditorHostedPresenceStrip,
} from "./assets/editor-hosted-presence-panel.tsx";
import { EditorHostedAccess } from "./assets/editor-hosted-access-panel.tsx";
import { EditorHostedResources } from "./assets/editor-hosted-resources-panel.tsx";
import { EditorHostedPicker } from "./assets/editor-hosted-picker-panel.tsx";
import { EditorHostedBuilds } from "./assets/editor-hosted-builds-panel.tsx";
import { EditorFov } from "./assets/editor-fov-panel.tsx";
import {
  EditorInspector,
  EditorInspectorToggle,
  EditorWorkspaceToggle,
} from "./assets/editor-workspace-toggle.tsx";
import { EditorExportSettings } from "./assets/editor-export-settings-panel.tsx";
import { EditorBuildControls } from "./assets/editor-build-controls-panel.tsx";
import { EditorDocumentControls } from "./assets/editor-document-controls-panel.tsx";
import { EditorProjectContextPanel } from "./assets/editor-project-context-panel.tsx";
import { EditorSelectionCommands } from "./assets/editor-selection-commands-panel.tsx";
import { EditorEditActions } from "./assets/editor-edit-actions-panel.tsx";
import { EditorToolSettings } from "./assets/editor-tool-settings-panel.tsx";
import { EditorHistory } from "./assets/editor-history-panel.tsx";
import { EditorSwitchMapDialog } from "./assets/editor-switch-map-panel.tsx";
import { EditorContextMenu } from "./assets/editor-context-menu-panel.tsx";
import { EditorDetachedMaps } from "./assets/editor-detached-maps-panel.tsx";
import { EditorProjectMapSelector } from "./assets/editor-project-map-selector-panel.tsx";
import { EditorThemeControl } from "./assets/editor-theme-control.tsx";
import { EditorVersions } from "./assets/editor-versions-panel.tsx";
import {
  EditorProjectSync,
  EditorProjectSyncOpen,
} from "./assets/editor-project-sync-panel.tsx";
import {
  EditorHostedSource,
  EditorHostedSourceOpen,
} from "./assets/editor-hosted-source-panel.tsx";
import { EditorSourceComparison } from "./assets/editor-source-compare-panel.tsx";
import { EditorIssueStatus } from "./assets/editor-issues-panel.tsx";
import { EditorPointerReadout } from "./assets/editor-pointer-readout.tsx";
import {
  EditorDocumentName,
  EditorPerspectiveLabel,
  EditorSelectionInfo,
  EditorStatus,
} from "./assets/editor-readouts.tsx";
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
            <EditorDocumentName />
            <EditorHostedPresenceStrip />
            <EditorThemeControl />
            <EditorPerformanceToggle />
            <EditorInspectorToggle />
          </header>
          <nav class="editor-toolbar" aria-label="Editor actions">
            <EditorToolSettings />
            <EditorHistory />
            <span class="toolbar-scroll-hint">More actions below ↓</span>
            <EditorDocumentControls />
            <EditorRecentProjects />
            <EditorProjectContextPanel />
            <EditorProjectSyncOpen />
            <EditorBuildControls />
            <EditorExportSettings />
            <EditorHostedBuilds />
            <EditorSelectionCommands />
            <EditorEditActions />
          </nav>
          <details id="hosted-editor-picker" class="hosted-editor-picker">
            <summary>Hosted maps</summary>
            <div class="hosted-editor-fields">
              <EditorHostedPicker />
              <EditorHostedResources />
              <EditorHostedAccess />
              <EditorHostedSourceOpen />
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
                  <EditorPerspectiveLabel />
                  <EditorFov />
                  <EditorWorkspaceToggle />
                </div>
                <canvas
                  id="perspective"
                  aria-label="Perspective map viewport"
                />
                <div data-viewport-overlay="lasso" aria-hidden="true" />
                <div
                  data-viewport-overlay="transform-readout"
                  aria-hidden="true"
                />
              </div>
              <div class="viewport-frame">
                <span>Top (XY)</span>
                <canvas id="xy" aria-label="Top map viewport" />
                <div data-viewport-overlay="lasso" aria-hidden="true" />
                <div
                  data-viewport-overlay="transform-readout"
                  aria-hidden="true"
                />
              </div>
              <div class="viewport-frame">
                <span>Front (XZ)</span>
                <canvas id="xz" aria-label="Front map viewport" />
                <div data-viewport-overlay="lasso" aria-hidden="true" />
                <div
                  data-viewport-overlay="transform-readout"
                  aria-hidden="true"
                />
              </div>
              <div class="viewport-frame">
                <span>Side (YZ)</span>
                <canvas id="yz" aria-label="Side map viewport" />
                <div data-viewport-overlay="lasso" aria-hidden="true" />
                <div
                  data-viewport-overlay="transform-readout"
                  aria-hidden="true"
                />
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
            <aside id="editor-inspector" class="source-panel">
              <EditorSelectionInfo />
              <EditorInspector />
            </aside>
            <EditorProjectMapSelector />
          </div>
          <footer class="editor-statusbar">
            <EditorStatus />
            <EditorIssueStatus />
            <EditorPointerReadout />
          </footer>
        </main>
        <EditorPerformancePanel />
        <EditorSwitchMapDialog />
        <EditorVersions />
        <EditorProjectSync />
        <EditorSourceComparison />
        <EditorHostedSource />
        <EditorContextMenu />
        <script type="module" src={browserAssets.editor}></script>
        <script type="module" src={browserAssets.entry}></script>
      </body>
    </html>
  );
}
