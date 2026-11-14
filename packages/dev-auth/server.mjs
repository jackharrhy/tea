import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const port = Number(process.env.HARRHY_DEV_AUTH_PORT ?? 8786);
const issuer = process.env.HARRHY_DEV_AUTH_ORIGIN ?? `http://127.0.0.1:${port}`;
const configFile =
  process.env.HARRHY_DEV_AUTH_CONFIG ??
  fileURLToPath(new URL("./apps.json", import.meta.url));
const configuration = JSON.parse(readFileSync(configFile, "utf8"));
const applications = new Map(
  configuration.applications.map((app) => [app.clientId, app]),
);
if (
  applications.size !== configuration.applications.length ||
  applications.size === 0
)
  throw new Error("Local auth requires unique application clients");
if (process.env.HARRHY_DEV_AUTH_CALLBACK && applications.size === 1)
  configuration.applications[0].callback = process.env.HARRHY_DEV_AUTH_CALLBACK;
for (const app of applications.values()) {
  if (
    !app.clientId ||
    !app.projectId ||
    !app.organizationId ||
    !app.subject ||
    !app.username ||
    !app.displayName ||
    !app.callback ||
    !app.resourceClientId ||
    !app.resourceSecret ||
    !Array.isArray(app.roles) ||
    (app.native === true
      ? app.callback !== "http://localhost:4444/auth/cli/callback"
      : new URL(app.callback).pathname !== "/auth/callback")
  )
    throw new Error("Invalid local auth application registration");
}
const expectedScopes = (app) => [
  "openid",
  `urn:zitadel:iam:org:project:id:${app.projectId}:aud`,
  "urn:zitadel:iam:org:projects:roles",
];
const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pending = new Map();
const codes = new Map();
const tokens = new Map();
const refreshTokens = new Map();
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const random = () => randomBytes(32).toString("base64url");
const roles = (app) => ({
  [`urn:zitadel:iam:org:project:${app.projectId}:roles`]: Object.fromEntries(
    app.roles.map((role) => [role, { [app.organizationId]: "local" }]),
  ),
});

if (
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535 ||
  !["http:", "https:"].includes(new URL(issuer).protocol) ||
  (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(issuer).hostname) &&
    !new URL(issuer).hostname.endsWith(".localhost") &&
    new URL(issuer).protocol !== "https:")
)
  throw new Error("Invalid local auth configuration");

function json(response, value, status = 200) {
  response
    .writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    })
    .end(JSON.stringify(value));
}

function fail(response, status = 400) {
  response.writeHead(status, { "Cache-Control": "no-store" }).end();
}

async function form(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 8192) throw new Error("Form too large");
  }
  return new URLSearchParams(body);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, issuer);
    if (
      request.method === "GET" &&
      url.pathname === "/.well-known/openid-configuration"
    ) {
      return json(response, {
        issuer,
        authorization_endpoint: `${issuer}/oauth/v2/authorize`,
        token_endpoint: `${issuer}/oauth/v2/token`,
        userinfo_endpoint: `${issuer}/oidc/v1/userinfo`,
        jwks_uri: `${issuer}/oauth/v2/keys`,
        introspection_endpoint: `${issuer}/oauth/v2/introspect`,
        revocation_endpoint: `${issuer}/oauth/v2/revoke`,
      });
    }
    if (request.method === "GET" && url.pathname === "/oauth/v2/keys")
      return json(response, {
        keys: [
          {
            ...key.publicKey.export({ format: "jwk" }),
            kid: "ref-local",
            alg: "RS256",
            use: "sig",
          },
        ],
      });
    if (request.method === "GET" && url.pathname === "/oauth/v2/authorize") {
      const params = url.searchParams;
      const app = applications.get(params.get("client_id"));
      const scopes = new Set((params.get("scope") ?? "").split(" "));
      const allowedScopes =
        app &&
        new Set([
          ...expectedScopes(app),
          "profile",
          ...(app.native === true ? ["offline_access"] : []),
          ...app.roles.map(
            (role) => `urn:zitadel:iam:org:project:role:${role}`,
          ),
        ]);
      if (
        !app ||
        params.get("redirect_uri") !== app.callback ||
        params.get("response_type") !== "code" ||
        params.get("code_challenge_method") !== "S256" ||
        !/^[A-Za-z0-9_-]{43}$/.test(params.get("code_challenge") ?? "") ||
        !/^[A-Za-z0-9_-]{32,128}$/.test(params.get("state") ?? "") ||
        !/^[A-Za-z0-9_-]{32,128}$/.test(params.get("nonce") ?? "") ||
        expectedScopes(app).some((scope) => !scopes.has(scope)) ||
        [...scopes].some((scope) => !allowedScopes.has(scope))
      )
        return fail(response);
      const ticket = random();
      pending.set(ticket, {
        app,
        state: params.get("state"),
        nonce: params.get("nonce"),
        challenge: params.get("code_challenge"),
        scopes: [...scopes],
        expires: Date.now() + 600000,
      });
      response
        .writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        })
        .end(
          `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local sign-in</title><style>body{font:16px system-ui;background:#f6f6f4;color:#222321;min-height:100dvh;display:grid;place-items:center;margin:0}main{max-width:24rem;padding:2rem}h1{font-size:2rem;letter-spacing:-.04em}p{line-height:1.5}button{background:#292d29;color:white;border:0;border-radius:5px;padding:.8rem 1.2rem;font:inherit;cursor:pointer}</style><main><h1>Local sign-in</h1><p>Use a disposable identity in this isolated development store.</p><form method="post" action="/dev/continue"><input type="hidden" name="ticket" value="${ticket}"><button type="submit">Continue as local user</button></form></main></html>`,
        );
      return;
    }
    if (request.method === "POST" && url.pathname === "/dev/continue") {
      if (request.headers.origin && request.headers.origin !== issuer)
        return fail(response, 403);
      const ticket = (await form(request)).get("ticket");
      const transaction = pending.get(ticket);
      if (!transaction || transaction.expires < Date.now())
        return fail(response);
      pending.delete(ticket);
      const code = random();
      codes.set(code, { ...transaction, expires: Date.now() + 60000 });
      const destination = new URL(transaction.app.callback);
      destination.searchParams.set("code", code);
      destination.searchParams.set("state", transaction.state);
      response
        .writeHead(303, {
          Location: destination.href,
          "Cache-Control": "no-store",
        })
        .end();
      return;
    }
    if (request.method === "POST" && url.pathname === "/oauth/v2/token") {
      const params = await form(request);
      if (params.get("grant_type") === "refresh_token") {
        const old = params.get("refresh_token");
        const record = refreshTokens.get(old);
        if (
          !record ||
          record.app.clientId !== params.get("client_id") ||
          record.expires <= Date.now() / 1000
        )
          return json(response, { error: "invalid_grant" }, 400);
        refreshTokens.delete(old);
        const access = random();
        const refresh = random();
        tokens.set(access, {
          ...record,
          expires: Math.floor(Date.now() / 1000) + 3600,
        });
        refreshTokens.set(refresh, record);
        return json(response, {
          access_token: access,
          refresh_token: refresh,
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      const code = params.get("code");
      const transaction = codes.get(code);
      if (
        params.get("grant_type") !== "authorization_code" ||
        params.get("client_id") !== transaction?.app.clientId ||
        params.get("redirect_uri") !== transaction?.app.callback ||
        !transaction ||
        transaction.expires < Date.now() ||
        createHash("sha256")
          .update(params.get("code_verifier") ?? "")
          .digest("base64url") !== transaction.challenge
      )
        return json(response, { error: "invalid_grant" }, 400);
      codes.delete(code);
      const app = transaction.app;
      const now = Math.floor(Date.now() / 1000);
      const unsigned = `${encode({ alg: "RS256", kid: "ref-local", typ: "JWT" })}.${encode(
        {
          iss: issuer,
          sub: app.subject,
          aud: app.clientId,
          azp: app.clientId,
          nonce: transaction.nonce,
          iat: now,
          exp: now + 3600,
        },
      )}`;
      const accessToken = random();
      tokens.set(accessToken, {
        app,
        expires: now + 3600,
        scopes: transaction.scopes,
      });
      let refreshToken;
      if (
        app.native === true &&
        transaction.scopes.includes("offline_access")
      ) {
        refreshToken = random();
        refreshTokens.set(refreshToken, {
          app,
          scopes: transaction.scopes,
          expires: now + 86400,
        });
      }
      return json(response, {
        ...(refreshToken ? { refresh_token: refreshToken } : {}),
        access_token: accessToken,
        id_token: `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), key.privateKey).toString("base64url")}`,
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    if (request.method === "POST" && url.pathname === "/oauth/v2/revoke") {
      const params = await form(request);
      const client = applications.get(params.get("client_id"));
      if (!client) return json(response, { error: "invalid_client" }, 400);
      const token = params.get("token");
      const record = tokens.get(token) ?? refreshTokens.get(token);
      if (record && record.app !== client)
        return json(response, { error: "invalid_client" }, 400);
      tokens.delete(token);
      refreshTokens.delete(token);
      return json(response, {});
    }
    if (request.method === "GET" && url.pathname === "/oidc/v1/userinfo") {
      const token = request.headers.authorization?.replace(/^Bearer /, "");
      if (!tokens.has(token) || tokens.get(token).expires <= Date.now() / 1000)
        return fail(response, 401);
      const app = tokens.get(token).app;
      return json(response, {
        sub: app.subject,
        jack_auth_username: app.username,
        jack_auth_principal_type: "user",
        name: app.displayName,
        ...roles(app),
      });
    }
    if (request.method === "POST" && url.pathname === "/oauth/v2/introspect") {
      const given = Buffer.from(
        request.headers.authorization?.replace(/^Basic /, "") ?? "",
        "base64",
      );
      const resourceApp = [...applications.values()].find((app) => {
        const expected = Buffer.from(
          `${app.resourceClientId}:${app.resourceSecret}`,
        );
        return (
          given.length === expected.length && timingSafeEqual(given, expected)
        );
      });
      if (!resourceApp) return fail(response, 401);
      const token = (await form(request)).get("token");
      const record = tokens.get(token);
      if (
        !record ||
        record.app.resourceClientId !== resourceApp.resourceClientId ||
        record.app.projectId !== resourceApp.projectId ||
        record.app.organizationId !== resourceApp.organizationId ||
        record.expires <= Date.now() / 1000
      )
        return json(response, { active: false });
      const app = record.app;
      return json(response, {
        active: true,
        iss: issuer,
        sub: app.subject,
        client_id: app.clientId,
        exp: record.expires,
        token_type: "Bearer",
        jack_auth_principal_type: "user",
        aud: [app.projectId],
        scope: record.scopes.join(" "),
        ...roles(app),
      });
    }
    fail(response, 404);
  } catch {
    fail(response, 400);
  }
});

server.listen(port, process.env.HARRHY_DEV_AUTH_BIND ?? "127.0.0.1", () => {
  console.log(`Local Jack Auth ready on ${issuer}`);
});
