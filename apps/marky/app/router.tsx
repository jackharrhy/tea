import type { Cookie } from "remix/cookie";
import { render } from "remix/middleware/render";
import { session } from "remix/middleware/session";
import {
  createController,
  createRouter as createFetchRouter,
  type MiddlewareContext,
} from "remix/router";
import type { SessionStorage } from "remix/session";

import { assets } from "./assets.ts";
import type { AppConfig } from "./config.ts";
import { createAuthController } from "./controllers/auth/controller.tsx";
import { EditorPage } from "./ui/editor/editor-page.tsx";
import { routes } from "./routes.ts";
import { redirect } from "remix/response/redirect";
import type { IdentityValue } from "./middleware/auth.ts";

const rendering = render({ assets });
export type AppContext = MiddlewareContext<
  [ReturnType<typeof session>, typeof rendering]
>;
declare module "remix" {
  interface RouterTypes {
    context: AppContext;
  }
}

export interface RouterDeps {
  config: AppConfig;
  sessionStorage: SessionStorage;
  sessionCookie: Cookie;
}

export function createRouter(deps: RouterDeps) {
  const router = createFetchRouter<AppContext>({
    middleware: [session(deps.sessionCookie, deps.sessionStorage), rendering],
  });

  router.map(
    routes,
    createController(routes, {
      actions: {
        async assets(context) {
          return (
            (await assets.fetch(context.request)) ??
            new Response("Not Found", { status: 404 })
          );
        },
        home(context) {
          if (deps.config.auth.mode === "anonymous") {
            return context.render(
              <EditorPage authMode={{ mode: "anonymous" }} />,
            );
          }
          const identity = context.session.get("identity") as
            | IdentityValue
            | undefined;
          if (!identity) return redirect(routes.auth.signIn.href());
          return context.render(
            <EditorPage
              authMode={{
                mode: "discord",
                identity: { name: identity.name, color: identity.color },
              }}
            />,
          );
        },
      },
    }),
  );
  if (deps.config.auth.mode === "discord") {
    router.map(routes.auth, createAuthController({ auth: deps.config.auth }));
  }
  return router;
}
