import { it } from "remix/test";
import * as assert from "remix/assert";
import { isEditor, sameOrigin, sessionCookie } from "../auth.ts";
import type { Bindings } from "../types.ts";

it("accepts editor writes through a configured TLS proxy and secures the session cookie", async () => {
  const env = {
    TEA_ADMIN_PASSWORD: "test",
    TEA_SESSION_SECRET: "test-session-secret",
    TEA_PREVIEW_SECRET: "test-preview-secret",
    TEA_EDITOR_ORIGIN: "https://cms.example.test",
  } as Bindings;
  const request = new Request("http://localhost:8788/tea/login", {
    headers: { Origin: "https://cms.example.test" },
  });
  assert.equal(sameOrigin(request, env), true);
  assert.equal(
    sameOrigin(
      new Request(request.url, {
        headers: { Origin: "https://evil.example.test" },
      }),
      env,
    ),
    false,
  );
  const cookie = await sessionCookie(request, env);
  assert.equal(cookie.includes("; Secure"), true);
  assert.equal(
    await isEditor(
      new Request(request.url, { headers: { Cookie: cookie } }),
      env,
    ),
    true,
  );
});
