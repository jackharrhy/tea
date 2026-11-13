import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import {
  createController,
  createRouter,
  type MiddlewareContext,
} from "remix/router";
import { render } from "remix/middleware/render";
import { asyncContext } from "remix/middleware/async-context";
import { staticFiles } from "remix/middleware/static";
import { cop } from "remix/middleware/cop";
import { assets } from "./assets.ts";
import { routes } from "./routes.ts";
import { createContentStore } from "./data/content.ts";
import { createAuthStore } from "./data/auth.ts";
import { services, protectWrites } from "./middleware/context.ts";
import { headRequests } from "./middleware/head.ts";
import type { TeaDatabase } from "./data/database.ts";
import type { SiteRuntime } from "./site.ts";
import type { OperatorAccess } from "./operator-access.ts";
import {
  createIdentityClient,
  IdentityError,
  PROJECT_ROLES_SCOPE,
  projectAudienceScope,
  requireTokenRole,
  roleScope,
} from "@harrhy/identity";
import { centralAuth } from "./data/central-auth.ts";
import { createPublicController } from "./actions/controller.tsx";
import { createAuthController } from "./actions/auth/controller.tsx";
import { createAdminController } from "./actions/admin/controller.tsx";
import { createMcpHandler } from "./mcp/handler.ts";
import { htmlCsp, htmlNoStore } from "./ui/csp.ts";

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
  const content = createContentStore(database.sqlite, {
    dataDir: site.dataDir,
    canonicalOrigin: site.origin,
  });
  const auth = createAuthStore(
    database.sqlite,
    Boolean(process.env.TEA_AUTH_ISSUER),
  );
  const central = centralAuth(
    site.origin,
    process.env[`TEA_AUTH_${site.id.toUpperCase()}_CLIENT_ID`],
  );
  const router = createRouter<AppContext>({
    middleware: [
      asyncContext(),
      headRequests,
      protectWrites(site),
      staticFiles(join(site.dataDir, "public"), { index: false }),
      staticFiles(site.definition.publicDir, { index: false }),
      staticFiles(
        fileURLToPath(
          new URL("../../../packages/rich-text/public", import.meta.url),
        ),
        {
          index: false,
        },
      ),
      staticFiles(fileURLToPath(new URL("../public", import.meta.url)), {
        index: false,
      }),
      cop({ trustedOrigins: [site.origin] }),
      services(content, auth, site, operator),
      htmlNoStore,
      htmlCsp(),
      renderMiddleware,
    ],
  });
  router.map(routes, createPublicController(site, operator));
  router.map(routes.auth, createAuthController(site, operator));
  router.map(routes.admin, createAdminController(site, operatorOrigin));
  router.map(
    routes.protectedResource,
    createController(routes.protectedResource, {
      actions: {
        mcp() {
          if (!central) return new Response("Not found", { status: 404 });
          return Response.json(
            {
              resource: `${site.origin}/tea/mcp`,
              authorization_servers: [central.config.issuer],
              bearer_methods_supported: ["header"],
              scopes_supported: [
                "openid",
                projectAudienceScope(central.config.projectId),
                PROJECT_ROLES_SCOPE,
                roleScope("admin"),
              ],
            },
            { headers: { "Cache-Control": "public, max-age=300" } },
          );
        },
      },
    }),
  );
  router.map(
    routes.mcp,
    createController(routes.mcp, {
      actions: {
        async endpoint(context) {
          if (central) {
            const authorization = context.request.headers.get("authorization");
            const challenge = `Bearer resource_metadata="${site.origin}/.well-known/oauth-protected-resource/tea/mcp"`;
            if (!authorization?.startsWith("Bearer "))
              return new Response("Unauthorized", {
                status: 401,
                headers: { "WWW-Authenticate": challenge },
              });
            if (
              !process.env.TEA_AUTH_INTROSPECTION_CLIENT_ID ||
              !process.env.TEA_AUTH_INTROSPECTION_SECRET
            )
              return new Response("CMS Central Auth resource is unavailable", {
                status: 503,
              });
            try {
              const principal = await createIdentityClient(
                central.config,
              ).introspect(authorization.slice(7), {
                clientId: process.env.TEA_AUTH_INTROSPECTION_CLIENT_ID,
                clientSecret: process.env.TEA_AUTH_INTROSPECTION_SECRET,
              });
              if (principal.principalType !== "user")
                return new Response("Human authorization required", {
                  status: 403,
                });
              requireTokenRole(principal, central.config.projectId, "admin");
            } catch (error) {
              const status =
                error instanceof IdentityError ? error.status : 503;
              return new Response("MCP authorization failed", {
                status,
                headers:
                  status === 401
                    ? { "WWW-Authenticate": challenge }
                    : undefined,
              });
            }
            return createMcpHandler().fetch(context);
          }
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
