import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCredential } from "../src/credentials.mjs";

test("service credentials sign assertions, share exchanges and refresh expiring tokens", async () => {
  const directory = mkdtempSync(join(tmpdir(), "auth-credential-"));
  try {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const path = join(directory, "credential.json");
    writeFileSync(
      path,
      JSON.stringify({
        keyId: "key-1",
        userId: "machine-1",
        key: privateKey.export({ type: "pkcs8", format: "pem" }),
      }),
    );
    let clock = 1_000_000,
      calls = 0;
    const credential = createCredential(
      path,
      "https://auth.example",
      async (url, options) => {
        calls++;
        assert.equal(url.href, "https://auth.example/oauth/v2/token");
        const assertion = options.body.get("assertion");
        const [header, payload, signature] = assertion.split(".");
        assert.ok(
          verify(
            "RSA-SHA256",
            Buffer.from(`${header}.${payload}`),
            publicKey,
            Buffer.from(signature, "base64url"),
          ),
        );
        const claims = JSON.parse(Buffer.from(payload, "base64url"));
        assert.equal(claims.aud, "https://auth.example");
        assert.equal(claims.sub, "machine-1");
        assert.equal(claims.exp - claims.iat, 60);
        return Response.json({
          access_token: `token-${calls}`,
          expires_in: 300,
        });
      },
      () => clock,
    );
    assert.deepEqual(await Promise.all([credential(), credential()]), [
      "token-1",
      "token-1",
    ]);
    assert.equal(calls, 1);
    clock += 241_000;
    assert.equal(await credential(), "token-2");
    assert.equal(calls, 2);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("failed service exchanges can retry and never return an absent token", async () => {
  const directory = mkdtempSync(join(tmpdir(), "auth-credential-"));
  try {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const path = join(directory, "credential.json");
    writeFileSync(
      path,
      JSON.stringify({
        keyId: "key",
        userId: "machine",
        key: privateKey.export({ type: "pkcs8", format: "pem" }),
      }),
    );
    let calls = 0;
    const credential = createCredential(
      path,
      "https://auth.example",
      async () =>
        ++calls === 1
          ? Response.json({ error: "invalid_grant" }, { status: 401 })
          : Response.json({ access_token: "recovered", expires_in: 300 }),
    );
    await assert.rejects(credential(), /Service account authentication failed/);
    assert.equal(await credential(), "recovered");
  } finally {
    rmSync(directory, { recursive: true });
  }
});
