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
    if (token.principalType !== "user")
      throw new IdentityError("Human Lists identity required", 403);
    const user = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.authSubject, token.subject))
      .get();
    if (!user) throw new IdentityError("Lists account is not assigned", 403);
    if (user.role === "owner" || user.role === "admin") {
      requireTokenRole(token, projectId, "admin");
    } else {
      requireTokenRole(
        token,
        projectId,
        token.roles.has("admin") ? "admin" : "member",
      );
    }
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
        const role = OPERATION_ROLES[scope];
        return token.scopes.has(roleScope(role)) && token.roles.has(role);
      }),
    );
  };
}
