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
          if (sourceId !== "file:///app/game/burger-game.tsx")
            throw new Error(`Unknown Burger client entry ${sourceId}`);
          return {
            href: "/assets/burger-game.js",
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
