import { generateKeyPairSync, sign } from "node:crypto";
import {
  projectAudienceScope,
  PROJECT_ROLES_SCOPE,
  roleScope,
} from "@tea/identity";

export const identityEnvironment = {
  AUTH_ISSUER: "https://auth.test",
  AUTH_CLIENT_ID: "artbin-browser",
  AUTH_PROJECT_ID: "artbin-project",
  AUTH_ORGANIZATION_ID: "test-org",
  AUTH_INTROSPECTION_CLIENT_ID: "artbin-server",
  AUTH_INTROSPECTION_SECRET: "test-secret",
};
export const identityDiscovery = {
  issuer: "https://auth.test",
  authorization_endpoint: "https://auth.test/oauth/v2/authorize",
  token_endpoint: "https://auth.test/oauth/v2/token",
  userinfo_endpoint: "https://auth.test/oidc/v1/userinfo",
  jwks_uri: "https://auth.test/oauth/v2/keys",
  introspection_endpoint: "https://auth.test/oauth/v2/introspect",
};
export function configureIdentityEnvironment(): () => void {
  const original = Object.fromEntries(
    Object.keys(identityEnvironment).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, identityEnvironment);
  return () => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
export function permissionScopes(...roles: string[]): string {
  return [
    "openid",
    "profile",
    projectAudienceScope("artbin-project"),
    PROJECT_ROLES_SCOPE,
    ...roles.map(roleScope),
  ].join(" ");
}
function roleClaims(...roles: string[]) {
  return {
    "urn:zitadel:iam:org:project:artbin-project:roles": Object.fromEntries(
      roles.map((role) => [role, { "test-org": "auth.test" }]),
    ),
  };
}
export function activeToken(
  options: {
    subject?: string;
    roles?: string[];
    principalType?: "user" | "service";
    scope?: string;
    aud?: string;
    clientId?: string;
  } = {},
) {
  const roles = options.roles ?? ["admin"];
  return {
    active: true,
    iss: "https://auth.test",
    sub: options.subject ?? "central-admin",
    client_id: options.clientId ?? "artbin-mcp",
    jack_auth_principal_type: options.principalType ?? "user",
    token_type: "Bearer",
    exp: Math.floor(Date.now() / 1000) + 600,
    iat: Math.floor(Date.now() / 1000),
    aud: options.aud ?? "artbin-project",
    scope: options.scope ?? permissionScopes(...roles),
    ...roleClaims(...roles),
  };
}
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
export function identityFetch(
  nonce = "",
  onToken?: (body: URLSearchParams) => void,
  person = { subject: "central-member", username: "member" },
): typeof fetch {
  return async (input, options) => {
    const url = String(input);
    if (url.endsWith("openid-configuration"))
      return Response.json(identityDiscovery);
    if (url.endsWith("/keys"))
      return Response.json({
        keys: [
          {
            ...keys.publicKey.export({ format: "jwk" }),
            kid: "test-key",
            alg: "RS256",
          },
        ],
      });
    if (url.endsWith("/token")) {
      onToken?.(new URLSearchParams(String(options?.body)));
      const now = Math.floor(Date.now() / 1000);
      const unsigned =
        encode({ alg: "RS256", kid: "test-key" }) +
        "." +
        encode({
          iss: "https://auth.test",
          sub: person.subject,
          aud: "artbin-browser",
          azp: "artbin-browser",
          iat: now,
          exp: now + 3600,
          nonce,
        });
      const id_token =
        unsigned +
        "." +
        sign("RSA-SHA256", Buffer.from(unsigned), keys.privateKey).toString(
          "base64url",
        );
      return Response.json({
        access_token: "access-token",
        id_token,
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    if (url.endsWith("/userinfo"))
      return Response.json({
        sub: person.subject,
        jack_auth_username: person.username,
        jack_auth_principal_type: "user",
        name: "Member",
        ...roleClaims("member"),
      });
    throw new Error("Unexpected identity endpoint");
  };
}
