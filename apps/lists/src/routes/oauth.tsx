/** @jsxRuntime classic */
/** @jsx Html.createElement */
/** @jsxFrag Html.Fragment */
// oxlint-disable-next-line no-unused-vars -- Html is the classic JSX factory.
import { Html } from "@elysia/html";
import { and, eq, isNull } from "drizzle-orm";
import { createHttpApp } from "../http";
import type { Db } from "../db";
import { schema } from "../db";
import type { Config } from "../config";
import { getSessionUser } from "../auth";
import { API_SCOPES, type ApiScope } from "../services/access";
import { hashToken, mintApiToken } from "../services/api-tokens";
import { registerOauthClient } from "../services/oauth-clients";
import { assetUrl } from "../assets";
import {
  oauthAuthorizationDecision,
  oauthAuthorizationQuery,
  oauthRegistrationInput,
  oauthTokenInput,
} from "./oauth-contracts";

function base64Url(bytes: ArrayBuffer) {
  return Buffer.from(bytes).toString("base64url");
}
async function pkceChallenge(verifier: string) {
  return base64Url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
}
function randomSecret(prefix: string) {
  return `${prefix}${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}
function oauthHeaders(c: {
  set: { headers: Record<string, string | number> };
}) {
  c.set.headers["cache-control"] = "no-store";
  c.set.headers.pragma = "no-cache";
}
function validScopes(raw: string): ApiScope[] {
  return [
    ...new Set(
      raw
        .split(/\s+/)
        .filter((scope): scope is ApiScope =>
          API_SCOPES.includes(scope as ApiScope),
        ),
    ),
  ];
}
function requestedScopeNames(raw: string) {
  return [...new Set(raw.split(/\s+/).filter(Boolean))];
}

export function oauthRoutes(db: Db, config: Config) {
  const app = createHttpApp().onError(({ code, status }) => {
    if (code === "VALIDATION") return status(400, { error: "invalid_request" });
  });

  app.get("/.well-known/oauth-protected-resource", () => ({
    resource: `${config.baseUrl}/mcp`,
    authorization_servers: [config.baseUrl],
    scopes_supported: API_SCOPES,
  }));
  app.get("/.well-known/oauth-authorization-server", () => ({
    issuer: config.baseUrl,
    authorization_endpoint: `${config.baseUrl}/oauth/authorize`,
    token_endpoint: `${config.baseUrl}/oauth/token`,
    ...(config.oauthDynamicRegistrationEnabled
      ? { registration_endpoint: `${config.baseUrl}/oauth/register` }
      : {}),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: API_SCOPES,
  }));

  app.post(
    "/oauth/register",
    (c) => {
      oauthHeaders(c);
      if (!config.oauthDynamicRegistrationEnabled)
        return c.json({ error: "registration_not_supported" }, 403);
      const redirectUris = c.body.redirect_uris;
      if (
        c.body.token_endpoint_auth_method &&
        c.body.token_endpoint_auth_method !== "none"
      ) {
        return c.json(
          {
            error: "invalid_client_metadata",
            error_description: "Only public clients are supported",
          },
          400,
        );
      }
      if (
        c.body.grant_types?.some(
          (grant) => !["authorization_code", "refresh_token"].includes(grant),
        ) ||
        c.body.response_types?.some((response) => response !== "code")
      ) {
        return c.json(
          {
            error: "invalid_client_metadata",
            error_description: "Unsupported OAuth flow",
          },
          400,
        );
      }
      const requestedScopes = c.body.scope
        ? requestedScopeNames(c.body.scope)
        : [...API_SCOPES];
      const scopes = validScopes(requestedScopes.join(" "));
      if (scopes.length !== requestedScopes.length) {
        return c.json(
          {
            error: "invalid_client_metadata",
            error_description: "Unsupported scope",
          },
          400,
        );
      }
      try {
        const client = registerOauthClient(
          db,
          c.body.client_name ?? "MCP client",
          redirectUris,
          scopes,
        );
        return c.json(
          {
            client_id: client.clientId,
            client_id_issued_at: Math.floor(Date.now() / 1000),
            client_name: client.clientName,
            redirect_uris: redirectUris,
            token_endpoint_auth_method: "none",
            grant_types: c.body.grant_types ?? [
              "authorization_code",
              "refresh_token",
            ],
            response_types: c.body.response_types ?? ["code"],
            scope: scopes.join(" "),
          },
          201,
        );
      } catch {
        return c.json({ error: "invalid_redirect_uri" }, 400);
      }
    },
    { body: oauthRegistrationInput },
  );

  app.get(
    "/oauth/authorize",
    (c) => {
      const q = c.query;
      const returnTo = `/oauth/authorize?${new URLSearchParams(Object.entries(q).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString()}`;
      const user = getSessionUser(
        db,
        typeof c.cookie.session?.value === "string"
          ? c.cookie.session.value
          : undefined,
      );
      if (!user)
        return c.redirect(
          `/admin/login?returnTo=${encodeURIComponent(returnTo)}`,
          302,
        );
      const client = db
        .select()
        .from(schema.oauthClients)
        .where(eq(schema.oauthClients.clientId, q.client_id ?? ""))
        .get();
      if (
        !client ||
        !(JSON.parse(client.redirectUris) as string[]).includes(
          q.redirect_uri ?? "",
        ) ||
        q.response_type !== "code" ||
        q.code_challenge_method !== "S256" ||
        !q.code_challenge
      ) {
        return c.text("Invalid OAuth authorization request", 400);
      }
      if (q.resource !== `${config.baseUrl}/mcp`)
        return c.text("Invalid OAuth resource", 400);
      const requestedScopes = requestedScopeNames(q.scope ?? "");
      const scopes = validScopes(requestedScopes.join(" "));
      const clientScopes = JSON.parse(client.scopes) as ApiScope[];
      if (
        scopes.length === 0 ||
        scopes.length !== requestedScopes.length ||
        scopes.some((scope) => !clientScopes.includes(scope))
      ) {
        return c.text("Invalid OAuth scope", 400);
      }
      return c.html(
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <meta
              name="viewport"
              content="width=device-width, initial-scale=1"
            />
            <title safe>{`Authorize ${client.clientName}`}</title>
            <link rel="stylesheet" href={assetUrl("/static/styles.css")} />
          </head>
          <body class="m-0 bg-gray-50 font-sans text-gray-900">
            <main class="mx-auto flex min-h-[100dvh] max-w-lg items-center px-4 py-10 sm:px-6">
              <section class="w-full rounded-lg border border-gray-200 bg-white p-6 sm:p-8">
                <h1 class="m-0 text-2xl font-bold">
                  Authorize <span safe>{client.clientName}</span>
                </h1>
                <p class="mb-6 mt-2 text-sm text-gray-500">
                  Signed in as{" "}
                  <span safe class="text-gray-700">
                    {user.email}
                  </span>
                </p>
                <p class="mb-2 text-sm font-medium text-gray-700">
                  Requested access
                </p>
                <ul class="mb-6 mt-0 divide-y divide-gray-100 rounded-md border border-gray-200 px-4">
                  {scopes.map((scope) => (
                    <li class="py-2 text-sm">
                      <code>{scope}</code>
                    </li>
                  ))}
                </ul>
                <form method="post" action="/oauth/authorize">
                  {Object.entries(q).map(([key, value]) =>
                    value ? (
                      <input type="hidden" name={key} value={value} />
                    ) : null,
                  )}
                  <div class="flex flex-wrap gap-3">
                    <button
                      name="decision"
                      value="allow"
                      type="submit"
                      class="rounded-md border-0 bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 active:translate-y-px"
                    >
                      Allow
                    </button>
                    <button
                      name="decision"
                      value="deny"
                      type="submit"
                      class="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 active:translate-y-px"
                    >
                      Deny
                    </button>
                  </div>
                </form>
              </section>
            </main>
          </body>
        </html>,
      );
    },
    { query: oauthAuthorizationQuery },
  );

  app.post(
    "/oauth/authorize",
    (c) => {
      const user = getSessionUser(
        db,
        typeof c.cookie.session?.value === "string"
          ? c.cookie.session.value
          : undefined,
      );
      if (!user) return c.text("Unauthorized", 401);
      const body = c.body;
      const clientId = body.client_id,
        redirectUri = body.redirect_uri,
        state = body.state ?? "";
      const client = db
        .select()
        .from(schema.oauthClients)
        .where(eq(schema.oauthClients.clientId, clientId))
        .get();
      if (
        !client ||
        !(JSON.parse(client.redirectUris) as string[]).includes(redirectUri) ||
        body.response_type !== "code" ||
        body.code_challenge_method !== "S256" ||
        !body.code_challenge
      )
        return c.text("Invalid authorization request", 400);
      if (body.resource !== `${config.baseUrl}/mcp`)
        return c.text("Invalid OAuth resource", 400);
      const redirect = new URL(redirectUri);
      if (body.decision !== "allow") {
        redirect.searchParams.set("error", "access_denied");
        if (state) redirect.searchParams.set("state", state);
        return c.redirect(redirect.toString(), 302);
      }
      const requestedScopes = requestedScopeNames(body.scope ?? "");
      const scopes = validScopes(requestedScopes.join(" "));
      const clientScopes = JSON.parse(client.scopes) as ApiScope[];
      if (
        scopes.length === 0 ||
        scopes.length !== requestedScopes.length ||
        scopes.some((scope) => !clientScopes.includes(scope))
      ) {
        return c.text("Invalid OAuth scope", 400);
      }
      const code = randomSecret("lst_code_");
      db.insert(schema.oauthAuthorizationCodes)
        .values({
          codeHash: hashToken(code),
          clientId,
          userId: user.id,
          redirectUri,
          scopes: JSON.stringify(scopes),
          audience: body.resource,
          codeChallenge: body.code_challenge,
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        })
        .run();
      redirect.searchParams.set("code", code);
      if (state) redirect.searchParams.set("state", state);
      return c.redirect(redirect.toString(), 302);
    },
    { body: oauthAuthorizationDecision },
  );

  app.post(
    "/oauth/token",
    async (c) => {
      oauthHeaders(c);
      const body = c.body;
      if (body.grant_type === "authorization_code") {
        const code = db
          .select()
          .from(schema.oauthAuthorizationCodes)
          .where(
            and(
              eq(schema.oauthAuthorizationCodes.codeHash, hashToken(body.code)),
              isNull(schema.oauthAuthorizationCodes.usedAt),
            ),
          )
          .get();
        if (
          !code ||
          code.expiresAt <= new Date().toISOString() ||
          code.clientId !== body.client_id ||
          code.redirectUri !== body.redirect_uri ||
          (await pkceChallenge(body.code_verifier)) !== code.codeChallenge
        ) {
          return c.json({ error: "invalid_grant" }, 400);
        }
        if (
          !body.resource ||
          body.resource !== code.audience ||
          body.resource !== `${config.baseUrl}/mcp`
        ) {
          return c.json({ error: "invalid_target" }, 400);
        }
        const scopes = JSON.parse(code.scopes) as ApiScope[];
        const refresh = randomSecret("lst_refresh_");
        let access;
        try {
          access = db.transaction((tx) => {
            const claimed = tx
              .update(schema.oauthAuthorizationCodes)
              .set({ usedAt: new Date().toISOString() })
              .where(
                and(
                  eq(schema.oauthAuthorizationCodes.id, code.id),
                  isNull(schema.oauthAuthorizationCodes.usedAt),
                ),
              )
              .returning({ id: schema.oauthAuthorizationCodes.id })
              .get();
            if (!claimed)
              throw Object.assign(
                new Error("Authorization code already used"),
                { code: "invalid_grant" },
              );
            const minted = mintApiToken(
              tx,
              code.userId,
              `OAuth ${code.clientId.slice(0, 16)}`,
              scopes,
              new Date(Date.now() + 60 * 60_000).toISOString(),
              code.audience,
            );
            tx.insert(schema.oauthRefreshTokens)
              .values({
                tokenHash: hashToken(refresh),
                clientId: code.clientId,
                userId: code.userId,
                scopes: code.scopes,
                audience: code.audience,
                expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
              })
              .run();
            return minted;
          });
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "invalid_grant"
          )
            return c.json({ error: "invalid_grant" }, 400);
          throw error;
        }
        return c.json({
          access_token: access.token,
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: refresh,
          scope: scopes.join(" "),
        });
      }
      if (body.grant_type === "refresh_token") {
        const refresh = db
          .select()
          .from(schema.oauthRefreshTokens)
          .where(
            and(
              eq(
                schema.oauthRefreshTokens.tokenHash,
                hashToken(body.refresh_token),
              ),
              isNull(schema.oauthRefreshTokens.revokedAt),
            ),
          )
          .get();
        if (
          !refresh ||
          refresh.expiresAt <= new Date().toISOString() ||
          refresh.clientId !== body.client_id
        )
          return c.json({ error: "invalid_grant" }, 400);
        if (
          !body.resource ||
          body.resource !== refresh.audience ||
          body.resource !== `${config.baseUrl}/mcp`
        ) {
          return c.json({ error: "invalid_target" }, 400);
        }
        const originalScopes = JSON.parse(refresh.scopes) as ApiScope[];
        const requestedScopes = body.scope
          ? validScopes(body.scope)
          : originalScopes;
        if (
          requestedScopes.length === 0 ||
          requestedScopes.some((scope) => !originalScopes.includes(scope))
        ) {
          return c.json({ error: "invalid_scope" }, 400);
        }
        const rotated = randomSecret("lst_refresh_");
        const response = db.transaction((tx) => {
          tx.update(schema.oauthRefreshTokens)
            .set({ revokedAt: new Date().toISOString() })
            .where(eq(schema.oauthRefreshTokens.id, refresh.id))
            .run();
          const access = mintApiToken(
            tx,
            refresh.userId,
            `OAuth ${refresh.clientId.slice(0, 16)}`,
            requestedScopes,
            new Date(Date.now() + 60 * 60_000).toISOString(),
            refresh.audience,
          );
          tx.insert(schema.oauthRefreshTokens)
            .values({
              tokenHash: hashToken(rotated),
              clientId: refresh.clientId,
              userId: refresh.userId,
              scopes: JSON.stringify(requestedScopes),
              audience: refresh.audience,
              expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
            })
            .run();
          return access;
        });
        return c.json({
          access_token: response.token,
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: rotated,
          scope: requestedScopes.join(" "),
        });
      }
    },
    { body: oauthTokenInput },
  );
  return app;
}
