import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { CelldSmokeProcess } from "./celld-smoke-process.mjs";

import { chromium } from "playwright";
import { routes } from "../app/routes.ts";

const { values } = parseArgs({
  options: {
    image: { type: "string" },
    "allow-azure-suffix-limitation": { type: "boolean", default: false },
    backend: { type: "string", default: "sqlite" },
    binary: { type: "string", default: process.env.CELLD_BIN ?? "celld" },
    "upgrade-from-binary": { type: "string" },
    "azurite-url": { type: "string", default: "http://127.0.0.1:10000" },
    "upload-bytes": { type: "string", default: String(8 * 1024 * 1024) },
    output: { type: "string" },
    "keep-state": { type: "boolean", default: false },
  },
});
assert.ok(
  ["sqlite", "azurite"].includes(values.backend),
  "backend must be sqlite or azurite",
);
assert.ok(
  !values["upgrade-from-binary"] ||
    (!values.image && values.backend === "sqlite"),
  "upgrade-from-binary requires a SQLite binary smoke run",
);
const sizeBytes = Number(values["upload-bytes"]);
assert.ok(
  Number.isSafeInteger(sizeBytes) &&
    sizeBytes >= 4096 &&
    sizeBytes <= 1024 ** 3,
);
const waveHeader = Buffer.alloc(44);
waveHeader.write("RIFF", 0);
waveHeader.writeUInt32LE(sizeBytes - 8, 4);
waveHeader.write("WAVEfmt ", 8);
waveHeader.writeUInt32LE(16, 16);
waveHeader.writeUInt16LE(1, 20); // PCM
waveHeader.writeUInt16LE(1, 22); // Mono
waveHeader.writeUInt32LE(8000, 24);
waveHeader.writeUInt32LE(8000, 28);
waveHeader.writeUInt16LE(1, 32);
waveHeader.writeUInt16LE(8, 34);
waveHeader.write("data", 36);
waveHeader.writeUInt32LE(sizeBytes - 44, 40);
const root = fileURLToPath(new URL("..", import.meta.url));
const state = await mkdtemp(join(tmpdir(), "radio-celld-smoke-"));
const roomSlug = `smoke-${randomBytes(6).toString("hex")}`;
const port = await availablePort();
const origin = `http://127.0.0.1:${port}`;
const password = randomBytes(24).toString("hex");
const bucket =
  values.backend === "sqlite"
    ? `sqlite://${join(state, "objects.sqlite3")}`
    : `az://radio-${roomSlug}`;
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !key.startsWith("CELLD_") &&
      !key.startsWith("AZURE_") &&
      !key.startsWith("AZURITE_"),
  ),
);
Object.assign(environment, {
  NODE_ENV: "production",
  CELLD_BIN: values.binary,
  CELLD_BUCKET: bucket,
  CELLD_DURABILITY: "bucket",
  CELLD_WATCH: join(state, "replica"),
  CELLD_VAR_RADIO_PASSWORD: password,
  CELLD_VAR_RADIO_SESSION_SECRET: randomBytes(32).toString("hex"),
  CELLD_ADDR: `127.0.0.1:${port}`,
  CELLD_INTERNAL_ADDR: "127.0.0.1:0",
});
if (values.backend === "azurite") {
  environment.AZURE_STORAGE_USE_EMULATOR = "true";
  environment.AZURITE_BLOB_STORAGE_URL = values["azurite-url"];
}
const result = {
  backend: values.backend,
  bucket,
  sizeBytes,
  state,
  checks: [],
  status: "running",
};
let browser;
let cookie;
let context;
let page;
const runtime = new CelldSmokeProcess({
  root,
  state,
  environment,
  result,
  binary: values["upgrade-from-binary"] ?? values.binary,
  image: values.image,
});

try {
  await runtime.prepare();
  if (!values.image) await access(join(root, "dist/client/assets"));
  await runtime.start(origin);
  const lobby = await request(routes.home.href());
  assert.equal(lobby.status, 200);
  assert.equal(
    (
      await request(routes.rooms.show.href({ roomSlug }), {
        redirect: "manual",
      })
    ).status,
    303,
  );
  const login = await request(routes.join.href(), {
    method: "POST",
    body: new URLSearchParams({
      name: "Smoke listener",
      password,
      roomSlug: "cozy",
    }),
    redirect: "manual",
  });
  assert.equal(login.status, 303);
  cookie = login.headers.get("Set-Cookie")?.split(";", 1)[0];
  assert.ok(cookie, "login must issue a signed cookie");
  const created = await request(routes.rooms.create.href(), {
    method: "POST",
    body: new URLSearchParams({ name: "Smoke room", slug: roomSlug }),
    redirect: "manual",
  });
  assert.equal(created.status, 303);
  const roomPage = await request(routes.rooms.show.href({ roomSlug }));
  assert.equal(roomPage.status, 200);
  const html = await roomPage.text();
  const asset = html.match(/\/assets\/entry-[A-Z0-9]+\.js/)?.[0];
  assert.ok(asset, "production page must reference its built client entry");
  assert.equal((await request(asset)).status, 200);
  result.checks.push(
    "public lobby, signed login, room creation, SSR and built asset",
  );

  const uploadStarted = Date.now();
  const metadata = await request(
    routes.resources.createTrack.href({ roomSlug }),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "storage-smoke.wav",
        mediaType: "audio/wav",
        sizeBytes,
      }),
    },
  );
  assert.equal(metadata.status, 201, await metadata.clone().text());
  const pending = (await metadata.json()).track;
  const hash = createHash("sha256");
  const content = await request(
    routes.resources.uploadTrack.href({ roomSlug, trackId: pending.id }),
    {
      method: "PUT",
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(sizeBytes),
      },
      body: Readable.from(audioChunks(sizeBytes, hash)),
      duplex: "half",
    },
  );
  result.uploadMs = Date.now() - uploadStarted;
  assert.equal(content.status, 200, await content.clone().text());
  const track = (await content.json()).track;
  const expectedHash = hash.digest("hex");
  result.audioSha256 = expectedHash;
  result.trackId = track.id;
  await verifyMedia(track.url, expectedHash);
  result.checks.push(
    "streamed upload, exact full-object SHA-256, HEAD and byte ranges",
  );

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  const separator = cookie.indexOf("=");
  await context.addCookies([
    {
      name: cookie.slice(0, separator),
      value: cookie.slice(separator + 1),
      url: origin,
    },
  ]);
  page = await context.newPage();
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await verifyPlayback(track.url);
  result.checks.push("browser WAV metadata, decoding and playback progress");
  const snapshot = await connect();
  assert.ok(snapshot.tracks.some(({ id }) => id === track.id));
  const renamed = await command(
    { type: "RENAME_TRACK", trackId: track.id, title: "Persisted smoke" },
    "QUEUE_UPDATED",
  );
  assert.equal(
    renamed.tracks.find(({ id }) => id === track.id)?.title,
    "Persisted smoke",
  );
  assert.equal(
    (await command({ type: "SET_VOLUME", volume: 0.42 }, "VOLUME_UPDATED"))
      .volume,
    0.42,
  );
  const paused = await command(
    { type: "PAUSE", trackId: track.id, trackTimeSeconds: 1.25 },
    "SCHEDULED_PAUSE",
  );
  assert.equal(paused.trackId, track.id);
  assert.equal(paused.trackTimeSeconds, 1.25);
  result.checks.push(
    "authenticated WebSocket queue, volume and paused-position acknowledgments",
  );

  await page.close();
  await runtime.stop("SIGKILL");
  await rename(environment.CELLD_WATCH, join(state, "discarded-replica"));
  if (values["upgrade-from-binary"]) {
    result.upgradeFrom = {
      binary: result.binary,
      version: result.version,
      binarySha256: result.binarySha256,
    };
    runtime.binary = values.binary;
    await runtime.prepare();
  }
  await runtime.start(origin);
  page = await context.newPage();
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await verifyRestored(track, expectedHash, "Persisted smoke");
  result.checks.push(
    "SIGKILL, redeploy, empty replica restore: directory, queue, volume, paused position and audio",
  );
  if (result.upgradeFrom) {
    result.checks.push("existing SQLite state migrated from previous runtime");
    const upgraded = await command(
      { type: "RENAME_TRACK", trackId: track.id, title: "Upgraded smoke" },
      "QUEUE_UPDATED",
    );
    assert.equal(
      upgraded.tracks.find(({ id }) => id === track.id)?.title,
      "Upgraded smoke",
    );
    await page.close();
    await runtime.stop("SIGKILL");
    await rename(
      environment.CELLD_WATCH,
      join(state, "discarded-upgraded-replica"),
    );
    await runtime.start(origin);
    page = await context.newPage();
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await verifyRestored(track, expectedHash, "Upgraded smoke");
    result.checks.push(
      "new writes after upgrade survive another SIGKILL and empty replica restore",
    );
  }
  result.status = result.limitations?.length
    ? "passed_with_known_limitations"
    : "passed";
} catch (error) {
  result.status = "failed";
  result.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled([
    browser?.close(),
    runtime.stop("SIGTERM"),
  ]);
  for (const outcome of cleanup) {
    if (outcome.status === "rejected") {
      result.status = "failed";
      result.error = `${result.error ?? ""}\nCleanup: ${outcome.reason.stack ?? outcome.reason}`;
      process.exitCode = 1;
    }
  }
  if (values.image && result.oomKills !== 0) {
    result.status = "failed";
    result.error = `${result.error ?? ""}\nContainer qualification requires verified zero OOM kills`;
    process.exitCode = 1;
  }
  await runtime.saveTelemetry();
  await writeFile(join(state, "runtime.log"), runtime.logs);
  if (values.output) {
    await mkdir(dirname(values.output), { recursive: true });
    await writeFile(values.output, JSON.stringify(result, null, 2) + "\n");
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "passed" && !values["keep-state"])
    await rm(state, { recursive: true, force: true });
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) =>
    server.listen(0, "127.0.0.1", resolve).once("error", reject),
  );
  const assignedPort = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return assignedPort;
}

async function request(path, init = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("Cookie", cookie);
  return fetch(new URL(path, origin), {
    ...init,
    headers,
    signal: AbortSignal.timeout(180_000),
  });
}

async function* audioChunks(bytes, hash) {
  const chunk = Buffer.from(
    Array.from({ length: 65536 }, (_, index) => (index * 31 + 17) % 256),
  );
  for (let offset = 0; offset < bytes; offset += chunk.length) {
    const body =
      offset === 0
        ? Buffer.from(chunk)
        : chunk.subarray(0, Math.min(chunk.length, bytes - offset));
    if (offset === 0) waveHeader.copy(body);
    const limited = body.subarray(0, Math.min(body.length, bytes - offset));
    hash.update(limited);
    yield limited;
  }
}

function expectedAudio(offset, length) {
  return Buffer.from(
    Array.from({ length }, (_, index) => {
      const position = offset + index;
      return position < waveHeader.length
        ? waveHeader[position]
        : (position * 31 + 17) % 256;
    }),
  );
}

async function verifyPlayback(url) {
  const observed = await page.evaluate(
    (mediaUrl) =>
      new Promise((resolve, reject) => {
        const audio = document.createElement("audio");
        audio.muted = true;
        audio.preload = "auto";
        let finished = false;
        const timer = setTimeout(
          () => finish(new Error("Browser audio playback timed out")),
          20_000,
        );
        function finish(error) {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          const mediaState = {
            duration: audio.duration,
            currentTime: audio.currentTime,
            readyState: audio.readyState,
          };
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
          audio.remove();
          if (error) reject(error);
          else resolve(mediaState);
        }
        audio.addEventListener(
          "error",
          () =>
            finish(new Error(`Browser audio error: ${audio.error?.message}`)),
          { once: true },
        );
        audio.addEventListener("timeupdate", () => {
          if (audio.currentTime > 0.1) finish();
        });
        audio.src = mediaUrl;
        document.body.append(audio);
        audio.play().catch(finish);
      }),
    new URL(url, origin).href,
  );
  assert.ok(Number.isFinite(observed.duration) && observed.duration > 0);
  assert.ok(observed.currentTime > 0.1);
}

async function verifyMedia(url, expectedHash) {
  const head = await request(url, { method: "HEAD" });
  assert.equal(head.status, 200);
  const etag = head.headers.get("ETag");
  assert.ok(etag, "Media must expose its ETag");
  result.audioEtag ??= etag;
  assert.equal(etag, result.audioEtag);
  assert.equal(head.headers.get("Content-Length"), String(sizeBytes));
  assert.equal(head.headers.get("Content-Type"), "audio/wav");
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const full = await request(url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("ETag"), result.audioEtag);
  const hash = createHash("sha256");
  let length = 0;
  for await (const chunk of full.body) {
    hash.update(chunk);
    length += chunk.length;
  }
  assert.equal(length, sizeBytes);
  assert.equal(hash.digest("hex"), expectedHash);
  await Promise.all(
    [
      [1, 32],
      [Math.floor(sizeBytes / 2), Math.floor(sizeBytes / 2) + 32],
      [sizeBytes - 33, sizeBytes - 1],
    ].map(async ([start, end]) => {
      const response = await request(url, {
        headers: { Range: `bytes=${start}-${end}` },
      });
      assert.equal(response.status, 206);
      assert.equal(
        response.headers.get("Content-Range"),
        `bytes ${start}-${end}/${sizeBytes}`,
      );
      assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        expectedAudio(start, end - start + 1),
      );
    }),
  );
  const suffix = await request(url, { headers: { Range: "bytes=-33" } });
  if (
    values.backend === "azurite" &&
    values["allow-azure-suffix-limitation"] &&
    suffix.status === 500
  ) {
    result.limitations ??= [];
    result.limitations.push({
      range: "bytes=-33",
      status: suffix.status,
      response: await suffix.text(),
      description:
        "Known upstream Azure adapter suffix-range limitation; all other checks remain required",
    });
    return;
  }
  assert.equal(suffix.status, 206);
  assert.equal(
    suffix.headers.get("Content-Range"),
    `bytes ${sizeBytes - 33}-${sizeBytes - 1}/${sizeBytes}`,
  );
  assert.deepEqual(
    Buffer.from(await suffix.arrayBuffer()),
    expectedAudio(sizeBytes - 33, 33),
  );
}

async function verifyRestored(track, expectedHash, title) {
  const snapshot = await connect();
  assert.equal(snapshot.tracks.find(({ id }) => id === track.id)?.title, title);
  assert.equal(snapshot.volume, 0.42);
  assert.equal(snapshot.playback.type, "paused");
  assert.equal(snapshot.playback.trackId, track.id);
  assert.equal(snapshot.playback.trackTimeSeconds, 1.25);
  assert.ok(
    (await (await request(routes.home.href())).text()).includes(roomSlug),
  );
  await verifyMedia(track.url, expectedHash);
  await verifyPlayback(track.url);
}

async function connect() {
  return page.evaluate(
    ({ url, clientId }) =>
      new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        globalThis.radioSmokeSocket = socket;
        const timer = setTimeout(
          () => reject(new Error("WebSocket room state timed out")),
          20_000,
        );
        socket.addEventListener("open", () =>
          socket.send(JSON.stringify({ type: "JOIN", clientId })),
        );
        socket.addEventListener("error", () =>
          reject(new Error("WebSocket failed")),
        );
        socket.addEventListener("message", ({ data }) => {
          const frame = JSON.parse(data);
          if (frame.type === "LIVENESS_PING")
            socket.send(JSON.stringify({ type: "LIVENESS_PONG" }));
          if (frame.type === "ROOM_STATE") {
            clearTimeout(timer);
            resolve(frame.snapshot);
          }
          if (frame.type === "ERROR") {
            clearTimeout(timer);
            reject(new Error(frame.message));
          }
        });
      }),
    {
      url:
        origin.replace("http:", "ws:") +
        routes.resources.websocket.href({ roomSlug }),
      clientId: "smoke-listener",
    },
  );
}

async function command(commandMessage, expectedType) {
  return page.evaluate(
    ({ message, expected }) =>
      new Promise((resolve, reject) => {
        const socket = globalThis.radioSmokeSocket;
        const timer = setTimeout(() => {
          socket.removeEventListener("message", received);
          reject(new Error(`Timed out waiting for ${expected}`));
        }, 10_000);
        function received({ data }) {
          const frame = JSON.parse(data);
          if (frame.type !== expected && frame.type !== "ERROR") return;
          clearTimeout(timer);
          socket.removeEventListener("message", received);
          if (frame.type === "ERROR") reject(new Error(frame.message));
          else resolve(frame);
        }
        socket.addEventListener("message", received);
        socket.send(JSON.stringify(message));
      }),
    { message: commandMessage, expected: expectedType },
  );
}
