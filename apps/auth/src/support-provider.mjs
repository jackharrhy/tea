import { createPublicKey, verify } from "node:crypto";

const fail = () =>
  Object.assign(new Error("Native support verification failed"), {
    status: 502,
  });
const basic = (id, secret) =>
  "Basic " +
  Buffer.from(
    `${encodeURIComponent(id)}:${encodeURIComponent(secret)}`,
  ).toString("base64");
export function createSupportProvider({
  issuer,
  clientId,
  clientSecret,
  callback,
  consumers,
  request = fetch,
  now = Date.now,
}) {
  let discovery, keys;
  async function json(url, options = {}) {
    const response = await request(url, {
      ...options,
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (!response.ok) {
      const error = fail();
      error.definiteRejection = response.status >= 400 && response.status < 500;
      throw error;
    }
    return response.json();
  }
  async function document() {
    if (!discovery) {
      const value = await json(issuer + "/.well-known/openid-configuration");
      if (value.issuer !== issuer) throw fail();
      for (const key of [
        "authorization_endpoint",
        "token_endpoint",
        "jwks_uri",
        "revocation_endpoint",
        "introspection_endpoint",
        "userinfo_endpoint",
      ]) {
        const url = new URL(value[key]);
        if (
          url.origin !== new URL(issuer).origin ||
          url.username ||
          url.password ||
          url.hash
        )
          throw fail();
      }
      discovery = value;
    }
    return discovery;
  }
  async function form(endpoint, fields, id = clientId, secret = clientSecret) {
    return json(endpoint, {
      method: "POST",
      headers: {
        authorization: basic(id, secret),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(
        Object.entries(fields).flatMap(([key, value]) =>
          (Array.isArray(value) ? value : [value]).map((item) => [key, item]),
        ),
      ),
    });
  }
  async function claims(token, audience) {
    if (typeof token !== "string" || token.length > 32768) throw fail();
    const parts = token.split(".");
    if (parts.length !== 3) throw fail();
    const [header, payload] = parts
      .slice(0, 2)
      .map((value) => JSON.parse(Buffer.from(value, "base64url")));
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw fail();
    const doc = await document();
    if (
      !keys ||
      keys.expires < now() ||
      !keys.value.some((key) => key.kid === header.kid)
    )
      keys = {
        value: (await json(doc.jwks_uri)).keys,
        expires: now() + 300000,
      };
    const jwk = keys.value.find(
      (key) =>
        key.kid === header.kid &&
        key.kty === "RSA" &&
        (!key.use || key.use === "sig"),
    );
    if (
      !jwk ||
      !verify(
        "RSA-SHA256",
        Buffer.from(parts[0] + "." + parts[1]),
        createPublicKey({ key: jwk, format: "jwk" }),
        Buffer.from(parts[2], "base64url"),
      )
    )
      throw fail();
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud],
      seconds = now() / 1000;
    if (
      payload.iss !== issuer ||
      !audiences.includes(audience) ||
      typeof payload.sub !== "string" ||
      !payload.sub ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= seconds ||
      !Number.isFinite(payload.iat) ||
      payload.iat > seconds + 5 ||
      (payload.nbf && payload.nbf > seconds + 5)
    )
      throw fail();
    return payload;
  }
  async function introspect(token, consumer) {
    return form(
      (await document()).introspection_endpoint,
      { token },
      consumer.resourceClientId,
      consumer.resourceSecret,
    );
  }
  function verifyTarget(value, context, consumer, signed) {
    const audiences = Array.isArray(value.aud) ? value.aud : [value.aud];
    const roles =
      value[`urn:zitadel:iam:org:project:${consumer.projectId}:roles`] || {};
    const role = ["admin", "member"].find((candidateRole) =>
      Object.hasOwn(roles[candidateRole] || {}, consumer.organizationId),
    );
    if (
      value.iss !== issuer ||
      value.sub !== context.target ||
      value.act?.iss !== issuer ||
      value.act?.sub !== context.actor ||
      value.client_id !== clientId ||
      !audiences.includes(consumer.projectId) ||
      !role ||
      value.exp <= now() / 1000
    )
      throw fail();
    if (!signed) {
      const scope = new Set((value.scope || "").split(/\s+/));
      if (
        !value.active ||
        value.jack_auth_principal_type !== "user" ||
        [
          "openid",
          "profile",
          `urn:zitadel:iam:org:project:id:${consumer.projectId}:aud`,
          "urn:zitadel:iam:org:projects:roles",
        ].some((key) => !scope.has(key))
      )
        throw fail();
    }
    return role;
  }
  return {
    async authorize(transaction) {
      const url = new URL((await document()).authorization_endpoint);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callback,
        response_type: "code",
        scope: `openid profile urn:zitadel:iam:org:project:id:${consumers[transaction.consumer].projectId}:aud urn:zitadel:iam:org:projects:roles`,
        state: transaction.state,
        nonce: transaction.nonce,
        code_challenge: transaction.challenge,
        code_challenge_method: "S256",
      }).toString();
      return url.href;
    },
    async actor(code, transaction, retain = async () => {}) {
      const token = await form((await document()).token_endpoint, {
        grant_type: "authorization_code",
        code,
        redirect_uri: callback,
        code_verifier: transaction.verifier,
      });
      if (typeof token.access_token !== "string" || !token.access_token)
        throw fail();
      await retain({ actorToken: token.access_token });
      if (!Number.isFinite(token.expires_in) || token.expires_in <= 0)
        throw fail();
      const proof = await claims(token.id_token, clientId);
      if (
        proof.sub !== transaction.actor ||
        proof.nonce !== transaction.nonce ||
        !token.access_token ||
        !(token.expires_in > 0)
      )
        throw fail();
      return {
        actorToken: token.access_token,
        actorTokenExpires: now() + token.expires_in * 1000,
      };
    },
    async exchange(context, retain = async () => {}) {
      const consumer = consumers[context.consumer];
      const token = await form((await document()).token_endpoint, {
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: context.target,
        subject_token_type: "urn:zitadel:params:oauth:token-type:user_id",
        actor_token: context.actorToken,
        actor_token_type: "urn:ietf:params:oauth:token-type:access_token",
        requested_token_type: "urn:ietf:params:oauth:token-type:jwt",
        audience: [consumer.projectId, clientId],
        scope: `openid profile urn:zitadel:iam:org:project:id:${consumer.projectId}:aud urn:zitadel:iam:org:projects:roles`,
      });
      if (token.access_token) await retain({ targetToken: token.access_token });
      if (!token.access_token || token.token_type?.toLowerCase() !== "bearer")
        throw fail();
      return { targetToken: token.access_token };
    },
    async verify(context) {
      const consumer = consumers[context.consumer],
        proof = await claims(context.targetToken, consumer.projectId),
        principal = await introspect(context.targetToken, consumer);
      if (
        !(Array.isArray(proof.aud) ? proof.aud : [proof.aud]).includes(clientId)
      )
        throw fail();
      const role = verifyTarget(principal, context, consumer, false);
      if (verifyTarget(proof, context, consumer, true) !== role) throw fail();
      return { expires: Math.min(proof.exp, principal.exp) * 1000, role };
    },
    async revoke(token, field, context) {
      const response = await request((await document()).revocation_endpoint, {
        method: "POST",
        headers: {
          authorization: basic(clientId, clientSecret),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token, token_type_hint: "access_token" }),
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw fail();
      // /revoke success alone does not prove that a native JWT became inactive.
      const consumer = consumers[context.consumer];
      const principal =
        field === "actorToken"
          ? await form((await document()).introspection_endpoint, { token })
          : await introspect(token, consumer);
      if (principal.active) throw fail();
      const userinfo = await request((await document()).userinfo_endpoint, {
        headers: { authorization: "Bearer " + token },
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      if (userinfo.status !== 401) throw fail();
    },
  };
}
