import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:https";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const projectId = "maps-smoke-project";
const organizationId = "maps-smoke-org";
const clientId = "maps-smoke-browser";
const audienceScope = `urn:zitadel:iam:org:project:id:${projectId}:aud`;
const rolesScope = "urn:zitadel:iam:org:projects:roles";
const roles = {
  [`urn:zitadel:iam:org:project:${projectId}:roles`]: {
    member: { [organizationId]: "maps-smoke" },
  },
};

export function createIdentityServer({ origin, mapsOrigin, key, cert }) {
  const transactions = new Map();
  const issued = new Map();
  let authorizationCount = 0;
  const server = createServer({ key, cert }, async (request, response) => {
    try {
      const url = new URL(request.url, origin);
      const json = (body) => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (url.pathname === "/.well-known/openid-configuration") {
        json({
          issuer: origin,
          authorization_endpoint: `${origin}/oauth/v2/authorize`,
          token_endpoint: `${origin}/oauth/v2/token`,
          userinfo_endpoint: `${origin}/oidc/v1/userinfo`,
          jwks_uri: `${origin}/oauth/v2/keys`,
          introspection_endpoint: `${origin}/oauth/v2/introspect`,
        });
      } else if (url.pathname === "/oauth/v2/keys") {
        json({
          keys: [
            {
              ...keys.publicKey.export({ format: "jwk" }),
              kid: "maps-smoke",
              alg: "RS256",
            },
          ],
        });
      } else if (url.pathname === "/oauth/v2/authorize") {
        const callback = new URL(url.searchParams.get("redirect_uri"));
        assert.equal(callback.origin, mapsOrigin);
        assert.equal(url.searchParams.get("client_id"), clientId);
        assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        assert.ok(url.searchParams.get("scope")?.includes(audienceScope));
        assert.ok(url.searchParams.get("scope")?.includes(rolesScope));
        const number = ++authorizationCount;
        const code = `disposable-code-${number}`;
        transactions.set(code, {
          nonce: url.searchParams.get("nonce"),
          challenge: url.searchParams.get("code_challenge"),
          redirectUri: callback.toString(),
          subject: number === 2 ? "tea-smoke-viewer" : "tea-smoke",
        });
        callback.searchParams.set("state", url.searchParams.get("state"));
        callback.searchParams.set("code", code);
        response.writeHead(302, { Location: callback.toString() }).end();
      } else if (url.pathname === "/oauth/v2/token") {
        let body = "";
        for await (const chunk of request) body += chunk;
        const parameters = new URLSearchParams(body);
        const code = parameters.get("code");
        const transaction = transactions.get(code);
        if (
          !transaction ||
          parameters.get("redirect_uri") !==
            new URL(transaction.redirectUri).origin + "/auth/callback" ||
          createHash("sha256")
            .update(parameters.get("code_verifier") ?? "")
            .digest("base64url") !== transaction.challenge
        ) {
          response.writeHead(400).end();
          return;
        }
        transactions.delete(code);
        const now = Math.floor(Date.now() / 1000);
        const unsigned = `${encode({ alg: "RS256", kid: "maps-smoke" })}.${encode(
          {
            iss: origin,
            sub: transaction.subject,
            aud: clientId,
            azp: clientId,
            nonce: transaction.nonce,
            iat: now,
            exp: now + 3600,
          },
        )}`;
        const accessToken = `disposable-token-${authorizationCount}`;
        issued.set(accessToken, transaction.subject);
        json({
          access_token: accessToken,
          id_token: `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), keys.privateKey).toString("base64url")}`,
          token_type: "Bearer",
          expires_in: 3600,
        });
      } else if (url.pathname === "/oidc/v1/userinfo") {
        const subject = issued.get(
          request.headers.authorization?.replace(/^Bearer /, ""),
        );
        if (!subject) {
          response.writeHead(401).end();
          return;
        }
        json({
          sub: subject,
          jack_auth_username: subject === "tea-smoke" ? "mapper" : "observer",
          jack_auth_principal_type: "user",
          name: subject === "tea-smoke" ? "Test Mapper" : "Test Observer",
          ...roles,
        });
      } else response.writeHead(404).end();
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });
  return server;
}

export const identitySettings = { projectId, organizationId, clientId };
