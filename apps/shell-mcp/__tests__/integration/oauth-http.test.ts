import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createTestServer } from "remix/node-fetch-server/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  auth,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { createApp } from "@tea/shell-core/router.ts";
import { createFourormIdentity } from "../../app/auth/fourorm.ts";
import { readConfig } from "../../app/config.ts";
import { JobManager, MockRunner } from "@tea/shell-core/execution/index.ts";

const issuer = "https://4orm.harrhy.xyz";
const resource = "https://jackharrhy.dev/mcp";

// Actual HTTP to isolated applications, not mocked discovery/grants/tokens.
// Only DNS/TLS routing is substituted; unknown destinations fail closed.
for (const selectorless of [false, true])
  test(
    `SDK OAuth → real provider/Remix HTTP → refresh/revoke (selectorless DCR fixture: ${selectorless})`,
    { timeout: 30_000 },
    async (t) => {
      const cwd = process.env.FOURORM_TEST_REPO;
      if (!cwd)
        throw new Error(
          "Set FOURORM_TEST_REPO to a 4orm checkout with the shell HTTP fixture",
        );
      const child = spawn(
        "uv",
        ["run", "python", "-m", "tests.shell_http_fixture"],
        { cwd, stdio: ["ignore", "pipe", "pipe"] },
      );
      t.after(async () => {
        if (child.exitCode === null) {
          child.kill("SIGTERM");
          await once(child, "exit");
        }
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const [port, subject] = await new Promise<string[]>((resolve, reject) => {
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += chunk;
          const match = /FIXTURE_READY (\d+) (\d+)/.exec(output);
          if (match) resolve(match.slice(1));
        });
        child.once("exit", () =>
          reject(new Error(`Provider fixture exited: ${stderr}`)),
        );
        child.once("error", reject);
      });
      let shellOrigin = "";
      const registrations: Record<string, unknown>[] = [];
      const visited: string[] = [];
      const wireFetch = async (
        input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = new URL(input instanceof Request ? input.url : input);
        visited.push(url.pathname);
        const origin =
          url.origin === issuer
            ? `http://127.0.0.1:${port}`
            : url.origin === "https://jackharrhy.dev"
              ? shellOrigin
              : "";
        assert.ok(origin, "test must never reach an external origin");
        if (url.pathname.startsWith("/oauth/register") && init?.body) {
          const metadata = JSON.parse(String(init.body));
          // Optional DCR selectors are omitted by some clients. This is an explicit
          // compatibility fixture, NOT a captured ChatGPT registration body.
          if (selectorless) {
            delete metadata.scope;
            delete metadata.resource;
          }
          registrations.push(metadata);
          init = { ...init, body: JSON.stringify(metadata) };
        }
        const headers = new Headers(init?.headers);
        headers.set("host", url.host);
        return fetch(`${origin}${url.pathname}${url.search}`, {
          ...init,
          headers,
          redirect: "manual",
        });
      };
      const identity = await createFourormIdentity({
        issuer,
        resource,
        requiredScope: "newport-shell:execute",
        allowedSubjects: [subject],
        allowedUsernames: ["harrhy"],
        introspectionClientId: "artbin-server",
        introspectionClientSecret: "introspection-secret",
        fetch: wireFetch,
      });
      const jobs = new JobManager({ runner: new MockRunner() });
      t.after(() => jobs.close());
      const config = readConfig({
        SHELL_MODE: "fourorm",
        PUBLIC_ORIGIN: "https://jackharrhy.dev",
        FOURORM_ISSUER: "https://4orm.harrhy.xyz",
        SHELL_AUTHORIZATION_SERVER: "https://4orm.harrhy.xyz/newport-shell",
        SHELL_REQUIRED_SCOPE: "newport-shell:execute",
        SHELL_ALLOWED_USERNAMES: "harrhy",
        SHELL_ALLOWED_SUBJECTS: subject,
        FOURORM_INTROSPECTION_CLIENT_ID: "artbin-server",
        FOURORM_INTROSPECTION_SECRET_FILE: "/fixture",
      });
      const app = createApp(config, identity, jobs);
      const server = await createTestServer((request) => {
        // Match production's TLS-terminating adapter while keeping fixture sockets local.
        const url = new URL(request.url);
        url.protocol = "https:";
        url.host = "jackharrhy.dev";
        url.port = "";
        return app.fetch(new Request(url, request));
      });
      shellOrigin = server.baseUrl;
      t.after(() => server.close());
      const challenge = await wireFetch(resource);
      assert.equal(challenge.status, 401);
      assert.match(
        challenge.headers.get("www-authenticate")!,
        /oauth-protected-resource\/mcp/,
      );

      let clientInfo: any,
        tokens: any,
        verifier = "",
        authorizationUrl: URL | undefined;
      const provider: OAuthClientProvider = {
        redirectUrl: "https://client.example/callback",
        clientMetadata: {
          redirect_uris: ["https://client.example/callback"],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        },
        clientInformation: () => clientInfo,
        saveClientInformation: (value) => {
          clientInfo = value;
        },
        tokens: () => tokens,
        saveTokens: (value) => {
          tokens = value;
        },
        codeVerifier: () => verifier,
        saveCodeVerifier: (value) => {
          verifier = value;
        },
        redirectToAuthorization: (value) => {
          authorizationUrl = value;
        },
        state: () => "fixture-state",
      };
      const options = {
        serverUrl: resource,
        resourceMetadataUrl: new URL(
          "https://jackharrhy.dev/.well-known/oauth-protected-resource/mcp",
        ),
        fetchFn: wireFetch,
      };
      assert.equal(await auth(provider, options), "REDIRECT");
      assert.ok(authorizationUrl);
      assert.equal(clientInfo.scope, "openid newport-shell:execute");
      assert.equal(authorizationUrl.searchParams.get("resource"), resource);
      assert.equal(
        authorizationUrl.searchParams.get("scope"),
        "openid newport-shell:execute",
      );
      assert.equal(
        authorizationUrl.searchParams.get("code_challenge_method"),
        "S256",
      );
      assert.ok(
        visited.includes(
          "/.well-known/oauth-authorization-server/newport-shell",
        ),
      );
      assert.ok(visited.includes("/oauth/register/newport-shell"));
      assert.equal(registrations[0].resource, undefined);

      // Browser-side HTTP cookie jar. Real login, not a fabricated session cookie.
      let cookie = "";
      async function browser(url: string | URL, init: RequestInit = {}) {
        const headers = new Headers(init.headers);
        if (cookie) headers.set("cookie", cookie);
        const response = await wireFetch(url, { ...init, headers });
        const session = response.headers
          .getSetCookie()
          .find((value) => value.startsWith("session="));
        if (session) cookie = session.split(";")[0];
        return response;
      }
      const beforeLogin = await browser(authorizationUrl);
      assert.equal(beforeLogin.status, 303);
      const loggedIn = await browser(`${issuer}/login`, {
        method: "POST",
        body: new URLSearchParams({ username: "harrhy", password: "pass" }),
      });
      assert.ok([302, 303].includes(loggedIn.status));
      const consent = await browser(authorizationUrl);
      assert.equal(consent.status, 200);
      assert.match(await consent.text(), /newport-shell:execute/);
      const form = new URLSearchParams(authorizationUrl.searchParams);
      form.set("confirm", "yes");
      const approved = await browser(`${issuer}/oauth/authorize`, {
        method: "POST",
        body: form,
      });
      assert.equal(approved.status, 302);
      const callback = new URL(approved.headers.get("location")!);
      assert.equal(callback.searchParams.get("state"), "fixture-state");
      assert.equal(callback.searchParams.has("error"), false);
      const code = callback.searchParams.get("code")!;
      assert.ok(code);
      const wrongPkce = await wireFetch(`${issuer}/oauth/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientInfo.client_id,
          code,
          redirect_uri: String(provider.redirectUrl),
          resource,
          code_verifier: "wrong-verifier",
        }),
      });
      assert.equal(wrongPkce.status, 400);
      const freshApproval = await browser(`${issuer}/oauth/authorize`, {
        method: "POST",
        body: form,
      });
      const freshCode = new URL(
        freshApproval.headers.get("location")!,
      ).searchParams.get("code")!;
      assert.equal(
        await auth(provider, { ...options, authorizationCode: freshCode }),
        "AUTHORIZED",
      );
      assert.ok(tokens.access_token);
      const inspection = await wireFetch(`${issuer}/oauth/introspect`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from("artbin-server:introspection-secret").toString("base64")}`,
        },
        body: new URLSearchParams({ token: tokens.access_token }),
      });
      const claims = (await inspection.json()) as any;
      assert.equal(claims.aud, resource);
      assert.equal(claims.sub, subject);
      assert.equal(claims.scope, "openid newport-shell:execute");
      assert.equal(claims.active, true);

      const transport = new StreamableHTTPClientTransport(new URL(resource), {
        authProvider: provider,
        fetch: wireFetch,
      });
      const sdk = new Client({ name: "oauth-http-fixture", version: "1" });
      t.after(() => sdk.close());
      await sdk.connect(transport);
      assert.deepEqual(
        (await sdk.listTools()).tools.map((tool) => tool.name),
        ["execute", "read_job", "cancel"],
      );
      const result = await sdk.callTool({
        name: "execute",
        arguments: {
          command: "fixture-not-real-execution",
          idempotencyKey: "oauth-http-fixture",
        },
      });
      assert.notEqual(result.isError, true);

      const oldRefresh = tokens.refresh_token;
      assert.equal(await auth(provider, options), "AUTHORIZED");
      assert.notEqual(tokens.refresh_token, oldRefresh);
      assert.equal(
        (
          await wireFetch(resource, {
            headers: { authorization: `Bearer ${tokens.access_token}` },
          })
        ).status,
        405,
      );
      const revoked = await browser(
        `${issuer}/admin/oauth/clients/${clientInfo.client_id}/revoke-tokens`,
        { method: "POST" },
      );
      assert.equal(revoked.status, 303);
      assert.equal(
        (
          await wireFetch(resource, {
            headers: { authorization: `Bearer ${tokens.access_token}` },
          })
        ).status,
        401,
      );
      const reused = await wireFetch(`${issuer}/oauth/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientInfo.client_id,
          refresh_token: oldRefresh,
          resource,
        }),
      });
      assert.equal(reused.status, 400);

      // A genuinely issued token for another fixture user must not become shell authority.
      cookie = "";
      tokens = undefined;
      assert.equal(await auth(provider, options), "REDIRECT");
      await browser(`${issuer}/login`, {
        method: "POST",
        body: new URLSearchParams({ username: "nonowner", password: "pass" }),
      });
      const otherConsent = await browser(authorizationUrl!);
      assert.equal(otherConsent.status, 200);
      const otherForm = new URLSearchParams(authorizationUrl!.searchParams);
      otherForm.set("confirm", "yes");
      const otherApproval = await browser(`${issuer}/oauth/authorize`, {
        method: "POST",
        body: otherForm,
      });
      const otherCode = new URL(
        otherApproval.headers.get("location")!,
      ).searchParams.get("code")!;
      assert.equal(
        await auth(provider, { ...options, authorizationCode: otherCode }),
        "AUTHORIZED",
      );
      assert.equal(
        (
          await wireFetch(resource, {
            headers: { authorization: `Bearer ${tokens.access_token}` },
          })
        ).status,
        401,
      );
    },
  );
