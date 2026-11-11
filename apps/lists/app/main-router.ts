import { createRouter } from "remix/router";
import { staticFiles } from "remix/middleware/static";
import {
  PROJECT_ROLES_SCOPE,
  projectAudienceScope,
  roleScope,
} from "@harrhy/identity";

import type { Config } from "../src/config.ts";
import { OPERATION_SCOPES } from "../src/services/central-scopes.ts";

export function createMainRouter(config: Config) {
  const router = createRouter();
  router.get(
    "/",
    () =>
      new Response(null, { status: 302, headers: { Location: "/subscribe" } }),
  );
  router.get("/health", () => Response.json({ ok: true }));
  if (config.identity) {
    const { projectId, issuer } = config.identity;
    router.get("/.well-known/oauth-protected-resource", () =>
      Response.json({
        resource: `${config.baseUrl}/mcp`,
        authorization_servers: [issuer],
        scopes_supported: [
          "openid",
          "profile",
          projectAudienceScope(projectId),
          PROJECT_ROLES_SCOPE,
          roleScope("member"),
          roleScope("admin"),
          ...OPERATION_SCOPES,
        ],
      }),
    );
  }
  return router;
}

export function createStaticRouter() {
  return createRouter({ middleware: [staticFiles("./public")] });
}
