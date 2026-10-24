import { createHash } from "node:crypto";

export const serviceScopes = {
  assetsRead: "artbin:assets:read",
  assetsContent: "artbin:assets:content",
} as const;

export type ServiceScope = (typeof serviceScopes)[keyof typeof serviceScopes];

export interface ServicePrincipal {
  principalType: "service";
  subject: string;
  clientId: string;
  scopes: ReadonlySet<string>;
  audiences: ReadonlySet<string>;
  expiresAt: number;
}

interface UserTokenPrincipal {
  principalType: "user";
  subject: string;
  clientId: string;
  scopes: ReadonlySet<string>;
  audiences: ReadonlySet<string>;
  expiresAt: number;
}

export type OAuthPrincipal = ServicePrincipal | UserTokenPrincipal;

interface IntrospectionResponse {
  active?: unknown;
  client_id?: unknown;
  sub?: unknown;
  principal_type?: unknown;
  scope?: unknown;
  token_type?: unknown;
  exp?: unknown;
  iat?: unknown;
  aud?: unknown;
}

interface CachedPrincipal {
  principal: OAuthPrincipal;
  cacheUntil: number;
}

const positiveCache = new Map<string, CachedPrincipal>();
const pendingIntrospection = new Map<
  string,
  Promise<OAuthPrincipal | Response>
>();
const INTROSPECTION_TIMEOUT_MS = 3_000;
const MAX_CACHE_SECONDS = 30;

export async function requireServiceScope(
  request: Request,
  requiredScope: ServiceScope,
): Promise<ServicePrincipal | Response> {
  const principal = await introspectBearerToken(request);
  if (principal instanceof Response) return principal;
  if (principal.principalType !== "service")
    return unauthorized("Service token required");
  if (!principal.scopes.has(requiredScope)) {
    return serviceError(
      403,
      "insufficient_scope",
      `Required scope: ${requiredScope}`,
      {
        "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${requiredScope}"`,
      },
    );
  }
  return principal;
}

export async function introspectBearerToken(
  request: Request,
): Promise<OAuthPrincipal | Response> {
  const token = parseBearerToken(request.headers.get("Authorization"));
  if (!token) return unauthorized("Bearer token required");
  return introspect(token);
}

function parseBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  return match?.[1] ?? null;
}

async function introspect(token: string): Promise<OAuthPrincipal | Response> {
  const now = Math.floor(Date.now() / 1_000);
  const cacheKey = createHash("sha256").update(token).digest("hex");
  const cached = positiveCache.get(cacheKey);
  if (cached && cached.cacheUntil > now && cached.principal.expiresAt > now) {
    return cached.principal;
  }
  if (cached) positiveCache.delete(cacheKey);

  const pending = pendingIntrospection.get(cacheKey);
  if (pending) return pending;
  const operation = fetchIntrospection(token, cacheKey, now);
  pendingIntrospection.set(cacheKey, operation);
  try {
    return await operation;
  } finally {
    pendingIntrospection.delete(cacheKey);
  }
}

async function fetchIntrospection(
  token: string,
  cacheKey: string,
  now: number,
): Promise<OAuthPrincipal | Response> {
  const secret = process.env.ARTBIN_4ORM_INTROSPECTION_SECRET;
  if (!secret) return unavailable();
  const clientId =
    process.env.ARTBIN_4ORM_INTROSPECTION_CLIENT_ID ?? "artbin-server";
  const introspectionUrl =
    process.env.ARTBIN_4ORM_INTROSPECTION_URL ??
    `${process.env.FOURM_URL ?? "http://localhost:8000"}/oauth/introspect`;

  let response: Response;
  try {
    response = await fetch(introspectionUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token, token_type_hint: "access_token" }),
      signal: AbortSignal.timeout(INTROSPECTION_TIMEOUT_MS),
    });
  } catch {
    return unavailable();
  }
  if (!response.ok) return unavailable();

  let payload: IntrospectionResponse;
  try {
    payload = (await response.json()) as IntrospectionResponse;
  } catch {
    return unavailable();
  }

  const principal = parseActivePrincipal(payload, now);
  if (!principal) return unauthorized("Bearer token is invalid or expired");

  const cacheUntil = Math.min(principal.expiresAt, now + MAX_CACHE_SECONDS);
  if (cacheUntil > now) positiveCache.set(cacheKey, { principal, cacheUntil });
  return principal;
}

function parseActivePrincipal(
  payload: IntrospectionResponse,
  now: number,
): OAuthPrincipal | null {
  const audiences = parseAudiences(payload.aud);
  if (
    payload.active !== true ||
    (payload.principal_type !== "service" &&
      payload.principal_type !== "user") ||
    payload.token_type?.toString().toLowerCase() !== "bearer" ||
    typeof payload.client_id !== "string" ||
    !payload.client_id ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    typeof payload.scope !== "string" ||
    typeof payload.exp !== "number" ||
    !Number.isSafeInteger(payload.exp) ||
    payload.exp <= now
  ) {
    return null;
  }
  return {
    principalType: payload.principal_type,
    subject: payload.sub,
    clientId: payload.client_id,
    scopes: new Set(payload.scope.split(/\s+/).filter(Boolean)),
    audiences,
    expiresAt: payload.exp,
  };
}

function parseAudiences(value: unknown): ReadonlySet<string> {
  if (typeof value === "string" && value) return new Set([value]);
  if (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item)
  ) {
    return new Set(value);
  }
  return new Set();
}

function unauthorized(message: string): Response {
  return serviceError(401, "invalid_token", message, {
    "WWW-Authenticate": 'Bearer error="invalid_token"',
  });
}

function unavailable(): Response {
  return serviceError(
    503,
    "authentication_unavailable",
    "Token validation is unavailable",
    {
      "Retry-After": "5",
    },
  );
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
        ...Object.fromEntries(new Headers(headers)),
      },
    },
  );
}

export function clearServiceAuthCacheForTesting(): void {
  positiveCache.clear();
  pendingIntrospection.clear();
}
