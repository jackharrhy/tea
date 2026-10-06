import { authenticationError, type IdentityProvider } from "./types.ts";
import {
  verifyIntrospection,
  verifyUserinfo,
  type OwnerPolicy,
} from "./claims.ts";

type JsonObject = Record<string, unknown>;
type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
export type FourormOptions = OwnerPolicy &
  Readonly<{
    introspectionClientId: string;
    introspectionClientSecret: string;
    fetch?: Fetcher;
    now?: () => number;
  }>;

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw authenticationError();
  return value as JsonObject;
}
function https(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error(
      "Expected an exact HTTPS URL without credentials, query, or fragment",
    );
  return url;
}
function endpoint(value: unknown, issuer: URL): string {
  if (typeof value !== "string") throw authenticationError();
  const url = https(value);
  if (url.origin !== issuer.origin) throw authenticationError();
  return url.href;
}
/** Limits apply to bytes streamed, even when Content-Length is absent or false. */
async function boundedJson(response: Response): Promise<JsonObject> {
  if (
    !response.ok ||
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw authenticationError();
  const reader = response.body?.getReader();
  if (!reader) throw authenticationError();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 32_768) throw authenticationError();
      chunks.push(value);
    }
    return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/**
 * 4orm serves opaque tokens. Introspection has no iss/admin/username claims.
 * Bind the issuer through configured HTTPS discovery + same-origin endpoints,
 * then fetch userinfo using that SAME token and compare stable subjects.
 * Never parse a JWT or trust an identity asserted by the tool caller.
 */
export async function createFourormIdentity(
  options: FourormOptions,
): Promise<IdentityProvider> {
  const issuer = https(options.issuer);
  https(options.resource);
  if (
    !options.allowedUsernames.length ||
    options.allowedUsernames.some((name) => !name || name.length > 200) ||
    !options.allowedSubjects.length ||
    options.allowedSubjects.some((s) => !s || s.length > 200)
  )
    throw new Error("At least one verified owner subject is required");
  if (
    !/^[A-Za-z0-9:_-]+$/.test(options.requiredScope) ||
    options.requiredScope === "openid"
  )
    throw new Error("A dedicated shell scope is required");
  if (!options.introspectionClientId || !options.introspectionClientSecret)
    throw new Error("Dedicated introspection credentials are required");
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  async function request(url: string, init: RequestInit): Promise<JsonObject> {
    try {
      // Never follow redirects while transmitting a bearer token or client secret.
      return await boundedJson(
        await fetcher(url, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(5_000),
        }),
      );
    } catch {
      throw authenticationError();
    }
  }
  const metadata = await request(
    new URL("/.well-known/oauth-authorization-server", issuer).href,
    { headers: { accept: "application/json" } },
  );
  if (metadata.issuer !== options.issuer) throw authenticationError();
  const introspection = endpoint(metadata.introspection_endpoint, issuer);
  // Userinfo is in 4orm's OpenID discovery; OAuth metadata may advertise it too.
  const oidc = await request(
    new URL("/.well-known/openid-configuration", issuer).href,
    { headers: { accept: "application/json" } },
  );
  if (oidc.issuer !== options.issuer) throw authenticationError();
  const userinfo = endpoint(oidc.userinfo_endpoint, issuer);
  // Pinned 4orm does not advertise introspection auth methods. Its source contract is Basic.
  // If a future deployment advertises this field, require agreement rather than infer from token-endpoint methods.
  if (
    metadata.introspection_endpoint_auth_methods_supported !== undefined &&
    (!Array.isArray(metadata.introspection_endpoint_auth_methods_supported) ||
      !metadata.introspection_endpoint_auth_methods_supported.includes(
        "client_secret_basic",
      ))
  )
    throw authenticationError();
  const clientBasic = Buffer.from(
    `${encodeURIComponent(options.introspectionClientId)}:${encodeURIComponent(options.introspectionClientSecret)}`,
  ).toString("base64");
  return {
    async verify(token) {
      if (!/^[A-Za-z0-9._~+/-]+={0,2}$/.test(token) || token.length > 4096)
        throw authenticationError();
      const claims = await request(introspection, {
        method: "POST",
        headers: {
          authorization: `Basic ${clientBasic}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({ token, token_type_hint: "access_token" }),
      });
      const verifiedToken = verifyIntrospection(claims, options, now());
      const profile = await request(userinfo, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
        },
      });
      return verifyUserinfo(profile, verifiedToken, options, now());
    },
  };
}
