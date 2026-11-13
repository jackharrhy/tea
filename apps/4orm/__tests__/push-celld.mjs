import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  createECDH,
  randomBytes,
  createPublicKey,
  createPrivateKey,
  createHash,
} from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as absolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const publicJWK = (point) => ({
  kty: "EC",
  crv: "P-256",
  x: point.subarray(1, 33).toString("base64url"),
  y: point.subarray(33).toString("base64url"),
});
process.umask(0o077);
const repo = process.cwd();
assert.equal(
  repo,
  fileURLToPath(new URL("../../..", import.meta.url)).replace(/\/$/, ""),
);
const binary =
  "/home/jack/.local/state/form-harrhy-integration/candidate/tools/celld";
const state = await mkdtemp(join(tmpdir(), "fourm-push-celld-"));
const evidence =
  "/home/jack/.local/state/form-harrhy-integration/candidate/push-celld-" +
  new Date().toISOString().replace(/[:.]/g, "");
await mkdir(evidence, { mode: 0o700 });
let runner;
let server;
let logs = "";
let requests = 0;
const children = [];
const port = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
try {
  server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/isolated");
      assert.equal(req.headers["content-encoding"], "aes128gcm");
      assert.match(req.headers.authorization, /^vapid t=/);
      let length = 0;
      for await (const part of req) length += part.length;
      assert.equal(length, 4096);
      requests++;
      res.writeHead(410);
      res.end();
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const appPort = await port();
  const receiver = createECDH("prime256v1");
  receiver.generateKeys();
  const vapid = createECDH("prime256v1");
  vapid.generateKeys();
  const vars = {
    VAPID_PUBLIC_KEY: vapid.getPublicKey().toString("base64url"),
    VAPID_PRIVATE_KEY: vapid.getPrivateKey().toString("base64url"),
    VAPID_SUBJECT: "mailto:isolated@example.invalid",
  };
  const delivery = {
    subscription: {
      id: 17,
      endpoint: "https://push.invalid/isolated",
      p256dh_key: receiver.getPublicKey().toString("base64url"),
      auth_key: randomBytes(16).toString("base64url"),
    },
    title: "Isolated reply",
    body: "Isolated member replied",
    url: "/forum/1#post-2",
  };
  const standardFormats = {
    publicSPKI: [
      ...createPublicKey({
        key: publicJWK(receiver.getPublicKey()),
        format: "jwk",
      }).export({ format: "der", type: "spki" }),
    ],
    privatePKCS8: [
      ...createPrivateKey({
        key: {
          ...publicJWK(vapid.getPublicKey()),
          d: vapid.getPrivateKey().toString("base64url"),
        },
        format: "jwk",
      }).export({ format: "der", type: "pkcs8" }),
    ],
    expectedSecretHash: createHash("sha256")
      .update(vapid.computeSecret(receiver.getPublicKey()))
      .digest("hex"),
  };
  const entry = `import {buildPushPayload,vapidHeaders} from ${JSON.stringify(absolute("node_modules/@block65/webcrypto-web-push/dist/lib/main.js"))};
import {deliverPush} from ${JSON.stringify(absolute("apps/4orm/app/push-delivery.ts"))};
 export default {async fetch(request,env){if(request.method==='GET')return Response.json({ready:true});const calls=[];const d=${JSON.stringify(delivery)};try{await buildPushPayload({data:{title:d.title,body:d.body,url:d.url}},{endpoint:d.subscription.endpoint,expirationTime:null,keys:{p256dh:d.subscription.p256dh_key,auth:d.subscription.auth_key}},{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY})}catch(error){const probe={};try{const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);probe.exportedRawPublicBytes=(await crypto.subtle.exportKey('raw',pair.publicKey)).byteLength;}catch(e){probe.generatedKeyError=e.name+': '+e.message;}try{const f=${JSON.stringify(standardFormats)};const peer=await crypto.subtle.importKey('spki',new Uint8Array(f.publicSPKI),{name:'ECDH',namedCurve:'P-256'},false,[]);const own=await crypto.subtle.importKey('pkcs8',new Uint8Array(f.privatePKCS8),{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'ECDH',public:peer},own,256);const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bits))).map(b=>b.toString(16).padStart(2,'0')).join('');probe.standardECDHMatchesNode=digest===f.expectedSecretHash;const aes=await crypto.subtle.importKey('raw',crypto.getRandomValues(new Uint8Array(16)),{name:'AES-GCM'},false,['encrypt','decrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},aes,new Uint8Array([1,2,3]));const clear=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv},aes,encrypted));probe.aesGCMRoundtrip=clear.join(',')==='1,2,3';const signed=await vapidHeaders({endpoint:d.subscription.endpoint},{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY});probe.vapidSigned=String(signed.headers.authorization).startsWith('vapid t=');}catch(e){probe.standardFormatsError=e.name+': '+e.message;}return Response.json({phase:'crypto',name:error.name,message:error.message,probe})}await deliverPush(env,{call:async(...args)=>calls.push(args)},${JSON.stringify([delivery])},(endpoint,init)=>{if(endpoint!=='https://push.invalid/isolated')throw Error('Uncaged endpoint');return fetch('http://127.0.0.1:${server.address().port}/isolated',init)});return Response.json({expired:calls.length===1&&calls[0][0]==='expirePushSubscription'&&calls[0][1]===17});}};`;
  await writeFile(join(state, "worker.ts"), entry);
  await writeFile(
    join(state, "wrangler.jsonc"),
    JSON.stringify({
      name: "fourm-push-test",
      main: "worker.ts",
      compatibility_date: "2026-11-12",
      compatibility_flags: ["nodejs_compat"],
      vars,
    }),
  );
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith("CELLD_")),
    ),
    CELLD_BUCKET: `sqlite://${join(state, "objects.sqlite3")}`,
    CELLD_WATCH: join(state, "replica"),
    CELLD_DURABILITY: "bucket",
    CELLD_ADDR: `127.0.0.1:${appPort}`,
    CELLD_INTERNAL_ADDR: "127.0.0.1:0",
    CELLD_ESBUILD: absolute("node_modules/.bin/esbuild"),
  };
  const run = (args) => {
    const c = spawn(binary, args, {
      cwd: state,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(c);
    c.stdout.on("data", (p) => (logs += p));
    c.stderr.on("data", (p) => (logs += p));
    return c;
  };
  const deployed = run(["deploy", join(state, "wrangler.jsonc")]);
  assert.equal(
    await new Promise((resolve, reject) => {
      deployed.once("error", reject);
      deployed.once("exit", resolve);
    }),
    0,
    "Test deployment failed",
  );
  runner = run(["--no-control-plane"]);
  let ready = false;
  for (let i = 0; i < 200; i++) {
    assert.equal(runner.exitCode, null, "Test runtime exited");
    try {
      const response = await fetch(`http://127.0.0.1:${appPort}/`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(100);
  }
  assert.ok(ready, "Test runtime readiness failed");
  const response = await fetch(`http://127.0.0.1:${appPort}/`, {
    method: "POST",
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(response.status, 200);
  const observed = await response.json();
  await writeFile(
    join(evidence, "worker-result.json"),
    JSON.stringify(observed, null, 2),
  );
  assert.deepEqual(observed, { expired: true });
  assert.equal(requests, 1);
  await writeFile(
    join(evidence, "receipt.json"),
    JSON.stringify(
      {
        status: "PASS",
        scope:
          "Native Celld WebCrypto plus loopback HTTP dispatch via test-only transport injection",
        encryptedBytes: 4096,
        receiverRequests: requests,
        expiredSnapshotCleanup: true,
        realTLSProviderAcceptance: false,
        replyGuestbookWorkflowAcceptance: false,
        productionTouched: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: "PASS", evidence }));
} catch (error) {
  await writeFile(
    join(evidence, "failure.json"),
    JSON.stringify({ status: "FAIL", message: error.message }, null, 2),
  );
  throw error;
} finally {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        delay(15000),
      ]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await new Promise((resolve) => child.once("exit", resolve));
      }
    }
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await writeFile(join(evidence, "runtime.log"), logs);
  await rm(state, { recursive: true, force: true });
}
