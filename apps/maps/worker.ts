import { createRouter, type MiddlewareContext } from "remix/router";
import { render } from "remix/middleware/render";
import { browserAssets } from "./app/assets/build-manifest.ts";
import controller from "./app/controller.tsx";
import { routes } from "./app/routes.ts";
import {
  isCollaborationPath,
  isServicePath,
  proxyCollaborationRequest,
  proxyServiceRequest,
} from "./app/service-proxy.ts";

type AppContext = MiddlewareContext<[ReturnType<typeof render>]>;

declare module "remix/router" {
  interface RouterTypes {
    context: AppContext;
  }
}

const clientEntryFiles = {
  "editor-hosted-access-panel.tsx": browserAssets.editorHostedAccess,
  "editor-hosted-presence-panel.tsx": browserAssets.editorHostedPresence,
  "editor-project-map-selector-panel.tsx": browserAssets.projectMapSelector,
  "editor-theme-control.tsx": browserAssets.editorTheme,
  "recovered-maps.tsx": browserAssets.recoveredMaps,
  "editor-recent-projects-panel.tsx": browserAssets.editorRecentProjects,
  "editor-versions-panel.tsx": browserAssets.editorVersions,
  "editor-project-sync-panel.tsx": browserAssets.editorProjectSync,
  "editor-hosted-source-panel.tsx": browserAssets.editorHostedSource,
  "editor-source-compare-panel.tsx": browserAssets.editorSourceCompare,
  "editor-material-browser-panel.tsx": browserAssets.editorMaterialBrowser,
  "editor-issues-panel.tsx": browserAssets.editorIssues,
  "editor-visibility-panel.tsx": browserAssets.editorVisibility,
  "editor-performance-panel.tsx": browserAssets.editorPerformancePanel,
  "editor-hosted-resources-panel.tsx": browserAssets.editorHostedResources,
  "hosted-projects.tsx": browserAssets.hostedProjects,
  "hosted-viewer-panel.tsx": browserAssets.hostedViewerPanel,
  "viewer-source-panel.tsx": browserAssets.viewerSourcePanel,
  "new-map-setup.tsx": browserAssets.newMap,
  "project-maps.tsx": browserAssets.projectMaps,
  "project-new-map.tsx": browserAssets.projectNewMap,
  "project-access-page.tsx": browserAssets.projectAccess,
  "project-resources-page.tsx": browserAssets.projectResources,
};

const router = createRouter<AppContext>({
  middleware: [
    render({
      assets: {
        async getScriptEntry(sourceId) {
          const href = Object.entries(clientEntryFiles).find(([filename]) =>
            sourceId.endsWith(`/app/assets/${filename}`),
          )?.[1];
          if (!href) throw new Error(`Unknown Maps client entry ${sourceId}`);
          return {
            href,
            preloads: [],
            importMap: { imports: {} },
          };
        },
      },
    }),
  ],
});
router.map(routes, controller);

export default {
  fetch(
    request: Request,
    env: {
      ASSETS: { fetch(request: Request): Promise<Response> };
      MAPS_SERVICE_ORIGIN: string;
      MAPS_COLLABORATION_ORIGIN: string;
    },
  ): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (isServicePath(pathname)) {
      return proxyServiceRequest(request, env.MAPS_SERVICE_ORIGIN);
    }
    if (isCollaborationPath(pathname)) {
      return proxyCollaborationRequest(request, env.MAPS_COLLABORATION_ORIGIN);
    }
    if (pathname.startsWith("/assets/") || pathname === "/favicon.svg") {
      return env.ASSETS.fetch(request);
    }
    return router.fetch(request);
  },
};
