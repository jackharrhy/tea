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

const router = createRouter<AppContext>({
  middleware: [
    render({
      assets: {
        async getScriptEntry(sourceId) {
          const href = sourceId.endsWith("/app/assets/recovered-maps.tsx")
            ? browserAssets.recoveredMaps
            : sourceId.endsWith("/app/assets/hosted-projects.tsx")
              ? browserAssets.hostedProjects
              : sourceId.endsWith("/app/assets/new-map-setup.tsx")
                ? browserAssets.newMap
                : sourceId.endsWith("/app/assets/project-maps.tsx")
                  ? browserAssets.projectMaps
                  : sourceId.endsWith("/app/assets/project-new-map.tsx")
                    ? browserAssets.projectNewMap
                    : sourceId.endsWith("/app/assets/project-access-page.tsx")
                      ? browserAssets.projectAccess
                      : null;
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
