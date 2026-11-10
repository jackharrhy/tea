import {
  PROJECT_ROLES_SCOPE,
  projectAudienceScope,
  roleScope,
} from "@tea/identity";
import { Elysia } from "elysia";

import type { Config } from "../config";
import { OPERATION_SCOPES } from "../services/central-scopes";

export function resourceMetadataRoutes(config: Config) {
  if (!config.identity) throw new Error("Central identity is not configured");
  const projectId = config.identity.projectId;
  return new Elysia().get("/.well-known/oauth-protected-resource", () => ({
    resource: `${config.baseUrl}/mcp`,
    authorization_servers: [config.identity!.issuer],
    scopes_supported: [
      "openid",
      "profile",
      projectAudienceScope(projectId),
      PROJECT_ROLES_SCOPE,
      roleScope("member"),
      roleScope("admin"),
      ...OPERATION_SCOPES,
    ],
  }));
}
