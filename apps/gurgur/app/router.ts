import { render } from "remix/middleware/render";
import { csp } from "remix/middleware/csp";
import { createRouter, type MiddlewareContext } from "remix/router";
import controller from "./controller";
import { routes } from "./routes";

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
          scriptSrc: ["'self'", `'nonce-${nonce}'`],
          styleSrc: ["'self'", `'nonce-${nonce}'`],
          styleSrcAttr: ["'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          mediaSrc: ["'self'", "blob:"],
          fontSrc: ["'self'"],
          connectSrc: ["'self'", socketOrigin],
          workerSrc: ["'self'"],
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
