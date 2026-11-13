import assert from "node:assert/strict";
import { createServer } from "node:https";
import { createECDH, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deliverPush } from "../app/push-delivery.ts";
process.umask(0o077);
if (process.argv[2] === "--child") {
  const { env, delivery } = JSON.parse(await readFile(process.argv[3], "utf8"));
  const calls = [];
  await deliverPush(env, { call: async (...args) => calls.push(args) }, [
    delivery,
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "expirePushSubscription");
  assert.equal(calls[0][1], 17);
  console.log("PASS child encrypted TLS send and 410 cleanup");
} else {
  const dir = await mkdtemp(join(tmpdir(), "fourm-push-https-"));
  let server;
  try {
    const cert = join(dir, "cert.pem"),
      key = join(dir, "key.pem");
    const generated = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
    assert.equal(generated.status, 0);
    let received = 0;
    server = createServer(
      { key: await readFile(key), cert: await readFile(cert) },
      async (req, res) => {
        assert.equal(req.method, "POST");
        assert.equal(req.url, "/isolated-push");
        assert.equal(req.headers["content-encoding"], "aes128gcm");
        assert.match(req.headers.authorization, /^vapid t=/);
        let length = 0;
        for await (const part of req) length += part.length;
        assert.equal(length, 4096);
        received++;
        res.writeHead(410);
        res.end();
      },
    );
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const receiver = createECDH("prime256v1");
    receiver.generateKeys();
    const vapid = createECDH("prime256v1");
    vapid.generateKeys();
    const config = join(dir, "config.json");
    await writeFile(
      config,
      JSON.stringify({
        env: {
          VAPID_PUBLIC_KEY: vapid.getPublicKey().toString("base64url"),
          VAPID_PRIVATE_KEY: vapid.getPrivateKey().toString("base64url"),
          VAPID_SUBJECT: "mailto:isolated@example.invalid",
        },
        delivery: {
          subscription: {
            id: 17,
            endpoint: `https://127.0.0.1:${server.address().port}/isolated-push`,
            p256dh_key: receiver.getPublicKey().toString("base64url"),
            auth_key: randomBytes(16).toString("base64url"),
          },
          title: "Isolated reply",
          body: "Isolated member replied",
          url: "/forum/1#post-2",
        },
      }),
    );
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), "--child", config],
      {
        env: { ...process.env, NODE_EXTRA_CA_CERTS: cert },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (part) => (output += part));
    child.stderr.on("data", () => {});
    const status = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(status, 0, "Scoped HTTPS child failed");
    assert.equal(received, 1);
    assert.match(output, /PASS child/);
    console.log(
      JSON.stringify({
        status: "PASS",
        scope:
          "Node transport actual loopback HTTPS; native Worker integration pending",
        encryptedBytes: 4096,
        requests: received,
        expiredSubscriptionCleanup: true,
        productionTouched: false,
      }),
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}
