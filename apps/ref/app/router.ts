import { createRouter, type MiddlewareContext } from "remix/router";
import { formData } from "remix/middleware/form-data";
import { render } from "remix/middleware/render";
import rootController from "./actions/controller.tsx";
import boardsController from "./actions/boards/controller.tsx";
import resourcesController from "./actions/resources/controller.tsx";
import archiveController from "./actions/archive/controller.ts";
import {
  AppRuntime,
  AppPassword,
  Authenticated,
  CurrentSessionToken,
  type AppRuntimeService,
} from "./data/runtime.ts";
import { routes } from "./routes.ts";

export type AppContext = MiddlewareContext<
  [ReturnType<typeof formData>, ReturnType<typeof render>]
>;

declare module "remix/router" {
  interface RouterTypes {
    context: AppContext;
  }
}

export function createAppRouter(
  runtime: AppRuntimeService,
  authenticated: boolean,
  token: string | null,
  password: string,
) {
  const router = createRouter<AppContext>({
    middleware: [
      (context, next) => {
        context.set(AppRuntime, runtime);
        context.set(Authenticated, authenticated);
        context.set(CurrentSessionToken, token);
        context.set(AppPassword, password);
        return next();
      },
      formData({
        maxFiles: 1,
        maxFileSize: 20 * 1024 * 1024,
        maxParts: 12,
        maxTotalSize: 21 * 1024 * 1024,
      }),
      render(),
    ],
  });
  router.map(routes, rootController);
  router.map(routes.boards, boardsController);
  router.map(routes.resources, resourcesController);
  router.map(routes.archive, archiveController);
  return router;
}
