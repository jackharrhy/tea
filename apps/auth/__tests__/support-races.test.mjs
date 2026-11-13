import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  createSupportStore,
  supportHash,
  supportRandom,
} from "../src/support-store.mjs";
import { createSupportLogin } from "../src/support-login.mjs";
import { createSupportProvider } from "../src/support-provider.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const open = () =>
  createSupportStore({ filename: ":memory:", key: randomBytes(32) });

test("cleanup re-reads tokens retained while eligibility and revocation are pending", async () => {
  const store = open(),
    validation = deferred(),
    entered = deferred(),
    revocation = deferred(),
    revoking = deferred();
  const { ref } = store.create(
    "code",
    { actorToken: "actor" },
    60000,
    "exchanging",
  );
  const revoked = [];
  try {
    const sweep = store.sweep(
      async (token) => {
        revoked.push(token);
        if (token === "target") {
          revoking.resolve();
          await revocation.promise;
        }
      },
      async () => {
        entered.resolve();
        return validation.promise;
      },
    );
    await entered.promise;
    store.retain(ref, { targetToken: "target" });
    store.update(ref, (row) => {
      row.state = "ended";
    });
    validation.resolve(false);
    await revoking.promise;
    store.retain(ref, { targetToken: "replacement" });
    revocation.resolve();
    await sweep;
    assert.equal(store.get(ref).body.targetToken, "replacement");
    assert.equal(store.get(ref).state, "ended");
    await store.sweep(async (token) => revoked.push(token));
    assert.deepEqual(revoked, ["target", "actor", "replacement"]);
    assert.equal(store.get(ref).state, "cleaned");
    store.retain(ref, { targetToken: "late-response" });
    assert.equal(store.get(ref).state, "ended");
    assert.throws(() => store.prove(ref, {}), { status: 409 });
    await store.sweep(async (token) => revoked.push(token));
    assert.equal(revoked.at(-1), "late-response");
  } finally {
    store.close();
  }
});

test("a concurrent end cannot be reported active after asynchronous native verification", async () => {
  const store = open(),
    verification = deferred(),
    entered = deferred(),
    endSecret = supportRandom();
  const { ref } = store.create(
    "session",
    {
      actor: "actor",
      consumer: "artbin",
      endHash: supportHash(endSecret),
      targetToken: "target",
    },
    60000,
    "active",
  );
  const login = createSupportLogin({
    store,
    actorSubject: "actor",
    consumers: { artbin: { transportSecret: "secret" } },
    eligible: async () => true,
    provider: {
      async verify() {
        entered.resolve();
        await verification.promise;
      },
      async revoke() {},
    },
  });
  const auth = "Basic " + Buffer.from("artbin:secret").toString("base64");
  try {
    const status = login.server(
      "/support/session",
      { supportId: ref, endSecret },
      auth,
    );
    await entered.promise;
    await login.server("/support/end", { supportId: ref, endSecret }, auth);
    verification.resolve();
    assert.equal((await status).active, false);
  } finally {
    store.close();
  }
});

test("termination and expiry prevent proof transfer even after native work completes", () => {
  let now = 0;
  const store = createSupportStore({
    filename: ":memory:",
    key: randomBytes(32),
    now: () => now,
  });
  try {
    const { ref } = store.create("actor", {}, 10, "exchanging");
    store.update(ref, (row) => {
      row.state = "ended";
    });
    assert.throws(() => store.prove(ref, {}), { status: 409 });
    const other = store.create("actor", {}, 10, "exchanging");
    store.prove(other.ref, {});
    now = 11;
    assert.throws(() => store.transfer(other.ref, "code", {}, 100), {
      status: 409,
    });
  } finally {
    store.close();
  }
});

test("malformed actor expiry cannot discard an issued native access token", async () => {
  const retained = [];
  const issuer = "https://issuer.test";
  const provider = createSupportProvider({
    issuer,
    clientId: "support",
    clientSecret: "secret",
    callback: "https://auth.test/support/callback",
    consumers: {},
    request: async (url) =>
      new Response(
        JSON.stringify(
          url.endsWith("openid-configuration")
            ? {
                issuer,
                authorization_endpoint: issuer + "/authorize",
                token_endpoint: issuer + "/token",
                jwks_uri: issuer + "/keys",
                revocation_endpoint: issuer + "/revoke",
                introspection_endpoint: issuer + "/introspect",
                userinfo_endpoint: issuer + "/userinfo",
              }
            : {
                access_token: "issued-before-malformed-metadata",
                expires_in: null,
              },
        ),
        { status: 200 },
      ),
  });
  await assert.rejects(
    provider.actor("code", {}, async (value) => retained.push(value)),
    { status: 502 },
  );
  assert.deepEqual(retained, [
    { actorToken: "issued-before-malformed-metadata" },
  ]);
});

test("expiry during native issuance keeps an unknown outcome blocked after cleanup", async () => {
  let now = 0;
  const store = createSupportStore({
    filename: ":memory:",
    key: randomBytes(32),
    now: () => now,
  });
  try {
    const { ref } = store.create("actor", {}, 10, "exchanging");
    now = 11;
    await store.sweep(async () => {});
    assert.equal(store.get(ref).state, "unknown");
    assert.equal(store.unknownCount(), 1);
    store.retain(ref, { actorToken: "late-token" });
    const revoked = [];
    await store.sweep(async (token) => revoked.push(token));
    assert.deepEqual(revoked, ["late-token"]);
    assert.equal(store.unknownCount(), 1);
    assert.throws(() => store.prove(ref, {}), { status: 409 });
  } finally {
    store.close();
  }
});

test("another administrator cannot start support and a previously authorized actor loses their lease after the configured actor changes", async () => {
  const store = open(),
    revoked = [];
  const endSecret = supportRandom();
  const consumers = {
    artbin: { origin: "https://artbin.test", transportSecret: "secret" },
  };
  const login = createSupportLogin({
    store,
    actorSubject: "reviewed-human",
    consumers,
    eligible: async () => true,
    provider: {
      async revoke(token) {
        revoked.push(token);
      },
    },
  });
  try {
    await assert.rejects(
      login.start({
        actor: "another-admin",
        target: "target",
        consumer: "artbin",
        reason: "Read only acceptance",
      }),
      { status: 403 },
    );
    const { ref } = store.create(
      "session",
      {
        actor: "another-admin",
        consumer: "artbin",
        targetToken: "existing-token",
        endHash: supportHash(endSecret),
      },
      60000,
      "active",
    );
    await login.sweep();
    assert.equal(store.get(ref).state, "cleaned");
    assert.deepEqual(revoked, ["existing-token"]);
    const url = new URL(
      await login.start({
        actor: "reviewed-human",
        target: "target",
        consumer: "artbin",
        reason: "Read only acceptance",
      }),
    );
    assert.equal(url.origin, "https://artbin.test");
  } finally {
    store.close();
  }
});
