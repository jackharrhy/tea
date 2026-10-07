import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values } = parseArgs({
  options: { output: { type: "string" } },
});
const settings = [
  {
    label: "source",
    prefix: "RADIO_SOURCE",
    url: process.env.RADIO_SOURCE_URL,
    password: process.env.RADIO_SOURCE_PASSWORD,
  },
  {
    label: "Tea",
    prefix: "RADIO_TEA",
    url: process.env.RADIO_TEA_URL,
    password: process.env.RADIO_TEA_PASSWORD,
  },
];
for (const setting of settings) {
  if (!setting.url || !setting.password)
    throw new Error(`Set ${setting.prefix}_URL and ${setting.prefix}_PASSWORD`);
  const url = new URL(setting.url);
  assert.equal(url.pathname, "/", `${setting.prefix}_URL must be an origin`);
  assert.equal(url.search, "", `${setting.prefix}_URL must be an origin`);
  setting.url = url.origin;
}
assert.notEqual(
  settings[0].url,
  settings[1].url,
  "Compare two distinct origins",
);

async function openInstance(browser, setting) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(setting.url);
  const rooms = await page
    .locator('form[aria-label="Rooms"] button[name="room"]')
    .evaluateAll((buttons) =>
      buttons.map((button) => ({
        slug: button.value,
        name: button.textContent.trim(),
      })),
    );
  assert.ok(rooms.length, `${setting.label} has no rooms to compare`);
  rooms.sort((left, right) => left.slug.localeCompare(right.slug));
  assert.equal(new Set(rooms.map((room) => room.slug)).size, rooms.length);
  await page
    .locator('form[action="/join"] input[name="name"]')
    .fill("Transfer audit");
  await page
    .locator('form[action="/join"] input[name="password"]')
    .fill(setting.password);
  await Promise.all([
    page.waitForURL(/\/rooms\//u),
    page.locator('form[action="/join"] button[type="submit"]').click(),
  ]);
  const cookies = await context.cookies(setting.url);
  assert.ok(cookies.length, `${setting.label} did not issue a session cookie`);
  return {
    ...setting,
    context,
    page,
    rooms,
    cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; "),
  };
}

async function roomSnapshot(instance, slug) {
  await instance.page.goto(
    new URL(`/rooms/${encodeURIComponent(slug)}`, instance.url).toString(),
  );
  return instance.page.evaluate(
    (roomSlug) =>
      new Promise((resolve, reject) => {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(
          `${protocol}//${location.host}/ws/${encodeURIComponent(roomSlug)}`,
        );
        const timer = setTimeout(
          () => finish(new Error("Room state timed out")),
          20_000,
        );
        function finish(error, snapshot) {
          clearTimeout(timer);
          socket.close();
          if (error) reject(error);
          else resolve(snapshot);
        }
        socket.addEventListener("open", () =>
          socket.send(
            JSON.stringify({ type: "JOIN", clientId: "tea-transfer-audit" }),
          ),
        );
        socket.addEventListener("error", () =>
          finish(new Error("Room WebSocket failed")),
        );
        socket.addEventListener("message", ({ data }) => {
          const frame = JSON.parse(data);
          if (frame.type === "LIVENESS_PING")
            socket.send(JSON.stringify({ type: "LIVENESS_PONG" }));
          if (frame.type === "ERROR") finish(new Error(frame.message));
          if (frame.type === "ROOM_STATE") finish(null, frame.snapshot);
        });
      }),
    slug,
  );
}

function stableRoom(snapshot) {
  assert.equal(
    snapshot.playback.type,
    "paused",
    `Pause ${snapshot.roomId} before comparing instances`,
  );
  return {
    roomId: snapshot.roomId,
    tracks: snapshot.tracks,
    playback: {
      type: snapshot.playback.type,
      trackId: snapshot.playback.trackId,
      trackTimeSeconds: snapshot.playback.trackTimeSeconds,
    },
    volume: snapshot.volume,
  };
}

async function requestMedia(instance, path, init = {}) {
  const url = new URL(path, instance.url);
  assert.equal(
    url.origin,
    instance.url,
    "Media URL must stay on the Radio origin",
  );
  return fetch(url, {
    ...init,
    headers: { Cookie: instance.cookie, ...init.headers },
    signal: AbortSignal.timeout(30 * 60_000),
  });
}

async function mediaFingerprint(instance, track) {
  if (track.upload)
    throw new Error(`Track ${track.id} is still uploading or failed`);
  const head = await requestMedia(instance, track.url, { method: "HEAD" });
  assert.equal(head.status, 200, `${instance.label} HEAD ${track.url}`);
  const response = await requestMedia(instance, track.url);
  assert.equal(response.status, 200, `${instance.label} GET ${track.url}`);
  assert.ok(
    response.body,
    `${instance.label} returned no body for ${track.url}`,
  );
  const digest = createHash("sha256");
  let size = 0;
  let tail = Buffer.alloc(0);
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    digest.update(bytes);
    size += bytes.length;
    tail =
      bytes.length >= 33
        ? bytes.subarray(-33)
        : Buffer.concat([tail, bytes]).subarray(-33);
  }
  assert.equal(
    head.headers.get("content-length"),
    String(size),
    `${instance.label} media size for ${track.id}`,
  );
  assert.ok(size > 0, `${instance.label} media ${track.id} is empty`);
  const suffix = await requestMedia(instance, track.url, {
    headers: { Range: `bytes=-${Math.min(size, 33)}` },
  });
  assert.equal(
    suffix.status,
    206,
    `${instance.label} suffix range for ${track.id}`,
  );
  assert.deepEqual(
    Buffer.from(await suffix.arrayBuffer()),
    tail,
    `${instance.label} suffix bytes for ${track.id}`,
  );
  return {
    size,
    mediaType: head.headers.get("content-type"),
    sha256: digest.digest("hex"),
  };
}

const browser = await chromium.launch({ headless: true });
try {
  const [source, tea] = await Promise.all(
    settings.map((setting) => openInstance(browser, setting)),
  );
  assert.deepEqual(tea.rooms, source.rooms, "Room directory differs");
  const media = [];
  const roomStates = [];
  for (const room of source.rooms) {
    const [sourceRoom, teaRoom] = await Promise.all([
      roomSnapshot(source, room.slug),
      roomSnapshot(tea, room.slug),
    ]);
    const sourceState = stableRoom(sourceRoom);
    assert.deepEqual(
      stableRoom(teaRoom),
      sourceState,
      `Room ${room.slug} differs`,
    );
    roomStates.push({ name: room.name, ...sourceState });
    for (const track of sourceRoom.tracks) {
      const [sourceMedia, teaMedia] = await Promise.all([
        mediaFingerprint(source, track),
        mediaFingerprint(tea, track),
      ]);
      assert.deepEqual(
        teaMedia,
        sourceMedia,
        `Media ${room.slug}/${track.id} differs`,
      );
      media.push({ room: room.slug, track: track.id, ...sourceMedia });
    }
  }
  const report = {
    status: "matched",
    checkedAt: new Date().toISOString(),
    source: source.url,
    tea: tea.url,
    rooms: source.rooms.length,
    tracks: media.length,
    bytes: media.reduce((total, item) => total + item.size, 0),
    directory: source.rooms,
    roomStates,
    media,
  };
  if (values.output)
    await writeFile(values.output, JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  console.log(
    JSON.stringify({
      status: report.status,
      rooms: report.rooms,
      tracks: report.tracks,
      bytes: report.bytes,
    }),
  );
} finally {
  await browser.close();
}
