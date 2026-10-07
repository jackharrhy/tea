import * as fs from "node:fs/promises";
import * as path from "node:path";
import { build, context } from "esbuild";

const root = process.cwd();
const watch = process.argv.includes("--watch");
const development = process.argv.includes("--dev") || watch;
const output = path.join(root, "dist", development ? "client-dev" : "client");
const clientEntrySourceNames = {
  editorHostedAccess: "editor-hosted-access-panel.tsx",
  editorHostedPresence: "editor-hosted-presence-panel.tsx",
  editorPointerReadout: "editor-pointer-readout.tsx",
  projectMapSelector: "editor-project-map-selector-panel.tsx",
  editorTheme: "editor-theme-control.tsx",
  newMap: "new-map-setup.tsx",
  editorRecentProjects: "editor-recent-projects-panel.tsx",
  editorVersions: "editor-versions-panel.tsx",
  editorProjectSync: "editor-project-sync-panel.tsx",
  editorHostedSource: "editor-hosted-source-panel.tsx",
  editorSourceCompare: "editor-source-compare-panel.tsx",
  editorMaterialBrowser: "editor-material-browser-panel.tsx",
  editorIssues: "editor-issues-panel.tsx",
  editorVisibility: "editor-visibility-panel.tsx",
  editorPerformancePanel: "editor-performance-panel.tsx",
  editorHostedResources: "editor-hosted-resources-panel.tsx",
  editorHostedPicker: "editor-hosted-picker-panel.tsx",
  editorHostedBuilds: "editor-hosted-builds-panel.tsx",
  editorFov: "editor-fov-panel.tsx",
  editorWorkspaceToggle: "editor-workspace-toggle.tsx",
  editorReferences: "editor-references-panel.tsx",
  editorLayers: "editor-layers-panel.tsx",
  editorGroups: "editor-groups-panel.tsx",
  editorExportSettings: "editor-export-settings-panel.tsx",
  editorBuildControls: "editor-build-controls-panel.tsx",
  editorDocumentControls: "editor-document-controls-panel.tsx",
  editorSource: "editor-source-panel.tsx",
  editorProjectContext: "editor-project-context-panel.tsx",
  editorSelectionBrushes: "editor-selection-brushes-panel.tsx",
  editorSelectionCommands: "editor-selection-commands-panel.tsx",
  editorEditActions: "editor-edit-actions-panel.tsx",
  editorToolSettings: "editor-tool-settings-panel.tsx",
  editorHistory: "editor-history-panel.tsx",
  editorEntityCreation: "editor-entity-creation-panel.tsx",
  editorTransforms: "editor-transforms-panel.tsx",
  editorGeometry: "editor-geometry-panel.tsx",
  editorEntityInspector: "editor-entity-inspector-panel.tsx",
  editorFaceBasics: "editor-face-basics-panel.tsx",
  editorFaceTexture: "editor-face-texture-panel.tsx",
  editorSurface: "editor-surface-panel.tsx",
  editorUvControls: "editor-uv-controls-panel.tsx",
  editorSwitchMap: "editor-switch-map-panel.tsx",
  editorClipHull: "editor-clip-hull-panel.tsx",
  editorSweep: "editor-sweep-panel.tsx",
  editorTopology: "editor-topology-panel.tsx",
  editorShape: "editor-shape-panel.tsx",
  editorTransformTool: "editor-transform-tool-panel.tsx",
  editorContextMenu: "editor-context-menu-panel.tsx",
  editorDetachedMaps: "editor-detached-maps-panel.tsx",
  recoveredMaps: "recovered-maps.tsx",
  hostedProjects: "hosted-projects.tsx",
  hostedViewerPanel: "hosted-viewer-panel.tsx",
  viewerSourcePanel: "viewer-source-panel.tsx",
  viewerCameraPanel: "viewer-camera-panel.tsx",
  viewerMovementPanel: "viewer-movement-panel.tsx",
  viewerOverviewPanel: "viewer-overview-panel.tsx",
  projectMaps: "project-maps.tsx",
  projectNewMap: "project-new-map.tsx",
  projectAccess: "project-access-page.tsx",
  projectResources: "project-resources-page.tsx",
};
const options = {
  absWorkingDir: root,
  entryPoints: {
    entry: "app/assets/entry.ts",
    viewer: "app/assets/viewer.ts",
    editor: "app/assets/editor.ts",
    editorHostedAccess: "app/assets/editor-hosted-access-panel.tsx",
    editorHostedPresence: "app/assets/editor-hosted-presence-panel.tsx",
    editorPointerReadout: "app/assets/editor-pointer-readout.tsx",
    projectMapSelector: "app/assets/editor-project-map-selector-panel.tsx",
    editorTheme: "app/assets/editor-theme-control.tsx",
    editorRecentProjects: "app/assets/editor-recent-projects-panel.tsx",
    editorVersions: "app/assets/editor-versions-panel.tsx",
    editorProjectSync: "app/assets/editor-project-sync-panel.tsx",
    editorHostedSource: "app/assets/editor-hosted-source-panel.tsx",
    editorSourceCompare: "app/assets/editor-source-compare-panel.tsx",
    editorMaterialBrowser: "app/assets/editor-material-browser-panel.tsx",
    editorIssues: "app/assets/editor-issues-panel.tsx",
    editorVisibility: "app/assets/editor-visibility-panel.tsx",
    editorPerformancePanel: "app/assets/editor-performance-panel.tsx",
    editorHostedResources: "app/assets/editor-hosted-resources-panel.tsx",
    editorHostedPicker: "app/assets/editor-hosted-picker-panel.tsx",
    editorHostedBuilds: "app/assets/editor-hosted-builds-panel.tsx",
    editorFov: "app/assets/editor-fov-panel.tsx",
    editorWorkspaceToggle: "app/assets/editor-workspace-toggle.tsx",
    editorReferences: "app/assets/editor-references-panel.tsx",
    editorLayers: "app/assets/editor-layers-panel.tsx",
    editorGroups: "app/assets/editor-groups-panel.tsx",
    editorExportSettings: "app/assets/editor-export-settings-panel.tsx",
    editorBuildControls: "app/assets/editor-build-controls-panel.tsx",
    editorDocumentControls: "app/assets/editor-document-controls-panel.tsx",
    editorSource: "app/assets/editor-source-panel.tsx",
    editorProjectContext: "app/assets/editor-project-context-panel.tsx",
    editorSelectionBrushes: "app/assets/editor-selection-brushes-panel.tsx",
    editorSelectionCommands: "app/assets/editor-selection-commands-panel.tsx",
    editorEditActions: "app/assets/editor-edit-actions-panel.tsx",
    editorToolSettings: "app/assets/editor-tool-settings-panel.tsx",
    editorHistory: "app/assets/editor-history-panel.tsx",
    editorEntityCreation: "app/assets/editor-entity-creation-panel.tsx",
    editorTransforms: "app/assets/editor-transforms-panel.tsx",
    editorGeometry: "app/assets/editor-geometry-panel.tsx",
    editorEntityInspector: "app/assets/editor-entity-inspector-panel.tsx",
    editorFaceBasics: "app/assets/editor-face-basics-panel.tsx",
    editorFaceTexture: "app/assets/editor-face-texture-panel.tsx",
    editorSurface: "app/assets/editor-surface-panel.tsx",
    editorUvControls: "app/assets/editor-uv-controls-panel.tsx",
    editorSwitchMap: "app/assets/editor-switch-map-panel.tsx",
    editorClipHull: "app/assets/editor-clip-hull-panel.tsx",
    editorSweep: "app/assets/editor-sweep-panel.tsx",
    editorTopology: "app/assets/editor-topology-panel.tsx",
    editorShape: "app/assets/editor-shape-panel.tsx",
    editorTransformTool: "app/assets/editor-transform-tool-panel.tsx",
    editorContextMenu: "app/assets/editor-context-menu-panel.tsx",
    editorDetachedMaps: "app/assets/editor-detached-maps-panel.tsx",
    newMap: "app/assets/new-map-setup.tsx",
    recoveredMaps: "app/assets/recovered-maps.tsx",
    hostedProjects: "app/assets/hosted-projects.tsx",
    hostedViewerPanel: "app/assets/hosted-viewer-panel.tsx",
    viewerSourcePanel: "app/assets/viewer-source-panel.tsx",
    viewerCameraPanel: "app/assets/viewer-camera-panel.tsx",
    viewerMovementPanel: "app/assets/viewer-movement-panel.tsx",
    viewerOverviewPanel: "app/assets/viewer-overview-panel.tsx",
    projectMaps: "app/assets/project-maps.tsx",
    projectNewMap: "app/assets/project-new-map.tsx",
    projectAccess: "app/assets/project-access-page.tsx",
    projectResources: "app/assets/project-resources-page.tsx",
  },
  outdir: path.relative(root, path.join(output, "assets")),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  jsx: "automatic",
  jsxImportSource: "remix/ui",
  splitting: !development,
  entryNames: development ? "[name]" : "[name]-[hash]",
  chunkNames: "chunk-[hash]",
  metafile: true,
  sourcemap: true,
  define: { LOCAL_FIXTURES_ENABLED: JSON.stringify(development) },
  plugins: [
    {
      name: "maps-build-manifest",
      setup(buildContext) {
        buildContext.onEnd(async (result) => {
          if (development || result.errors.length || !result.metafile) return;
          const entryHref = (name) => {
            const sourceName = clientEntrySourceNames[name] ?? `${name}.ts`;
            const entry = Object.entries(result.metafile.outputs).find(
              ([, metadata]) =>
                metadata.entryPoint === `app/assets/${sourceName}`,
            );
            if (!entry)
              throw new Error(`Maps browser build did not emit ${name}`);
            return `/${path.relative(output, path.resolve(root, entry[0])).split(path.sep).join("/")}`;
          };
          await fs.writeFile(
            path.join(root, "app", "assets", "build-manifest.ts"),
            `// Generated by scripts/build.mjs.\nexport const browserAssets = import.meta.env.DEV\n  ? {\n      entry: "/assets/entry.js",\n      viewer: "/assets/viewer.js",\n      editor: "/assets/editor.js",\n      editorTheme: "/assets/editorTheme.js",\n      editorHostedPresence: "/assets/editorHostedPresence.js",
      editorPointerReadout: "/assets/editorPointerReadout.js",\n      editorHostedAccess: "/assets/editorHostedAccess.js",\n      projectMapSelector: "/assets/projectMapSelector.js",\n      editorRecentProjects: "/assets/editorRecentProjects.js",\n      editorVersions: "/assets/editorVersions.js",\n      editorProjectSync: "/assets/editorProjectSync.js",\n      editorHostedSource: "/assets/editorHostedSource.js",\n      editorSourceCompare: "/assets/editorSourceCompare.js",\n      editorMaterialBrowser: "/assets/editorMaterialBrowser.js",\n      editorIssues: "/assets/editorIssues.js",\n      editorVisibility: "/assets/editorVisibility.js",\n      editorPerformancePanel: "/assets/editorPerformancePanel.js",\n      editorHostedResources: "/assets/editorHostedResources.js",\n      editorHostedPicker: "/assets/editorHostedPicker.js",\n      editorHostedBuilds: "/assets/editorHostedBuilds.js",\n      editorFov: "/assets/editorFov.js",\n      editorWorkspaceToggle: "/assets/editorWorkspaceToggle.js",\n      editorReferences: "/assets/editorReferences.js",\n      editorLayers: "/assets/editorLayers.js",\n      editorGroups: "/assets/editorGroups.js",\n      editorExportSettings: "/assets/editorExportSettings.js",\n      editorBuildControls: "/assets/editorBuildControls.js",\n      editorDocumentControls: "/assets/editorDocumentControls.js",\n      editorSource: "/assets/editorSource.js",\n      editorProjectContext: "/assets/editorProjectContext.js",\n      editorSelectionBrushes: "/assets/editorSelectionBrushes.js",\n      editorSelectionCommands: "/assets/editorSelectionCommands.js",\n      editorEditActions: "/assets/editorEditActions.js",\n      editorToolSettings: "/assets/editorToolSettings.js",\n      editorHistory: "/assets/editorHistory.js",\n      editorEntityCreation: "/assets/editorEntityCreation.js",\n      editorTransforms: "/assets/editorTransforms.js",\n      editorGeometry: "/assets/editorGeometry.js",\n      editorEntityInspector: "/assets/editorEntityInspector.js",\n      editorFaceBasics: "/assets/editorFaceBasics.js",\n      editorFaceTexture: "/assets/editorFaceTexture.js",\n      editorSurface: "/assets/editorSurface.js",\n      editorUvControls: "/assets/editorUvControls.js",\n      editorSwitchMap: "/assets/editorSwitchMap.js",\n      editorClipHull: "/assets/editorClipHull.js",\n      editorSweep: "/assets/editorSweep.js",\n      editorTopology: "/assets/editorTopology.js",\n      editorShape: "/assets/editorShape.js",\n      editorTransformTool: "/assets/editorTransformTool.js",\n      editorContextMenu: "/assets/editorContextMenu.js",\n      editorDetachedMaps: "/assets/editorDetachedMaps.js",\n      newMap: "/assets/newMap.js",\n      recoveredMaps: "/assets/recoveredMaps.js",\n      hostedProjects: "/assets/hostedProjects.js",\n      hostedViewerPanel: "/assets/hostedViewerPanel.js",\n      viewerSourcePanel: "/assets/viewerSourcePanel.js",\n      viewerCameraPanel: "/assets/viewerCameraPanel.js",\n      viewerMovementPanel: "/assets/viewerMovementPanel.js",\n      viewerOverviewPanel: "/assets/viewerOverviewPanel.js",\n      projectMaps: "/assets/projectMaps.js",\n      projectNewMap: "/assets/projectNewMap.js",\n      projectAccess: "/assets/projectAccess.js",\n      projectResources: "/assets/projectResources.js",\n    }\n  : {\n      entry: ${JSON.stringify(entryHref("entry"))},\n      viewer: ${JSON.stringify(entryHref("viewer"))},\n      editor: ${JSON.stringify(entryHref("editor"))},\n      editorTheme: ${JSON.stringify(entryHref("editorTheme"))},\n      editorHostedPresence: ${JSON.stringify(entryHref("editorHostedPresence"))},
      editorPointerReadout: ${JSON.stringify(entryHref("editorPointerReadout"))},\n      editorHostedAccess: ${JSON.stringify(entryHref("editorHostedAccess"))},\n      projectMapSelector: ${JSON.stringify(entryHref("projectMapSelector"))},\n      editorRecentProjects: ${JSON.stringify(entryHref("editorRecentProjects"))},\n      editorVersions: ${JSON.stringify(entryHref("editorVersions"))},\n      editorProjectSync: ${JSON.stringify(entryHref("editorProjectSync"))},\n      editorHostedSource: ${JSON.stringify(entryHref("editorHostedSource"))},\n      editorSourceCompare: ${JSON.stringify(entryHref("editorSourceCompare"))},\n      editorMaterialBrowser: ${JSON.stringify(entryHref("editorMaterialBrowser"))},\n      editorIssues: ${JSON.stringify(entryHref("editorIssues"))},\n      editorVisibility: ${JSON.stringify(entryHref("editorVisibility"))},\n      editorPerformancePanel: ${JSON.stringify(entryHref("editorPerformancePanel"))},\n      editorHostedResources: ${JSON.stringify(entryHref("editorHostedResources"))},\n      editorHostedPicker: ${JSON.stringify(entryHref("editorHostedPicker"))},\n      editorHostedBuilds: ${JSON.stringify(entryHref("editorHostedBuilds"))},\n      editorFov: ${JSON.stringify(entryHref("editorFov"))},\n      editorWorkspaceToggle: ${JSON.stringify(entryHref("editorWorkspaceToggle"))},\n      editorReferences: ${JSON.stringify(entryHref("editorReferences"))},\n      editorLayers: ${JSON.stringify(entryHref("editorLayers"))},\n      editorGroups: ${JSON.stringify(entryHref("editorGroups"))},\n      editorExportSettings: ${JSON.stringify(entryHref("editorExportSettings"))},\n      editorBuildControls: ${JSON.stringify(entryHref("editorBuildControls"))},\n      editorDocumentControls: ${JSON.stringify(entryHref("editorDocumentControls"))},\n      editorSource: ${JSON.stringify(entryHref("editorSource"))},\n      editorProjectContext: ${JSON.stringify(entryHref("editorProjectContext"))},\n      editorSelectionBrushes: ${JSON.stringify(entryHref("editorSelectionBrushes"))},\n      editorSelectionCommands: ${JSON.stringify(entryHref("editorSelectionCommands"))},\n      editorEditActions: ${JSON.stringify(entryHref("editorEditActions"))},\n      editorToolSettings: ${JSON.stringify(entryHref("editorToolSettings"))},\n      editorHistory: ${JSON.stringify(entryHref("editorHistory"))},\n      editorEntityCreation: ${JSON.stringify(entryHref("editorEntityCreation"))},\n      editorTransforms: ${JSON.stringify(entryHref("editorTransforms"))},\n      editorGeometry: ${JSON.stringify(entryHref("editorGeometry"))},\n      editorEntityInspector: ${JSON.stringify(entryHref("editorEntityInspector"))},\n      editorFaceBasics: ${JSON.stringify(entryHref("editorFaceBasics"))},\n      editorFaceTexture: ${JSON.stringify(entryHref("editorFaceTexture"))},\n      editorSurface: ${JSON.stringify(entryHref("editorSurface"))},\n      editorUvControls: ${JSON.stringify(entryHref("editorUvControls"))},\n      editorSwitchMap: ${JSON.stringify(entryHref("editorSwitchMap"))},\n      editorClipHull: ${JSON.stringify(entryHref("editorClipHull"))},\n      editorSweep: ${JSON.stringify(entryHref("editorSweep"))},\n      editorTopology: ${JSON.stringify(entryHref("editorTopology"))},\n      editorShape: ${JSON.stringify(entryHref("editorShape"))},\n      editorTransformTool: ${JSON.stringify(entryHref("editorTransformTool"))},\n      editorContextMenu: ${JSON.stringify(entryHref("editorContextMenu"))},\n      editorDetachedMaps: ${JSON.stringify(entryHref("editorDetachedMaps"))},\n      newMap: ${JSON.stringify(entryHref("newMap"))},\n      recoveredMaps: ${JSON.stringify(entryHref("recoveredMaps"))},\n      hostedProjects: ${JSON.stringify(entryHref("hostedProjects"))},\n      hostedViewerPanel: ${JSON.stringify(entryHref("hostedViewerPanel"))},\n      viewerSourcePanel: ${JSON.stringify(entryHref("viewerSourcePanel"))},\n      viewerCameraPanel: ${JSON.stringify(entryHref("viewerCameraPanel"))},\n      viewerMovementPanel: ${JSON.stringify(entryHref("viewerMovementPanel"))},\n      viewerOverviewPanel: ${JSON.stringify(entryHref("viewerOverviewPanel"))},\n      projectMaps: ${JSON.stringify(entryHref("projectMaps"))},\n      projectNewMap: ${JSON.stringify(entryHref("projectNewMap"))},\n      projectAccess: ${JSON.stringify(entryHref("projectAccess"))},\n      projectResources: ${JSON.stringify(entryHref("projectResources"))},\n    };\n`,
          );
        });
      },
    },
  ],
};

async function checkClientEntries() {
  const assets = path.join(root, "app", "assets");
  const sourceNames = Object.values(clientEntrySourceNames);
  const registered = new Set(sourceNames);
  const discovered = [];
  for (const filename of await fs.readdir(assets)) {
    if (!/\.tsx?$/u.test(filename)) continue;
    const source = await fs.readFile(path.join(assets, filename), "utf8");
    if (/\bclientEntry\s*\(/u.test(source)) discovered.push(filename);
  }
  const missing = discovered.filter((filename) => !registered.has(filename));
  const stale = sourceNames.filter(
    (filename) => !discovered.includes(filename),
  );
  if (missing.length || stale.length)
    throw new Error(
      `Maps client entry registry is out of sync: missing ${missing.join(", ") || "none"}; stale ${stale.join(", ") || "none"}`,
    );

  const worker = await fs.readFile(path.join(root, "worker.ts"), "utf8");
  const workerMappings = new Map(
    [...worker.matchAll(/"([^"]+\.tsx?)": browserAssets\.([A-Za-z]\w*)/gu)].map(
      ([, filename, name]) => [filename, name],
    ),
  );
  for (const [name, filename] of Object.entries(clientEntrySourceNames)) {
    if (options.entryPoints[name] !== `app/assets/${filename}`)
      throw new Error(`Maps client entry ${name} has no browser build input`);
    if (workerMappings.get(filename) !== name)
      throw new Error(
        `Maps client entry ${filename} has no Worker asset mapping`,
      );
  }
  const extraInputs = Object.keys(options.entryPoints).filter(
    (name) =>
      !["entry", "viewer", "editor"].includes(name) &&
      !Object.hasOwn(clientEntrySourceNames, name),
  );
  if (extraInputs.length)
    throw new Error(
      `Maps browser build has stale client entries: ${extraInputs.join(", ")}`,
    );
  const unmapped = [...workerMappings.keys()].filter(
    (filename) => !registered.has(filename),
  );
  if (unmapped.length)
    throw new Error(
      `Maps Worker has stale client entries: ${unmapped.join(", ")}`,
    );
}

await checkClientEntries();
if (!watch) {
  await fs.rm(output, { recursive: true, force: true });
  await fs.cp(path.join(root, "public"), output, { recursive: true });
}
await fs.mkdir(path.join(output, "assets"), { recursive: true });

if (watch) {
  const buildContext = await context(options);
  await buildContext.watch();
} else {
  await build(options);
}
