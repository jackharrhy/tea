import { createRouter, type MiddlewareContext } from "remix/router";
import { render } from "remix/middleware/render";
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

const router = createRouter<AppContext>({ middleware: [render()] });
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
