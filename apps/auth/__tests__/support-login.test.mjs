import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { createSupportStore, supportRandom } from "../src/support-store.mjs";
import { createSupportLogin } from "../src/support-login.mjs";

test("one-use actor-bound handoff, no actor app grant, fresh checks, local end and encrypted restart-safe revocation", async () => {
  const dir = mkdtempSync(tmpdir() + "/support-"),
    filename = dir + "/access.sqlite",
    key = randomBytes(32);
  let time = 1_800_000_000_000,
    revokeUnavailable = true,
    eligible = true,
    nativeCalls = 0,
    exchangeCalls = 0;
  const revoked = [];
  const provider = {
    async authorize(value) {
      return "http://issuer/authorize?state=" + value.state;
    },
    async actor() {
      return { actorToken: "private-actor-token" };
    },
    async exchange() {
      exchangeCalls++;
      return { targetToken: "private-target-token" };
    },
    async verify() {
      nativeCalls++;
      return { expires: time + 900000, role: "member" };
    },
    async revoke(token) {
      if (revokeUnavailable) throw Error("offline");
      revoked.push(token);
    },
  };
  const consumers = {
    artbin: {
      origin: "https://artbin.test",
      callback: "https://artbin.test/auth/support/callback",
      transportSecret: "private-transport",
    },
  };
  const authorization =
    "Basic " + Buffer.from("artbin:private-transport").toString("base64");
  const open = (store) =>
    createSupportLogin({
      store,
      provider,
      consumers,
      actorSubject: "actor",
      now: () => time,
      eligible: async () => eligible,
    });
  let store = createSupportStore({ filename, key, now: () => time }),
    login = open(store);
  try {
    const start = new URL(
      await login.start({
        actor: "actor",
        target: "target",
        consumer: "artbin",
        reason: "Investigate interface",
      }),
    );
    const verifier = supportRandom(),
      state = supportRandom(),
      nonce = supportRandom();
    const input = {
      request: start.searchParams.get("request"),
      consumer_id: "artbin",
      redirect_uri: consumers.artbin.callback,
      state,
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    };
    await assert.rejects(login.handoff(input, "other-actor"), { status: 403 });
    const actorUrl = new URL(await login.handoff(input, "actor"));
    const callback = new URL(
      await login.callback(
        { state: actorUrl.searchParams.get("state"), code: "genuine-code" },
        "actor",
      ),
    );
    await assert.rejects(
      login.callback(
        { state: actorUrl.searchParams.get("state"), code: "genuine-code" },
        "actor",
      ),
      { status: 409 },
    );
    const redeem = {
      code: callback.searchParams.get("code"),
      code_verifier: verifier,
      redirect_uri: consumers.artbin.callback,
      consumer_id: "artbin",
    };
    await assert.rejects(
      login.server(
        "/support/redeem",
        { ...redeem, code_verifier: supportRandom() },
        authorization,
      ),
      { status: 403 },
    );
    const result = await login.server("/support/redeem", redeem, authorization);
    assert.equal(result.support.nonce, nonce);
    assert.equal(result.support.actorSubject, "actor");
    assert.equal(result.support.targetSubject, "target");
    assert.equal(Date.parse(result.support.expiresAt) - time, 600000);
    await assert.rejects(
      login.server("/support/redeem", redeem, authorization),
      { status: 409 },
    );
    assert.equal(exchangeCalls, 1);
    const session = {
      supportId: result.support.id,
      endSecret: result.support.endSecret,
    };
    assert.equal(
      (await login.server("/support/session", session, authorization)).active,
      true,
    );
    assert.equal(nativeCalls, 2);
    await assert.rejects(
      login.server("/support/session", session, "Basic bad"),
      { status: 401 },
    );
    assert.equal(
      (await login.server("/support/end", session, authorization)).revocation,
      "pending",
    );
    assert.equal(
      (await login.server("/support/session", session, authorization)).active,
      false,
    );
    assert(
      !readFileSync(filename).includes(Buffer.from("private-target-token")),
    );
    assert(
      !readFileSync(filename).includes(Buffer.from("private-actor-token")),
    );
    store.close();
    store = createSupportStore({ filename, key, now: () => time });
    login = open(store);
    revokeUnavailable = false;
    await login.sweep();
    assert.deepEqual(
      revoked.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      ["private-actor-token", "private-target-token"],
    );
    assert.equal(
      (await login.server("/support/end", session, authorization)).revocation,
      "confirmed",
    );
    eligible = false;
    await assert.rejects(
      login.start({
        actor: "actor",
        target: "target",
        consumer: "artbin",
        reason: "Review",
      }),
      { status: 403 },
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an interrupted native exchange is never replayed after restart and blocks new support starts", async () => {
  const dir = mkdtempSync(tmpdir() + "/support-"),
    filename = dir + "/access.sqlite",
    key = randomBytes(32);
  let store = createSupportStore({ filename, key });
  const { ref } = store.create("code", {}, 60000);
  store.claim(ref, "code", "pending", "exchanging");
  store.close();
  store = createSupportStore({ filename, key });
  try {
    assert.equal(store.unknownCount(), 1);
    await assert.rejects(
      createSupportLogin({
        store,
        provider: {},
        consumers: {},
        actorSubject: "actor",
        eligible: async () => true,
      }).start({}),
      { status: 503 },
    );
    assert.throws(() => store.claim(ref, "code", "pending", "exchanging"), {
      status: 409,
    });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("absolute expiry and removed eligibility end stored sessions without sliding expiry", async () => {
  let now = 1000,
    allowed = true;
  const revoked = [];
  const store = createSupportStore({
    filename: ":memory:",
    key: randomBytes(32),
    now: () => now,
  });
  const consumers = { artbin: { transportSecret: "secret" } };
  const provider = {
    async revoke(token) {
      revoked.push(token);
    },
    async verify() {
      return { expires: 999999, role: "member" };
    },
  };
  const login = createSupportLogin({
    store,
    provider,
    consumers,
    actorSubject: "a",
    eligible: async () => allowed,
    now: () => now,
  });
  try {
    const endSecret = supportRandom();
    const { ref } = store.create(
      "session",
      {
        actor: "a",
        target: "b",
        consumer: "artbin",
        endHash: createHash("sha256").update(endSecret).digest("hex"),
        targetToken: "expired-token",
      },
      10,
      "active",
    );
    now = 1011;
    await login.sweep();
    assert.deepEqual(revoked, ["expired-token"]);
    assert.equal(store.get(ref).state, "cleaned");
    const next = store.create(
      "session",
      {
        actor: "a",
        target: "b",
        consumer: "artbin",
        endHash: createHash("sha256").update(endSecret).digest("hex"),
        targetToken: "removed-member-token",
      },
      600000,
      "active",
    );
    allowed = false;
    await login.sweep();
    assert.equal(store.get(next.ref).state, "cleaned");
    assert(revoked.includes("removed-member-token"));
  } finally {
    store.close();
  }
});
