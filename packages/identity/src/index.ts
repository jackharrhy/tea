import { randomBytes, createHash } from "node:crypto";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";

export interface IdentityConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly projectId: string;
  readonly organizationId: string;
}
export interface LoginTransaction {
  readonly state: string;
  readonly verifier: string;
  readonly nonce: string;
  readonly createdAt: number;
}
export interface IdentityProfile {
  readonly subject: string;
  readonly username: string;
  readonly displayName: string;
  readonly roles: ReadonlySet<string>;
  readonly expiresAt: number;
}
export interface TokenPrincipal {
  readonly subject: string;
  readonly clientId: string;
  readonly principalType: "user" | "service";
  readonly scopes: ReadonlySet<string>;
  readonly roles: ReadonlySet<string>;
  readonly audiences: ReadonlySet<string>;
  readonly expiresAt: number;
}
export class IdentityError extends Error {
  public readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
const unavailable = () =>
  new IdentityError("Identity service is unavailable", 503);
const invalid = () => new IdentityError("Invalid or expired identity", 401);
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}
function future(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > Date.now() / 1000
  );
}
export function projectAudienceScope(projectId: string): string {
  return `urn:zitadel:iam:org:project:id:${projectId}:aud`;
}
export function roleScope(role: string): string {
  return `urn:zitadel:iam:org:project:role:${role}`;
}
export const PROJECT_ROLES_SCOPE = "urn:zitadel:iam:org:projects:roles";
export function createLoginTransaction(): LoginTransaction {
  return {
    state: randomBytes(32).toString("base64url"),
    verifier: randomBytes(48).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    createdAt: Math.floor(Date.now() / 1000),
  };
}
export function validLoginTransaction(
  value: unknown,
  state: string | null,
): value is LoginTransaction {
  const data = record(value);
  const now = Math.floor(Date.now() / 1000);
  return (
    text(data.state) &&
    data.state === state &&
    typeof data.verifier === "string" &&
    /^[A-Za-z0-9_-]{43,128}$/.test(data.verifier) &&
    typeof data.nonce === "string" &&
    /^[A-Za-z0-9_-]{32,128}$/.test(data.nonce) &&
    typeof data.createdAt === "number" &&
    Number.isSafeInteger(data.createdAt) &&
    data.createdAt <= now &&
    data.createdAt > now - 600
  );
}
async function json(response: Response): Promise<Record<string, unknown>> {
  const body = await response.text();
  if (body.length > 262144) throw unavailable();
  try {
    return record(JSON.parse(body));
  } catch {
    throw unavailable();
  }
}
export function createIdentityClient(
  config: IdentityConfig,
  fetcher: typeof fetch = fetch,
) {
  const issuer = new URL(config.issuer);
  if (
    issuer.protocol !== "https:" ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    config.issuer.endsWith("/") ||
    !config.clientId ||
    !config.projectId ||
    !config.organizationId
  )
    throw new Error("Invalid identity configuration");
  let discoveryCache:
    | { document: Record<string, unknown>; expires: number }
    | undefined;
  let keys: ReturnType<typeof createRemoteJWKSet> | undefined;
  async function request(url: string | URL, options: RequestInit = {}) {
    try {
      return await fetcher(url, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw unavailable();
    }
  }
  async function discovery() {
    if (discoveryCache && discoveryCache.expires > Date.now())
      return discoveryCache.document;
    const response = await request(
      config.issuer + "/.well-known/openid-configuration",
    );
    if (!response.ok) throw unavailable();
    const document = await json(response);
    if (document.issuer !== config.issuer) throw unavailable();
    for (const name of [
      "authorization_endpoint",
      "token_endpoint",
      "userinfo_endpoint",
      "jwks_uri",
      "introspection_endpoint",
    ]) {
      if (!text(document[name])) throw unavailable();
      const endpoint = new URL(document[name]);
      if (
        endpoint.origin !== issuer.origin ||
        endpoint.username ||
        endpoint.password ||
        endpoint.hash
      )
        throw unavailable();
    }
    discoveryCache = { document, expires: Date.now() + 300000 };
    return document;
  }
  function roles(payload: Record<string, unknown>): ReadonlySet<string> {
    const grants = record(
      payload[`urn:zitadel:iam:org:project:${config.projectId}:roles`],
    );
    return new Set(
      Object.entries(grants)
        .filter(
          ([, organizations]) =>
            typeof record(organizations)[config.organizationId] === "string",
        )
        .map(([role]) => role),
    );
  }
  async function userinfo(accessToken: string) {
    const document = await discovery();
    const response = await request(String(document.userinfo_endpoint), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw invalid();
    return json(response);
  }
  return {
    async authorizationUrl(transaction: LoginTransaction, redirectUri: string) {
      const document = await discovery();
      const url = new URL(String(document.authorization_endpoint));
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope: `openid profile ${projectAudienceScope(config.projectId)} ${PROJECT_ROLES_SCOPE}`,
        state: transaction.state,
        nonce: transaction.nonce,
        code_challenge: createHash("sha256")
          .update(transaction.verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
      }).toString();
      return url.href;
    },
    async exchange(
      code: string,
      transaction: LoginTransaction,
      redirectUri: string,
    ): Promise<IdentityProfile> {
      if (!validLoginTransaction(transaction, transaction.state) || !text(code))
        throw invalid();
      const document = await discovery();
      const response = await request(String(document.token_endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: config.clientId,
          code_verifier: transaction.verifier,
        }),
      });
      if (!response.ok)
        throw response.status >= 500 ? unavailable() : invalid();
      const token = await json(response);
      if (
        typeof token.access_token !== "string" ||
        !token.access_token ||
        token.access_token.length > 32768 ||
        typeof token.id_token !== "string" ||
        token.id_token.length > 32768 ||
        typeof token.token_type !== "string" ||
        token.token_type.toLowerCase() !== "bearer" ||
        typeof token.expires_in !== "number" ||
        !Number.isSafeInteger(token.expires_in) ||
        token.expires_in <= 0
      )
        throw invalid();
      keys ??= createRemoteJWKSet(new URL(String(document.jwks_uri)), {
        [customFetch]: (url, options) => request(url, options),
        timeoutDuration: 5000,
      });
      let claims;
      try {
        claims = (
          await jwtVerify(token.id_token, keys, {
            issuer: config.issuer,
            audience: config.clientId,
            algorithms: ["RS256"],
            requiredClaims: ["sub", "exp", "iat", "nonce"],
            maxTokenAge: "10m",
            clockTolerance: 5,
          })
        ).payload;
      } catch {
        throw invalid();
      }
      if (
        !text(claims.sub) ||
        claims.nonce !== transaction.nonce ||
        (claims.azp !== undefined && claims.azp !== config.clientId) ||
        (Array.isArray(claims.aud) &&
          claims.aud.length > 1 &&
          claims.azp !== config.clientId)
      )
        throw invalid();
      const profile = await userinfo(token.access_token);
      const assigned = roles(profile);
      if (
        profile.sub !== claims.sub ||
        profile.jack_auth_principal_type !== "user" ||
        !text(profile.jack_auth_username) ||
        !text(profile.name)
      )
        throw invalid();
      if (!assigned.has("member") && !assigned.has("admin"))
        throw new IdentityError("Access to this application is required", 403);
      return {
        subject: claims.sub,
        username: profile.jack_auth_username,
        displayName: profile.name,
        roles: assigned,
        expiresAt: Math.min(
          claims.exp!,
          Math.floor(Date.now() / 1000) + token.expires_in,
        ),
      };
    },
    async introspect(
      token: string,
      credentials: { clientId: string; clientSecret: string },
    ): Promise<TokenPrincipal> {
      if (!token || token.length > 32768) throw invalid();
      if (!credentials.clientId || !credentials.clientSecret)
        throw unavailable();
      const document = await discovery();
      const response = await request(String(document.introspection_endpoint), {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${encodeURIComponent(credentials.clientId)}:${encodeURIComponent(credentials.clientSecret)}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token, token_type_hint: "access_token" }),
      });
      if (!response.ok) throw unavailable();
      const payload = await json(response);
      const audiences =
        typeof payload.aud === "string" ? [payload.aud] : payload.aud;
      if (
        payload.active !== true ||
        payload.iss !== config.issuer ||
        !text(payload.sub) ||
        !text(payload.client_id) ||
        !future(payload.exp) ||
        typeof payload.scope !== "string" ||
        typeof payload.token_type !== "string" ||
        payload.token_type.toLowerCase() !== "bearer" ||
        !Array.isArray(audiences) ||
        !audiences.every(text) ||
        !audiences.includes(config.projectId) ||
        (payload.jack_auth_principal_type !== "user" &&
          payload.jack_auth_principal_type !== "service")
      )
        throw invalid();
      return {
        subject: payload.sub,
        clientId: payload.client_id,
        principalType: payload.jack_auth_principal_type,
        scopes: new Set(payload.scope.split(/\s+/).filter(Boolean)),
        roles: roles(payload),
        audiences: new Set(audiences),
        expiresAt: payload.exp,
      };
    },
  };
}

export function requireTokenRole(
  principal: TokenPrincipal,
  projectId: string,
  role: string,
): void {
  if (!principal.audiences.has(projectId))
    throw new IdentityError("Token was issued for another application", 401);
  if (!principal.roles.has(role))
    throw new IdentityError("Required application role is missing", 403);
  for (const scope of [
    projectAudienceScope(projectId),
    PROJECT_ROLES_SCOPE,
    roleScope(role),
  ]) {
    if (!principal.scopes.has(scope))
      throw new IdentityError("Required authorization scope is missing", 403);
  }
}
