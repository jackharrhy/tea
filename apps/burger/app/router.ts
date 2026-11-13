import { render } from "remix/middleware/render";
import { csp } from "remix/middleware/csp";
import { createRouter, type MiddlewareContext } from "remix/router";
import controller from "./controller.tsx";
import { routes } from "./routes.ts";

type AppContext = MiddlewareContext<
  [ReturnType<typeof csp>, ReturnType<typeof render>]
>;

declare module "remix/router" {
  interface RouterTypes {
    context: AppContext;
  }
}

const router = createRouter<AppContext>({
  middleware: [
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
          scriptSrc: ["'self'", `'nonce-${nonce}'`, "'unsafe-eval'"],
          styleSrc: ["'self'", `'nonce-${nonce}'`],
          styleSrcAttr: ["'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          mediaSrc: ["'self'", "blob:"],
          fontSrc: ["'self'", "data:"],
          connectSrc: ["'self'", socketOrigin],
          workerSrc: ["'self'", "blob:"],
          formAction: ["'self'"],
          baseUri: ["'none'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        };
      },
    }),
    render({
      assets: {
        async getScriptEntry(sourceId) {
          if (sourceId === "file:///app/atlas/editor.tsx")
            return {
              href: "/assets/burger-atlas.js",
              preloads: [],
              importMap: { imports: {} },
            };
          if (sourceId === "file:///app/game/burger-tools.tsx")
            return {
              href: "/assets/burger-tools.js",
              preloads: [],
              importMap: { imports: {} },
            };
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
