import { staticPlugin } from "@elysia/static";

import type { Config } from "./config.ts";
import type { Db } from "./db/index.ts";
import { createHttpApp } from "./http.ts";
import { apiOpenApi } from "./openapi.ts";
import { adminRoutes } from "./routes/admin/index.ts";
import { mountDesignRoutes } from "./routes/admin/design.tsx";
import { apiRoutes } from "./routes/api.ts";
import { mcpRoutes } from "./routes/mcp.ts";
import { oauthRoutes } from "./routes/oauth.tsx";
import { publicRoutes } from "./routes/public.ts";
import { webhookRoutes } from "./routes/webhooks.ts";
import { createAdminRouter } from "../app/admin-router.tsx";
import { createAuthRouter } from "../app/auth-router.ts";
import { resourceMetadataRoutes } from "./routes/resource-metadata.ts";

export function createApplication(db: Db, config: Config) {
  const app = createHttpApp();
  const identityRouter = config.identity ? createAuthRouter(db, config) : null;
  mountDesignRoutes(app);
  return app
    .use(apiOpenApi())
    .use(staticPlugin({ assets: "public", prefix: "/static" }))
    .get("/health", () => ({ ok: true }))
    .get("/", ({ redirect }) => redirect("/subscribe", 302))
    .get("/auth/login", ({ request }) =>
      identityRouter
        ? identityRouter.fetch(request)
        : new Response("Not Found", { status: 404 }),
    )
    .get("/auth/callback", ({ request }) =>
      identityRouter
        ? identityRouter.fetch(request)
        : new Response("Not Found", { status: 404 }),
    )
    .use(
      config.identity
        ? resourceMetadataRoutes(config)
        : oauthRoutes(db, config),
    )
    .use(publicRoutes(db, config))
    .group("/webhooks", (routes) => routes.use(webhookRoutes(db)))
    .group("/api", (routes) => routes.use(apiRoutes(db, config)))
    .group("/mcp", (routes) => routes.use(mcpRoutes(db, config)))
    .group("/admin", (routes) =>
      routes.use(
        adminRoutes(db, config, (request, user) => {
          const url = new URL(request.url);
          url.pathname = "/admin";
          return createAdminRouter(db, user).fetch(new Request(url, request));
        }),
      ),
    );
}
