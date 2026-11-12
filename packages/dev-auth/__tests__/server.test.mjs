import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

const random = () => randomBytes(32).toString("base64url");
const app = (name, role) => ({
  clientId: `${name}-browser`,
  callback: `http://127.0.0.1:${name === "first" ? 7777 : 7778}/auth/callback`,
  projectId: `${name}-project`,
  organizationId: "local-org",
  subject: "local-jack",
  username: "local-jack",
  displayName: "Local Jack",
  roles: [role],
  resourceClientId: `${name}-resource`,
  resourceSecret: `${name}-secret`,
});

test("one local issuer isolates two exact app registrations", async () => {
  const port = await new Promise((resolve) => {
    const socket = createServer();
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      socket.close(() => resolve(address.port));
    });
  });
  const issuer = `http://127.0.0.1:${port}`;
  const root = await mkdtemp(join(tmpdir(), "harrhy-dev-auth-"));
  const first = app("first", "admin");
  const second = app("second", "member");
  const config = join(root, "apps.json");
  await writeFile(config, JSON.stringify({ applications: [first, second] }));
  const child = spawn(
    process.execPath,
    [new URL("../server.mjs", import.meta.url).pathname],
    {
      env: {
        ...process.env,
        HARRHY_DEV_AUTH_PORT: String(port),
        HARRHY_DEV_AUTH_ORIGIN: issuer,
        HARRHY_DEV_AUTH_CONFIG: config,
      },
      stdio: "ignore",
    },
  );
  try {
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`${issuer}/.well-known/openid-configuration`)).ok)
          break;
      } catch {}
      if (i === 49) throw new Error("Local issuer did not start");
      await delay(50);
    }
    const verifier = random() + random().slice(0, 16);
    const state = random();
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorize = (callback) => {
      const url = new URL(`${issuer}/oauth/v2/authorize`);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: first.clientId,
        redirect_uri: callback,
        scope: `openid urn:zitadel:iam:org:project:id:${first.projectId}:aud urn:zitadel:iam:org:projects:roles urn:zitadel:iam:org:project:role:admin`,
        state,
        nonce: random(),
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      return url;
    };
    assert.equal((await fetch(authorize(second.callback))).status, 400);
    const page = await fetch(authorize(first.callback)).then((response) =>
      response.text(),
    );
    const ticket = /name="ticket" value="([A-Za-z0-9_-]+)"/.exec(page)?.[1];
    assert.ok(ticket);
    const confirmed = await fetch(`${issuer}/dev/continue`, {
      method: "POST",
      headers: { Origin: issuer },
      body: new URLSearchParams({ ticket }),
      redirect: "manual",
    });
    assert.equal(confirmed.status, 303);
    const code = new URL(confirmed.headers.get("Location")).searchParams.get(
      "code",
    );
    const token = await fetch(`${issuer}/oauth/v2/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: first.clientId,
        redirect_uri: first.callback,
        code,
        code_verifier: verifier,
      }),
    }).then((response) => response.json());
    assert.ok(token.access_token);
    const inspect = async (registration) =>
      fetch(`${issuer}/oauth/v2/introspect`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${registration.resourceClientId}:${registration.resourceSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({ token: token.access_token }),
      }).then((response) => response.json());
    assert.equal((await inspect(first)).active, true);
    assert.equal((await inspect(second)).active, false);
    assert.equal(
      (
        await fetch(`${issuer}/oauth/v2/token`, {
          method: "POST",
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: first.clientId,
            redirect_uri: first.callback,
            code,
            code_verifier: verifier,
          }),
        })
      ).status,
      400,
    );
  } finally {
    child.kill();
    await rm(root, { recursive: true, force: true });
  }
});
