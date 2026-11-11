import type { Config } from "./config.ts";
import type { Db } from "./db/index.ts";
import { createHttpApp } from "./http.ts";
import { adminRoutes } from "./routes/admin/index.ts";
import { mountDesignRoutes } from "./routes/admin/design.tsx";
import { oauthRoutes } from "./routes/oauth.tsx";
import { createAdminRouter } from "../app/admin-router.tsx";
import { createAuthRouter } from "../app/auth-router.ts";
import { createListsRouter } from "../app/router.tsx";
import { createMainRouter, createStaticRouter } from "../app/main-router.ts";
import { createApiRouter } from "../app/api-router.ts";
import { createMcpRouter } from "../app/mcp-router.ts";
import { createWebhookRouter } from "../app/webhook-router.ts";
import { getSessionUser } from "./auth.ts";
import { createAdminAuthRouter } from "../app/admin-auth-router.tsx";

function createLegacyApplication(db: Db, config: Config) {
  const app = createHttpApp();
  mountDesignRoutes(app);
  return app
    .use(config.identity ? createHttpApp() : oauthRoutes(db, config))
    .group("/admin", (routes) =>
      routes.use(
        adminRoutes(db, config, (request, user) => {
          const url = new URL(request.url);
          if (url.pathname === "/admin/") url.pathname = "/admin";
          return createAdminRouter(db, config, user).fetch(new Request(url, request));
        }),
      ),
    );
}

export function createApplication(db: Db, config: Config) {
  const main = createMainRouter(config);
  const staticRouter = createStaticRouter();
  const api = createApiRouter(db, config);
  const mcp = createMcpRouter(db, config);
  const webhooks = createWebhookRouter(db);
  const adminAuth = createAdminAuthRouter(db, config);
  const publicRouter = createListsRouter(db, config);
  const identityRouter = config.identity ? createAuthRouter(db, config) : null;
  const legacy = createLegacyApplication(db, config);
  let server: ReturnType<typeof Bun.serve> | undefined;

  async function fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      if (path === "/" || path === "/health") return await main.fetch(request);
      if (path === "/.well-known/oauth-protected-resource" && config.identity)
        return await main.fetch(request);
      if (path.startsWith("/static/")) {
        const url = new URL(request.url);
        url.pathname = url.pathname.slice("/static".length);
        return await staticRouter.fetch(new Request(url, request));
      }
      if (path.startsWith("/api/") || path === "/openapi/json") return await api.fetch(request);
      if (path === "/mcp" || path === "/mcp/") return await mcp.fetch(request);
      if (path.startsWith("/webhooks/")) return await webhooks.fetch(request);
      if (path === "/admin/login" || path === "/admin/logout") return await adminAuth.fetch(request);
      if (path === "/admin/subscribers" || path.startsWith("/admin/subscribers/")) {
        const token = request.headers
          .get("cookie")
          ?.split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith("session="))
          ?.slice(8);
        const user = getSessionUser(db, token);
        if (!user)
          return new Response(null, { status: 302, headers: { Location: "/admin/login" } });
        return await createAdminRouter(db, config, user).fetch(request);
      }
      if (/^\/(?:subscribe|confirm|unsubscribe|preferences)(?:\/|$)/.test(path))
        return await publicRouter.fetch(request);
      if (path === "/auth/login" || path === "/auth/callback")
        return identityRouter
          ? await identityRouter.fetch(request)
          : new Response("Not Found", { status: 404 });
      return await legacy.handle(request);
    } catch (error) {
      console.error(error);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  return {
    fetch,
    request(path: string, init?: RequestInit) {
      return fetch(new Request(new URL(path, "http://localhost"), init));
    },
    listen(port: number) {
      server = Bun.serve({ port, fetch });
      return server;
    },
    stop(closeActiveConnections = false) {
      server?.stop(closeActiveConnections);
    },
  };
}
