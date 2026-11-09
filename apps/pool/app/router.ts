import { render } from "remix/middleware/render";
import { createRouter, type MiddlewareContext } from "remix/router";
import controller from "./controller.tsx";
import { routes } from "./routes.ts";

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
          if (sourceId !== "file:///app/game/pool-game.tsx")
            throw new Error(`Unknown Pool client entry ${sourceId}`);
          return {
            href: "/assets/pool-game.js",
            preloads: [],
            importMap: { imports: {} },
          };
        },
      },
    }),
  ],
});
router.map(routes, controller);

export { router };
