import { timingSafeEqual, createHash } from "node:crypto";
import { supportRandom, supportHash } from "./support-store.mjs";

const fail = (status) =>
  Object.assign(new Error("Support request unavailable"), { status });
const opaque = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function createSupportLogin({
  store,
  provider,
  consumers,
  eligible,
  actorSubject,
  now = Date.now,
}) {
  if (
    typeof actorSubject !== "string" ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(actorSubject)
  )
    throw Error("Reviewed support actor required");
  async function allowed(body) {
    if (
      body.actor !== actorSubject ||
      !consumers[body.consumer] ||
      !(await eligible(body))
    )
      throw fail(403);
  }
  function authenticate(authorization, input) {
    let value;
    try {
      value = Buffer.from(
        (authorization || "").replace(/^Basic /, ""),
        "base64",
      ).toString();
    } catch {
      throw fail(401);
    }
    const colon = value.indexOf(":");
    let id, secret;
    try {
      id = decodeURIComponent(value.slice(0, colon));
      secret = decodeURIComponent(value.slice(colon + 1));
    } catch {
      throw fail(401);
    }
    if (
      !authorization?.startsWith("Basic ") ||
      colon < 1 ||
      !consumers[id] ||
      !same(secret, consumers[id].transportSecret) ||
      (input.consumer_id && input.consumer_id !== id)
    )
      throw fail(401);
    return id;
  }
  function session(input, consumer) {
    if (!opaque(input.supportId) || !opaque(input.endSecret)) throw fail(400);
    const row = store.get(input.supportId);
    if (
      !row ||
      row.kind !== "session" ||
      row.body.consumer !== consumer ||
      !same(row.body.endHash, supportHash(input.endSecret))
    )
      throw fail(403);
    return row;
  }
  async function sweep() {
    await store.sweep(
      (token, field, body) => provider.revoke(token, field, body),
      async (body) => {
        try {
          await allowed(body);
          return true;
        } catch {
          return false;
        }
      },
    );
  }
  return {
    async start({ actor, target, consumer, reason }) {
      if (store.unknownCount()) throw fail(503);
      if (
        typeof reason !== "string" ||
        reason.trim().length < 3 ||
        reason.length > 500
      )
        throw fail(400);
      const body = { actor, target, consumer, reason: reason.trim() };
      await allowed(body);
      const { ref } = store.create("request", body, 120000);
      const url = new URL("/auth/support/start", consumers[consumer].origin);
      url.searchParams.set("request", ref);
      return url.href;
    },
    async handoff(input, actor) {
      const consumer = consumers[input.consumer_id];
      if (
        !consumer ||
        input.redirect_uri !== consumer.callback ||
        !opaque(input.request) ||
        !opaque(input.state) ||
        !opaque(input.nonce) ||
        !/^[A-Za-z0-9_-]{43}$/.test(input.code_challenge || "") ||
        input.code_challenge_method !== "S256"
      )
        throw fail(400);
      const row = store.claim(
        input.request,
        "request",
        "pending",
        "attached",
        (body) => body.actor === actor && body.consumer === input.consumer_id,
      );
      await allowed(row.body);
      const verifier = supportRandom(),
        nonce = supportRandom();
      const transaction = {
        ...row.body,
        verifier,
        nonce,
        appState: input.state,
        appNonce: input.nonce,
        challenge: input.code_challenge,
      };
      const { ref: state } = store.create("actor", transaction, 120000);
      return provider.authorize({
        ...transaction,
        state,
        challenge: createHash("sha256").update(verifier).digest("base64url"),
      });
    },
    async callback(input, actor) {
      if (
        !opaque(input.state) ||
        typeof input.code !== "string" ||
        !input.code ||
        input.code.length > 4096
      )
        throw fail(400);
      const row = store.claim(
        input.state,
        "actor",
        "pending",
        "exchanging",
        (body) => body.actor === actor,
      );
      await allowed(row.body);
      let proof;
      try {
        proof = await provider.actor(input.code, row.body, (retained) =>
          store.retain(input.state, retained),
        );
      } catch (error) {
        store.update(input.state, (record) => {
          record.state =
            record.body.actorToken || error.definiteRejection
              ? "ended"
              : "unknown";
        });
        await sweep();
        throw fail(502);
      }
      try {
        store.prove(input.state, proof);
      } catch {
        await sweep();
        throw fail(409);
      }
      // Transfer the encrypted token to one short-lived code; never issue a second code for a replay.
      const result = store.transfer(
        input.state,
        "code",
        { ...row.body, ...proof },
        60000,
      );
      const url = new URL(consumers[row.body.consumer].callback);
      url.searchParams.set("code", result.ref);
      url.searchParams.set("state", row.body.appState);
      return url.href;
    },
    async server(path, input, authorization) {
      const consumer = authenticate(authorization, input);
      if (path === "/support/redeem") {
        if (
          !opaque(input.code) ||
          !/^[A-Za-z0-9_-]{43,128}$/.test(input.code_verifier || "")
        )
          throw fail(400);
        const row = store.claim(
          input.code,
          "code",
          "pending",
          "exchanging",
          (body) =>
            body.consumer === consumer &&
            input.redirect_uri === consumers[consumer].callback &&
            same(
              body.challenge,
              createHash("sha256")
                .update(input.code_verifier)
                .digest("base64url"),
            ),
        );
        await allowed(row.body);
        let token;
        try {
          token = await provider.exchange(row.body, (retained) =>
            store.retain(input.code, retained),
          );
        } catch (error) {
          store.update(input.code, (record) => {
            record.state =
              record.body.targetToken || error.definiteRejection
                ? "ended"
                : "unknown";
          });
          await sweep();
          throw fail(502);
        }
        // Persist before verification: even a malformed token response must be cleaned durably.
        try {
          store.prove(input.code, token);
        } catch {
          await sweep();
          throw fail(409);
        }
        let verified;
        try {
          verified = await provider.verify({ ...row.body, ...token });
        } catch {
          store.update(input.code, (record) => {
            record.state = "ended";
          });
          await sweep();
          throw fail(403);
        }
        const expires = Math.min(now() + 600000, verified.expires);
        if (expires <= now()) {
          store.update(input.code, (record) => {
            record.state = "ended";
          });
          await sweep();
          throw fail(410);
        }
        const endSecret = supportRandom();
        const result = store.transfer(
          input.code,
          "session",
          {
            ...row.body,
            ...token,
            role: verified.role,
            endHash: supportHash(endSecret),
          },
          expires - now(),
          "active",
          expires,
        );
        return {
          access_token: token.targetToken,
          token_type: "Bearer",
          support: {
            id: result.ref,
            actorSubject: row.body.actor,
            targetSubject: row.body.target,
            expiresAt: new Date(result.row.expires).toISOString(),
            nonce: row.body.appNonce,
            endSecret,
          },
        };
      }
      if (!["/support/session", "/support/end"].includes(path)) throw fail(404);
      const row = session(input, consumer);
      if (path === "/support/end") {
        store.update(input.supportId, (record) => {
          if (record.state !== "cleaned") record.state = "ended";
        });
        await sweep();
        return {
          active: false,
          revocation:
            store.get(input.supportId).state === "cleaned"
              ? "confirmed"
              : "pending",
        };
      }
      if (row.state !== "active" || row.expires <= now()) {
        await sweep();
        return { active: false };
      }
      try {
        await allowed(row.body);
        await provider.verify(row.body);
      } catch {
        store.update(input.supportId, (record) => {
          record.state = "ended";
        });
        await sweep();
        return { active: false };
      }
      const current = store.get(input.supportId);
      if (current.state !== "active" || current.expires <= now())
        return { active: false };
      return {
        active: true,
        supportId: input.supportId,
        actorSubject: row.body.actor,
        targetSubject: row.body.target,
        expiresAt: new Date(row.expires).toISOString(),
      };
    },
    sweep,
  };
}
