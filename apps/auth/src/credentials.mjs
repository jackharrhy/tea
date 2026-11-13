import { readFileSync } from "node:fs";
import { sign } from "node:crypto";

const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

export function createCredential(
  path,
  issuer,
  request = fetch,
  now = Date.now,
) {
  let cached, pending;
  return async () => {
    const credential = JSON.parse(readFileSync(path, "utf8"));
    if (credential.token) return credential.token;
    if (cached?.keyId === credential.keyId && cached.expires > now() + 60_000)
      return cached.token;
    if (pending) return pending;
    pending = (async () => {
      const issued = Math.floor(now() / 1000);
      const unsigned = `${encode({ alg: "RS256", typ: "JWT", kid: credential.keyId })}.${encode({ iss: credential.userId, sub: credential.userId, aud: issuer, iat: issued, exp: issued + 60 })}`;
      const assertion = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), credential.key).toString("base64url")}`;
      const response = await request(new URL("/oauth/v2/token", issuer), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
          scope: "openid urn:zitadel:iam:org:project:id:zitadel:aud",
        }),
        signal: AbortSignal.timeout(12_000),
        redirect: "error",
      });
      const result = await response.json();
      if (!response.ok || !result.access_token || !(result.expires_in > 0))
        throw new Error("Service account authentication failed");
      cached = {
        keyId: credential.keyId,
        token: result.access_token,
        expires: now() + result.expires_in * 1000,
      };
      return cached.token;
    })();
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  };
}
