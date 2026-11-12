import * as assert from "remix/assert";
import { it } from "remix/test";
import { createRouter } from "remix/router";
import { createCookieSessionStorage } from "remix/session-storage/cookie";

import {
  access,
  radioSession,
  RadioAccess,
  type RadioAccessConfig,
} from "../access.ts";
import { RadioSessionCookie } from "../session-cookie.ts";

it("accepts only an unexpired subject-bound Jack Auth session", async () => {
  const config: RadioAccessConfig = {
    identity: {
      issuer: "https://auth.example.test",
      clientId: "radio-web",
      projectId: "radio-project",
      organizationId: "radio-org",
    },
    publicOrigin: "https://radio.example.test",
    sessionSecret: "test-session-secret-at-least-32-characters",
    secureCookies: true,
  };
  const router = createRouter({
    middleware: [radioSession(config), access(config)],
  });
  router.get("/who", (context) => Response.json(context.get(RadioAccess)));
  const storage = createCookieSessionStorage();
  const cookie = new RadioSessionCookie("radio_session", config.sessionSecret, {
    httpOnly: true,
    sameSite: "Lax",
    secure: true,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  async function who(values: Record<string, unknown>) {
    const session = await storage.read(null);
    for (const [key, value] of Object.entries(values)) session.set(key, value);
    const saved = await storage.save(session);
    assert.ok(saved);
    const header = await cookie.serialize(
      JSON.stringify({
        value: saved,
        expires: Date.now() + 60000,
      }),
    );
    const response = await router.fetch(
      new Request("https://radio.example.test/who", {
        headers: { Cookie: header },
      }),
    );
    return response.json() as Promise<{ subject: string; name: string } | null>;
  }
  const base = {
    authenticated: true,
    name: "Jack",
    authenticatedAt: Date.now(),
  };
  assert.equal(await who(base), null);
  assert.equal(
    await who({ ...base, subject: "radio-subject", expiresAt: Date.now() - 1 }),
    null,
  );
  const current = await who({
    ...base,
    subject: "radio-subject",
    expiresAt: Date.now() + 60000,
  });
  assert.ok(current);
  assert.equal(current.subject, "radio-subject");
  assert.equal(current.name, "Jack");
});
