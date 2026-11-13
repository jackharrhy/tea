import { createRouter, type MiddlewareContext } from "remix/router";
import { formData } from "remix/middleware/form-data";
import { cop } from "remix/middleware/cop";
import { csp } from "remix/middleware/csp";
import controller from "./actions/controller.tsx";
import authController from "./actions/auth-controller.ts";
import devController from "./actions/dev/controller.tsx";
import resourcesController from "./actions/resources/controller.tsx";
import roomsController from "./actions/rooms/controller.tsx";
import {
  radioRuntime,
  type RadioRuntimeService,
} from "./data/radio-runtime.ts";
import {
  access,
  radioSession,
  type RadioAccessConfig,
} from "./middleware/access.ts";
import { render } from "./middleware/render.tsx";
import { routes } from "./routes.ts";

type AppContext = MiddlewareContext<
  [
    ReturnType<typeof radioSession>,
    ReturnType<typeof access>,
    ReturnType<typeof formData>,
    ReturnType<typeof csp>,
    ReturnType<typeof render>,
    ReturnType<typeof radioRuntime>,
    ReturnType<typeof cop>,
  ]
>;

declare module "remix/router" {
  interface RouterTypes {
    context: AppContext;
  }
}

export function createAppRouter(
  service: RadioRuntimeService,
  config: RadioAccessConfig,
) {
  let router = createRouter<AppContext>({
    middleware: [
      cop(),
      radioSession(config),
      access(config),
      formData(),
      async (_context, next) => {
        const response = await next();
        if (response.headers.get("Content-Type")?.startsWith("text/html"))
          response.headers.set("Cache-Control", "private, no-store");
        return response;
      },
      csp({
        policy: ({ nonce, context }) => {
          const url = new URL(context.request.url);
          const socketOrigin = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
          return {
            defaultSrc: ["'none'"],
            scriptSrc: ["'self'", `'nonce-${nonce}'`],
            styleSrc: ["'self'", `'nonce-${nonce}'`],
            styleSrcAttr: ["'unsafe-inline'"],
            fontSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "blob:"],
            mediaSrc: ["'self'", "blob:"],
            connectSrc: ["'self'", socketOrigin],
            formAction: ["'self'"],
            baseUri: ["'none'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
          };
        },
      }),
      render(),
      radioRuntime(service),
    ],
  });

  router.map(routes, controller);
  router.map(routes.auth, authController);
  router.map(routes.dev, devController);
  router.map(routes.rooms, roomsController);
  router.map(routes.resources, resourcesController);
  return router;
}
