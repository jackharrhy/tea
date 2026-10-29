import { createHash } from "node:crypto";
import {
  IdentityError,
  requireTokenRole,
  roleScope,
  type TokenPrincipal,
} from "@tea/identity";
import { identityClient, identityConfig } from "./oauth.server.ts";

export const serviceScopes = {
  assetsRead: "assets-read",
  assetsContent: "assets-content",
} as const;
export type ServiceScope = (typeof serviceScopes)[keyof typeof serviceScopes];
export type OAuthPrincipal = TokenPrincipal;
export interface ServicePrincipal extends TokenPrincipal {
  readonly principalType: "service";
}

const positiveCache = new Map<
  string,
  { principal: OAuthPrincipal; cacheUntil: number }
>();
const pendingIntrospection = new Map<
  string,
  Promise<OAuthPrincipal | Response>
>();
export async function requireServiceScope(
  request: Request,
  requiredScope: ServiceScope,
): Promise<ServicePrincipal | Response> {
  const principal = await introspectBearerToken(request);
  if (principal instanceof Response) return principal;
  if (principal.principalType !== "service")
    return serviceError(401, "invalid_token", "Service token required");
  try {
    requireTokenRole(principal, identityConfig().projectId, requiredScope);
  } catch (error) {
    return serviceError(
      error instanceof IdentityError ? error.status : 503,
      "insufficient_scope",
      "Required Artbin asset permission is missing",
      {
        "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${roleScope(requiredScope)}"`,
      },
    );
  }
  return principal as ServicePrincipal;
}
export async function introspectBearerToken(
  request: Request,
): Promise<OAuthPrincipal | Response> {
  const token = /^Bearer ([^\s]+)$/i.exec(
    request.headers.get("Authorization") ?? "",
  )?.[1];
  if (!token || token.length > 32768)
    return serviceError(401, "invalid_token", "Bearer token required");
  const now = Math.floor(Date.now() / 1000);
  const key = createHash("sha256").update(token).digest("hex");
  const cached = positiveCache.get(key);
  if (cached && cached.cacheUntil > now && cached.principal.expiresAt > now)
    return cached.principal;
  positiveCache.delete(key);
  const pending = pendingIntrospection.get(key);
  if (pending) return pending;
  const operation = fetchPrincipal(token, key, now);
  pendingIntrospection.set(key, operation);
  try {
    return await operation;
  } finally {
    pendingIntrospection.delete(key);
  }
}
async function fetchPrincipal(
  token: string,
  key: string,
  now: number,
): Promise<OAuthPrincipal | Response> {
  try {
    const principal = await identityClient().introspect(token, {
      clientId: process.env.AUTH_INTROSPECTION_CLIENT_ID ?? "",
      clientSecret: process.env.AUTH_INTROSPECTION_SECRET ?? "",
    });
    if (positiveCache.size >= 5000)
      positiveCache.delete(positiveCache.keys().next().value!);
    positiveCache.set(key, {
      principal,
      cacheUntil: Math.min(principal.expiresAt, now + 30),
    });
    return principal;
  } catch (error) {
    const status = error instanceof IdentityError ? error.status : 503;
    return serviceError(
      status,
      status === 401 ? "invalid_token" : "authentication_unavailable",
      status === 401
        ? "Bearer token is invalid or expired"
        : "Token validation is unavailable",
    );
  }
}
function serviceError(
  status: number,
  code: string,
  message: string,
  headers?: HeadersInit,
): Response {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(status === 401
          ? { "WWW-Authenticate": 'Bearer error="invalid_token"' }
          : {}),
        ...(status === 503 ? { "Retry-After": "5" } : {}),
        ...Object.fromEntries(new Headers(headers)),
      },
    },
  );
}
export function clearServiceAuthCacheForTesting(): void {
  positiveCache.clear();
  pendingIntrospection.clear();
}
