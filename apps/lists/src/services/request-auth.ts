import type { Db } from "../db";
import { type Principal } from "./access";
import { authenticateApiToken } from "./api-tokens";
import {
  createIdentityClient,
  IdentityError,
  PROJECT_ROLES_SCOPE,
  projectAudienceScope,
  requireTokenRole,
  roleScope,
  type TokenPrincipal,
} from "@tea/identity";
import { eq } from "drizzle-orm";
import { schema } from "../db";
import { API_SCOPES, principalForUser } from "./access";
import { OPERATION_ROLES } from "./central-scopes";
import type { Config } from "../config";

export function authenticateBearer(
  db: Db,
  request: Request,
  expectedAudience?: string,
): Principal | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  return authenticateApiToken(db, token, expectedAudience);
}

export function createCentralBearerAuth(
  db: Db,
  config: Config,
  fetcher: typeof fetch = fetch,
) {
  if (!config.identity || !config.introspectionCredentials)
    throw new Error("Central bearer auth is not configured");
  const identity = createIdentityClient(config.identity, fetcher);
  const projectId = config.identity.projectId;
  const credentials = config.introspectionCredentials;
  return async (request: Request): Promise<Principal> => {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer "))
      throw new IdentityError("Bearer token required", 401);
    const token: TokenPrincipal = await identity.introspect(
      authorization.slice(7),
      credentials,
    );
    if (
      token.principalType === "service" &&
      !new URL(request.url).pathname.startsWith("/api/")
    )
      throw new IdentityError("Service identity is REST-only", 403);
    const user = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.authSubject, token.subject))
      .get();
    if (!user) throw new IdentityError("Lists account is not assigned", 403);
    if (
      user.authPrincipalType !== token.principalType ||
      (token.principalType === "service" &&
        (!user.authClientId ||
          user.authClientId !== token.clientId ||
          user.role !== "member"))
    )
      throw new IdentityError("Lists identity binding does not match", 403);
    if (token.principalType === "service" && token.roles.has("admin"))
      throw new IdentityError("Service identity cannot be an admin", 403);
    const membershipRole =
      user.role === "owner" || user.role === "admin"
        ? "admin"
        : token.principalType === "service"
          ? "member"
          : token.roles.has("admin")
            ? "admin"
            : "member";
    requireTokenRole(token, projectId, membershipRole);
    if (!token.scopes.has(roleScope(membershipRole)))
      throw new IdentityError("Lists membership scope is required", 403);
    if (
      !token.scopes.has(projectAudienceScope(projectId)) ||
      !token.scopes.has(PROJECT_ROLES_SCOPE)
    ) {
      throw new IdentityError("Lists authorization scopes are required", 403);
    }
    return principalForUser(
      db,
      user,
      API_SCOPES.filter((scope) => {
        if (token.principalType === "service" && !SERVICE_SCOPES.has(scope))
          return false;
        const role = OPERATION_ROLES[scope];
        return token.scopes.has(roleScope(role)) && token.roles.has(role);
      }),
    );
  };
}

const SERVICE_SCOPES = new Set([
  "lists:read",
  "subscribers:read",
  "subscribers:write",
  "campaigns:read",
  "campaigns:write",
  "campaigns:send",
]);
