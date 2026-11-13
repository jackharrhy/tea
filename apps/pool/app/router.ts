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
          scriptSrc: [
            "'self'",
            `'nonce-${nonce}'`,
            "'wasm-unsafe-eval'",
            "'unsafe-eval'",
          ],
          styleSrc: ["'self'", `'nonce-${nonce}'`],
          styleSrcAttr: ["'unsafe-inline'"],
          fontSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "blob:"],
          mediaSrc: ["'self'", "blob:"],
          connectSrc: ["'self'", socketOrigin, "data:"],
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
