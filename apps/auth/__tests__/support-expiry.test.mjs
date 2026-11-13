import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { createSupportStore, supportRandom } from "../src/support-store.mjs";
import { createSupportLogin } from "../src/support-login.mjs";

for (const tokenLifetime of [900000, 300000]) {
  test(`redeem and fresh status share a bounded persisted expiry with an advancing clock (${tokenLifetime}ms token)`, async () => {
    let clock = 1_800_000_000_000;
    const now = () => clock++;
    const tokenExpiry = clock + tokenLifetime;
    const store = createSupportStore({
      filename: ":memory:",
      key: randomBytes(32),
      now,
    });
    const verifier = supportRandom();
    const callback = "https://artbin.test/auth/support/callback";
    const authorization =
      "Basic " + Buffer.from("artbin:secret").toString("base64");
    const login = createSupportLogin({
      store,
      actorSubject: "actor",
      now,
      consumers: { artbin: { callback, transportSecret: "secret" } },
      eligible: async () => true,
      provider: {
        exchange: async () => ({ targetToken: "synthetic-token" }),
        verify: async () => ({ expires: tokenExpiry, role: "member" }),
      },
    });
    try {
      const { ref } = store.create(
        "code",
        {
          actor: "actor",
          target: "target",
          consumer: "artbin",
          challenge: createHash("sha256").update(verifier).digest("base64url"),
        },
        60000,
      );
      const started = clock;
      const result = await login.server(
        "/support/redeem",
        {
          code: ref,
          code_verifier: verifier,
          redirect_uri: callback,
        },
        authorization,
      );
      const input = {
        supportId: result.support.id,
        endSecret: result.support.endSecret,
      };
      const persistedExpiry = store.get(input.supportId).expires;
      assert.equal(Date.parse(result.support.expiresAt), persistedExpiry);
      assert(persistedExpiry <= tokenExpiry);
      assert(persistedExpiry <= started + 600010);
      for (let navigation = 0; navigation < 3; navigation++) {
        const status = await login.server(
          "/support/session",
          input,
          authorization,
        );
        assert.equal(status.active, true);
        assert.equal(status.expiresAt, result.support.expiresAt);
        assert.equal(store.get(input.supportId).expires, persistedExpiry);
      }
    } finally {
      store.close();
    }
  });
}
