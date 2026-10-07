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
  editorDetachedMaps: "editor-detached-maps-panel.tsx",
  recoveredMaps: "recovered-maps.tsx",
  hostedProjects: "hosted-projects.tsx",
  hostedViewerPanel: "hosted-viewer-panel.tsx",
  viewerSourcePanel: "viewer-source-panel.tsx",
  projectMaps: "project-maps.tsx",
  projectNewMap: "project-new-map.tsx",
  projectAccess: "project-access-page.tsx",
  projectResources: "project-resources-page.tsx",
};
if (!watch) {
  await fs.rm(output, { recursive: true, force: true });
  await fs.cp(path.join(root, "public"), output, { recursive: true });
}
await fs.mkdir(path.join(output, "assets"), { recursive: true });

const options = {
  absWorkingDir: root,
  entryPoints: {
    entry: "app/assets/entry.ts",
    viewer: "app/assets/viewer.ts",
    editor: "app/assets/editor.ts",
    editorHostedAccess: "app/assets/editor-hosted-access-panel.tsx",
    editorHostedPresence: "app/assets/editor-hosted-presence-panel.tsx",
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
    editorDetachedMaps: "app/assets/editor-detached-maps-panel.tsx",
    newMap: "app/assets/new-map-setup.tsx",
    recoveredMaps: "app/assets/recovered-maps.tsx",
    hostedProjects: "app/assets/hosted-projects.tsx",
    hostedViewerPanel: "app/assets/hosted-viewer-panel.tsx",
    viewerSourcePanel: "app/assets/viewer-source-panel.tsx",
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
            `// Generated by scripts/build.mjs.\nexport const browserAssets = import.meta.env.DEV\n  ? {\n      entry: "/assets/entry.js",\n      viewer: "/assets/viewer.js",\n      editor: "/assets/editor.js",\n      editorTheme: "/assets/editorTheme.js",\n      editorHostedPresence: "/assets/editorHostedPresence.js",\n      editorHostedAccess: "/assets/editorHostedAccess.js",\n      projectMapSelector: "/assets/projectMapSelector.js",\n      editorRecentProjects: "/assets/editorRecentProjects.js",\n      editorVersions: "/assets/editorVersions.js",\n      editorProjectSync: "/assets/editorProjectSync.js",\n      editorHostedSource: "/assets/editorHostedSource.js",\n      editorSourceCompare: "/assets/editorSourceCompare.js",\n      editorMaterialBrowser: "/assets/editorMaterialBrowser.js",\n      editorIssues: "/assets/editorIssues.js",\n      editorVisibility: "/assets/editorVisibility.js",\n      editorPerformancePanel: "/assets/editorPerformancePanel.js",\n      editorHostedResources: "/assets/editorHostedResources.js",\n      editorHostedPicker: "/assets/editorHostedPicker.js",\n      editorHostedBuilds: "/assets/editorHostedBuilds.js",\n      editorFov: "/assets/editorFov.js",\n      editorDetachedMaps: "/assets/editorDetachedMaps.js",\n      newMap: "/assets/newMap.js",\n      recoveredMaps: "/assets/recoveredMaps.js",\n      hostedProjects: "/assets/hostedProjects.js",\n      hostedViewerPanel: "/assets/hostedViewerPanel.js",\n      viewerSourcePanel: "/assets/viewerSourcePanel.js",\n      projectMaps: "/assets/projectMaps.js",\n      projectNewMap: "/assets/projectNewMap.js",\n      projectAccess: "/assets/projectAccess.js",\n      projectResources: "/assets/projectResources.js",\n    }\n  : {\n      entry: ${JSON.stringify(entryHref("entry"))},\n      viewer: ${JSON.stringify(entryHref("viewer"))},\n      editor: ${JSON.stringify(entryHref("editor"))},\n      editorTheme: ${JSON.stringify(entryHref("editorTheme"))},\n      editorHostedPresence: ${JSON.stringify(entryHref("editorHostedPresence"))},\n      editorHostedAccess: ${JSON.stringify(entryHref("editorHostedAccess"))},\n      projectMapSelector: ${JSON.stringify(entryHref("projectMapSelector"))},\n      editorRecentProjects: ${JSON.stringify(entryHref("editorRecentProjects"))},\n      editorVersions: ${JSON.stringify(entryHref("editorVersions"))},\n      editorProjectSync: ${JSON.stringify(entryHref("editorProjectSync"))},\n      editorHostedSource: ${JSON.stringify(entryHref("editorHostedSource"))},\n      editorSourceCompare: ${JSON.stringify(entryHref("editorSourceCompare"))},\n      editorMaterialBrowser: ${JSON.stringify(entryHref("editorMaterialBrowser"))},\n      editorIssues: ${JSON.stringify(entryHref("editorIssues"))},\n      editorVisibility: ${JSON.stringify(entryHref("editorVisibility"))},\n      editorPerformancePanel: ${JSON.stringify(entryHref("editorPerformancePanel"))},\n      editorHostedResources: ${JSON.stringify(entryHref("editorHostedResources"))},\n      editorHostedPicker: ${JSON.stringify(entryHref("editorHostedPicker"))},\n      editorHostedBuilds: ${JSON.stringify(entryHref("editorHostedBuilds"))},\n      editorFov: ${JSON.stringify(entryHref("editorFov"))},\n      editorDetachedMaps: ${JSON.stringify(entryHref("editorDetachedMaps"))},\n      newMap: ${JSON.stringify(entryHref("newMap"))},\n      recoveredMaps: ${JSON.stringify(entryHref("recoveredMaps"))},\n      hostedProjects: ${JSON.stringify(entryHref("hostedProjects"))},\n      hostedViewerPanel: ${JSON.stringify(entryHref("hostedViewerPanel"))},\n      viewerSourcePanel: ${JSON.stringify(entryHref("viewerSourcePanel"))},\n      projectMaps: ${JSON.stringify(entryHref("projectMaps"))},\n      projectNewMap: ${JSON.stringify(entryHref("projectNewMap"))},\n      projectAccess: ${JSON.stringify(entryHref("projectAccess"))},\n      projectResources: ${JSON.stringify(entryHref("projectResources"))},\n    };\n`,
          );
        });
      },
    },
  ],
};

if (watch) {
  const buildContext = await context(options);
  await buildContext.watch();
} else {
  await build(options);
}
