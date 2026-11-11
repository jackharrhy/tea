import {
  createIdentityClient,
  IdentityError,
  projectAudienceScope,
  PROJECT_ROLES_SCOPE,
  requireTokenRole,
  roleScope,
  type IdentityConfig,
} from "@harrhy/identity";
import type { MapsDatabase, MapsUser } from "./database.js";
import { ServiceHttpError } from "./service-http.js";

export interface MapsMcpAuthConfig extends IdentityConfig {
  readonly publicUrl: string;
  readonly introspectionClientId: string;
  readonly introspectionSecret: string;
}

export function mcpAuthorizationScopes(config: MapsMcpAuthConfig): string[] {
  return [
    "openid",
    "profile",
    projectAudienceScope(config.projectId),
    PROJECT_ROLES_SCOPE,
    roleScope("admin"),
  ];
}

export function mcpResourceUrl(config: MapsMcpAuthConfig): string {
  return `${config.publicUrl.replace(/\/$/, "")}/mcp`;
}

export async function requireMcpAdmin(
  authorization: string | undefined,
  config: MapsMcpAuthConfig | undefined,
  database: MapsDatabase,
  fetcher: typeof fetch = fetch,
): Promise<MapsUser> {
  if (!config)
    throw new ServiceHttpError(503, "Worldview MCP is not configured");
  const token = /^Bearer ([^\s]+)$/i.exec(authorization ?? "")?.[1];
  if (!token) throw new ServiceHttpError(401, "Bearer token required");

  try {
    const principal = await createIdentityClient(config, fetcher).introspect(
      token,
      {
        clientId: config.introspectionClientId,
        clientSecret: config.introspectionSecret,
      },
    );
    requireTokenRole(principal, config.projectId, "admin");
    if (principal.principalType !== "user")
      throw new ServiceHttpError(403, "A human Maps administrator is required");
    const user = database.userByAuthSubject(principal.subject);
    if (!user || !user.isAdmin)
      throw new ServiceHttpError(403, "Maps administrator access is required");
    return user;
  } catch (error) {
    if (error instanceof IdentityError)
      throw new ServiceHttpError(error.status, error.message);
    throw error;
  }
}
