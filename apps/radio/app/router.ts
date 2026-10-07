import { createRouter, type MiddlewareContext } from "remix/router";
import { formData } from "remix/middleware/form-data";
import { cop } from "remix/middleware/cop";
import controller from "./actions/controller.tsx";
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
      render(),
      radioRuntime(service),
    ],
  });

  router.map(routes, controller);
  router.map(routes.dev, devController);
  router.map(routes.rooms, roomsController);
  router.map(routes.resources, resourcesController);
  return router;
}
