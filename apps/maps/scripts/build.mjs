import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const root = process.cwd();
const watch = process.argv.includes("--watch");
const development = process.argv.includes("--dev") || watch;
const output = path.join(root, "dist", development ? "client-dev" : "client");
const clientEntrySourceNames = {
  editorHostedAccess: "editor-hosted-access-panel.tsx",
  editorHostedPresence: "editor-hosted-presence-panel.tsx",
  editorPointerReadout: "editor-pointer-readout.tsx",
  editorFaceInspector: "editor-face-inspector-panel.tsx",
  editorReadouts: "editor-readouts.tsx",
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
  viewerWalkabilityPanel: "viewer-walkability-panel.tsx",
  viewerAudioPanel: "viewer-audio-panel.tsx",
  viewerDiagnosticsPanel: "viewer-diagnostics-panel.tsx",
  viewerChrome: "viewer-chrome.tsx",
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
    editorFaceInspector: "app/assets/editor-face-inspector-panel.tsx",
    editorReadouts: "app/assets/editor-readouts.tsx",
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
    viewerWalkabilityPanel: "app/assets/viewer-walkability-panel.tsx",
    viewerAudioPanel: "app/assets/viewer-audio-panel.tsx",
    viewerDiagnosticsPanel: "app/assets/viewer-diagnostics-panel.tsx",
    viewerChrome: "app/assets/viewer-chrome.tsx",
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
          if (result.errors.length || !result.metafile) return;
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
          const entries = Object.fromEntries(
            Object.keys(options.entryPoints).map((name) => [
              name,
              entryHref(name),
            ]),
          );
          const properties = Object.entries(entries)
            .map(([name, href]) => `  ${name}: ${JSON.stringify(href)},`)
            .join("\n");
          await fs.writeFile(
            path.join(root, "app", "assets", "build-manifest.ts"),
            `// Generated by scripts/build.mjs.\nexport const browserAssets = {\n${properties}\n} as const;\n`,
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
    if (/\bclientEntry\s*\(/u.test(source)) {
      if (source.includes("${import.meta.url}#"))
        throw new Error(`${filename} uses an unstable client entry ID`);
      discovered.push(filename);
    }
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
  const phosphor = path.dirname(
    fileURLToPath(import.meta.resolve("@phosphor-icons/web/regular")),
  );
  await fs.mkdir(path.join(output, "icons"), { recursive: true });
  await fs.copyFile(
    path.join(phosphor, "style.css"),
    path.join(output, "icons", "style.css"),
  );
  await fs.copyFile(
    path.join(phosphor, "Phosphor.woff2"),
    path.join(output, "icons", "Phosphor.woff2"),
  );
}
await fs.mkdir(path.join(output, "assets"), { recursive: true });

if (watch) {
  const buildContext = await context(options);
  await buildContext.watch();
} else {
  await build(options);
}
