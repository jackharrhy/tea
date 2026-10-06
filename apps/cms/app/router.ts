import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import {
  createController,
  createRouter,
  type MiddlewareContext,
} from "remix/router";
import { render } from "remix/middleware/render";
import { staticFiles } from "remix/middleware/static";
import { cop } from "remix/middleware/cop";
import { assets } from "./assets.ts";
import { routes } from "./routes.ts";
import { ContentStore } from "./data/content.ts";
import { AuthStore } from "./data/auth.ts";
import { services, protectWrites } from "./middleware/context.ts";
import { headRequests } from "./middleware/head.ts";
import type { TeaDatabase } from "./data/database.ts";
import type { SiteRuntime } from "./site.ts";
import type { OperatorAccess } from "./operator-access.ts";
import { createPublicController } from "./actions/controller.tsx";
import { createAuthController } from "./actions/auth/controller.tsx";
import { createAdminController } from "./actions/admin/controller.tsx";
import { createMcpHandler } from "./mcp/handler.ts";

const renderMiddleware = render({ assets });
function validMcpToken(
  provided: string | null,
  configured: string | undefined,
) {
  if (!configured || !provided?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(provided.slice(7));
  const expected = Buffer.from(configured);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export type AppContext = MiddlewareContext<
  [ReturnType<typeof services>, typeof renderMiddleware]
>;
declare module "remix" {
  interface RouterTypes {
    context: AppContext;
  }
}

export function createTeaRouter(
  database: TeaDatabase,
  site: SiteRuntime,
  operator?: OperatorAccess,
  operatorOrigin?: string,
) {
  const content = new ContentStore(database.sqlite, {
    dataDir: site.dataDir,
    canonicalOrigin: site.origin,
  });
  const auth = new AuthStore(database.sqlite);
  const router = createRouter<AppContext>({
    middleware: [
      headRequests,
      protectWrites(site),
      staticFiles(join(site.dataDir, "public"), { index: false }),
      staticFiles(site.definition.publicDir, { index: false }),
      staticFiles(
        fileURLToPath(
          new URL("../../../packages/rich-text/public", import.meta.url),
        ),
        { index: false },
      ),
      staticFiles(fileURLToPath(new URL("../public", import.meta.url)), {
        index: false,
      }),
      cop({ trustedOrigins: [site.origin] }),
      services(content, auth, site, operator),
      renderMiddleware,
    ],
  });
  router.map(routes, createPublicController(site, operator));
  router.map(routes.auth, createAuthController(site, operator));
  router.map(routes.admin, createAdminController(site, operatorOrigin));
  router.map(
    routes.mcp,
    createController(routes.mcp, {
      actions: {
        endpoint(context) {
          const token = process.env.TEA_MCP_TOKEN;
          if (!token) return new Response("Not found", { status: 404 });
          if (
            !validMcpToken(context.request.headers.get("authorization"), token)
          )
            return new Response("Unauthorized", {
              status: 401,
              headers: { "WWW-Authenticate": "Bearer" },
            });
          return createMcpHandler().fetch(context);
        },
      },
    }),
  );
  return router;
}
