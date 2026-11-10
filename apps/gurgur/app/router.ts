import { render } from "remix/middleware/render";
import { createRouter, type MiddlewareContext } from "remix/router";
import controller from "./controller";
import { routes } from "./routes";

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
          if (sourceId !== "file:///app/world.tsx")
            throw new Error(`Unknown Gurgur client entry ${sourceId}`);
          return {
            href: "/assets/world.js",
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
