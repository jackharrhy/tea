import { generateKeyPairSync, sign } from "node:crypto";
import {
  projectAudienceScope,
  PROJECT_ROLES_SCOPE,
  roleScope,
} from "@harrhy/identity";

export const identityConfig = {
  issuer: "https://auth.test",
  clientId: "maps-browser",
  projectId: "maps-project",
  organizationId: "test-org",
};
export const mcpIdentityConfig = {
  ...identityConfig,
  publicUrl: "http://127.0.0.1",
  introspectionClientId: "maps-server",
  introspectionSecret: "test-secret",
};
const discovery = {
  issuer: identityConfig.issuer,
  authorization_endpoint: `${identityConfig.issuer}/oauth/v2/authorize`,
  token_endpoint: `${identityConfig.issuer}/oauth/v2/token`,
  userinfo_endpoint: `${identityConfig.issuer}/oidc/v1/userinfo`,
  jwks_uri: `${identityConfig.issuer}/oauth/v2/keys`,
  introspection_endpoint: `${identityConfig.issuer}/oauth/v2/introspect`,
};
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const roleClaims = (...roles: string[]) => ({
  [`urn:zitadel:iam:org:project:${identityConfig.projectId}:roles`]:
    Object.fromEntries(
      roles.map((role) => [
        role,
        { [identityConfig.organizationId]: "auth.test" },
      ]),
    ),
});
export const permissionScopes = (...roles: string[]) =>
  [
    "openid",
    "profile",
    projectAudienceScope(identityConfig.projectId),
    PROJECT_ROLES_SCOPE,
    ...roles.map(roleScope),
  ].join(" ");

export function identityFixture(
  options: {
    roles?: string[];
    subject?: string;
    principalType?: "user" | "service";
    scopes?: string;
    audience?: string;
  } = {},
) {
  const roles = options.roles ?? ["admin"];
  const subject = options.subject ?? "central-admin";
  let nonce = "";
  let tokenBody: URLSearchParams | undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === `${identityConfig.issuer}/.well-known/openid-configuration`)
      return Response.json(discovery);
    if (url === discovery.jwks_uri)
      return Response.json({
        keys: [
          {
            ...keys.publicKey.export({ format: "jwk" }),
            kid: "maps-key",
            alg: "RS256",
          },
        ],
      });
    if (url === discovery.token_endpoint) {
      tokenBody = new URLSearchParams(String(init?.body));
      const now = Math.floor(Date.now() / 1000);
      const unsigned = `${encode({ alg: "RS256", kid: "maps-key" })}.${encode({
        iss: identityConfig.issuer,
        sub: subject,
        aud: identityConfig.clientId,
        azp: identityConfig.clientId,
        iat: now,
        exp: now + 3600,
        nonce,
      })}`;
      return Response.json({
        access_token: "access-token",
        id_token: `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), keys.privateKey).toString("base64url")}`,
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    if (url === discovery.userinfo_endpoint)
      return Response.json({
        sub: subject,
        jack_auth_username: "mapper",
        jack_auth_principal_type: "user",
        name: "Mapper",
        ...roleClaims(...roles),
      });
    if (url === discovery.introspection_endpoint)
      return Response.json({
        active: true,
        iss: identityConfig.issuer,
        sub: subject,
        client_id: "maps-mcp-client",
        jack_auth_principal_type: options.principalType ?? "user",
        token_type: "Bearer",
        exp: Math.floor(Date.now() / 1000) + 600,
        aud: options.audience ?? identityConfig.projectId,
        scope: options.scopes ?? permissionScopes(...roles),
        ...roleClaims(...roles),
      });
    throw new Error(`Unexpected identity URL ${url}`);
  };
  return {
    fetch,
    setNonce(value: string) {
      nonce = value;
    },
    tokenBody() {
      return tokenBody;
    },
  };
}
