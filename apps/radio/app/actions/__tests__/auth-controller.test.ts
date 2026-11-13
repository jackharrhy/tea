import * as assert from "remix/assert";
import { it } from "remix/test";

import { createAppRouter } from "../../router.ts";
import { routes } from "../../routes.ts";
import type { RadioRuntimeService } from "../../data/radio-runtime.ts";

it("preserves each pending login when another tab starts and finishes first", async () => {
  const originalFetch = globalThis.fetch;
  let tokenRequests = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration"))
      return Response.json({
        issuer: "https://auth.example.test",
        authorization_endpoint: "https://auth.example.test/authorize",
        token_endpoint: "https://auth.example.test/token",
        userinfo_endpoint: "https://auth.example.test/userinfo",
        jwks_uri: "https://auth.example.test/keys",
        introspection_endpoint: "https://auth.example.test/introspect",
      });
    if (url === "https://auth.example.test/token" && init?.method === "POST") {
      tokenRequests++;
      return new Response(null, { status: 400 });
    }
    throw new Error(`Unexpected identity request: ${url}`);
  };
  try {
    const router = createAppRouter({} as RadioRuntimeService, {
      sessionSecret: "test-secret-012345678901234567890123",
      secureCookies: true,
      publicOrigin: "https://radio.example.test",
      identity: {
        issuer: "https://auth.example.test",
        clientId: "radio-web",
        projectId: "radio-project",
        organizationId: "radio-org",
      },
    });
    const start = async () => {
      const response = await router.fetch(
        new Request("https://radio.example.test" + routes.auth.login.href()),
      );
      assert.equal(response.status, 302);
      const state = new URL(response.headers.get("location")!).searchParams.get(
        "state",
      )!;
      return {
        state,
        cookie: response.headers.get("set-cookie")!.split(";")[0],
      };
    };
    const first = await start();
    const second = await start();
    assert.notEqual(first.state, second.state);
    const cookie = `${first.cookie}; ${second.cookie}`;
    const callback = (state: string) =>
      router.fetch(
        new Request(
          `https://radio.example.test${routes.auth.callback.href()}?state=${state}&code=fixture`,
          {
            headers: { Cookie: cookie },
          },
        ),
      );
    const invalid = await callback("invalid");
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get("set-cookie"), null);
    const firstResult = await callback(first.state);
    assert.equal(firstResult.status, 401);
    assert.match(
      firstResult.headers.get("set-cookie")!,
      new RegExp(`^${first.cookie.split("=")[0]}=`),
    );
    const secondResult = await callback(second.state);
    assert.equal(secondResult.status, 401);
    assert.match(
      secondResult.headers.get("set-cookie")!,
      new RegExp(`^${second.cookie.split("=")[0]}=`),
    );
    assert.equal(tokenRequests, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
