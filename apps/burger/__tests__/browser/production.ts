import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { chromium, type BrowserContext } from "playwright";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const work = mkdtempSync(join(tmpdir(), "tea-burger-browser-"));
const databasePath = join(work, "burger.sqlite");
copyFileSync(join(appRoot, "__tests__/fixtures/burger.sqlite"), databasePath);

const database = new Database(databasePath);
database.run("UPDATE sessions SET expires_at = ?", [Date.now() + 3_600_000]);
const businessTables = [
  "users",
  "tile_catalog",
  "tiles",
  "tile_edits",
  "settings",
  "palettes",
  "zones",
  "zone_cells",
  "zone_members",
] as const;
const businessRows = () =>
  Object.fromEntries(
    businessTables.map((table) => [
      table,
      database.query(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
const before = businessRows();
let expectedCatalog: unknown = null;
database.close();

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}
async function waitFor(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 20_000;
  while (!(await check())) {
    assert(Date.now() < deadline, `Timed out: ${label}`);
    await Bun.sleep(100);
  }
}

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn("bun", ["dist/server/server.js"], {
  cwd: appRoot,
  env: {
    ...process.env,
    AUTH_CLIENT_ID: "fixture-public-client",
    AUTH_PROJECT_ID: "fixture-project",
    AUTH_ISSUER: "https://auth.jackharrhy.dev",
    BURGER_URL: origin,
    DB_PATH: databasePath,
    WEB_ROOT: "dist/client",
    NODE_ENV: "production",
    PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (chunk) => {
    serverOutput = (serverOutput + String(chunk)).slice(-4000);
  });

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const contexts: BrowserContext[] = [];
let stopError: Error | undefined;
try {
  await waitFor(async () => {
    if (server.exitCode !== null)
      throw new Error(`Burger exited: ${serverOutput}`);
    try {
      return (await fetch(origin)).ok;
    } catch {
      return false;
    }
  }, "Burger Remix server");
  const document = await fetch(origin);
  assert.equal(document.status, 200);
  assert.match(await document.text(), /Burger · Tea/);
  await waitFor(
    async () => (await fetch(`${origin}/assets/game.js`)).ok,
    "Burger static assets",
  );
  for (const path of [
    "/assets/game.js",
    "/assets/burger.css",
    "/assets/atlas.png",
    "/assets/sprites/player.png",
    "/assets/sounds/grilling-meat.mp3",
    "/assets/fonts/ComicSansMS.ttf",
  ]) {
    const response = await fetch(new URL(path, origin));
    assert.equal(response.status, 200, path);
    assert((await response.arrayBuffer()).byteLength > 0, path);
  }
  assert.equal((await fetch(`${origin}/auth/me`)).status, 401);

  browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
    headless: true,
    args: [
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const browserErrors: string[] = [];
  async function player(sessionId: string) {
    const context = await browser!.newContext();
    contexts.push(context);
    await context.addCookies([
      {
        name: "burger_session",
        value: sessionId,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !message.text().startsWith("Failed to load resource:")
      )
        browserErrors.push(message.text());
    });
    const sockets: { url(): string }[] = [];
    page.on("websocket", (socket) => sockets.push(socket));
    await page.goto(origin);
    await page
      .locator("canvas")
      .waitFor({ state: "attached", timeout: 20_000 });
    await page.waitForFunction(
      () =>
        window.context?.me.serverEid != null &&
        window.context?.me.eid != null &&
        window.context?.network.socket?.readyState === WebSocket.OPEN,
    );
    const id = await page.evaluate(() => window.context.me.serverEid!);
    return { context, page, id, sockets };
  }
  const admin = await player("fixture-admin-session");
  const member = await player("fixture-member-session");
  const memberAtlas = await member.context.newPage();
  await memberAtlas.goto(`${origin}/atlas`);
  await memberAtlas
    .getByRole("alert")
    .getByText("An administrator account is required.")
    .waitFor();
  assert.equal(
    await memberAtlas.getByRole("region", { name: "Atlas grid" }).count(),
    0,
  );
  await memberAtlas.close();

  const adminAtlas = await admin.context.newPage();
  await adminAtlas.goto(`${origin}/atlas`);
  await adminAtlas.getByRole("region", { name: "Atlas grid" }).waitFor();
  await adminAtlas.getByRole("button", { name: "wall tile 0, 0" }).click();
  await adminAtlas
    .getByRole("textbox", { name: "Label" })
    .fill("Fixture wall edited");
  await adminAtlas
    .getByRole("button", { name: /Save \(unsaved changes\)/ })
    .click();
  await adminAtlas.getByRole("button", { name: "Save", exact: true }).waitFor();
  const savedCatalog = await adminAtlas.evaluate(async () =>
    (await fetch("/api/catalog")).json(),
  );
  assert.equal(
    savedCatalog.find((entry: { id: number; label: string }) => entry.id === 1)
      ?.label,
    "Fixture wall edited",
  );
  const catalogDb = new Database(databasePath);
  expectedCatalog = catalogDb
    .query("SELECT * FROM tile_catalog ORDER BY rowid")
    .all();
  catalogDb.close();
  await adminAtlas.close();
  await admin.page.getByRole("toolbar", { name: "Burger tools" }).waitFor();
  await admin.page.getByRole("button", { name: "Palette" }).click();
  await admin.page.getByRole("region", { name: "palette tools" }).waitFor();
  assert(
    (await admin.page
      .locator('[aria-label="palette tools"] button[aria-pressed]')
      .count()) >= 3,
  );
  await admin.page.getByRole("button", { name: "Zones" }).click();
  await admin.page.getByRole("button", { name: /Fixture Counter/ }).waitFor();
  await admin.page.getByRole("button", { name: /Fixture Counter/ }).click();
  await admin.page.getByRole("button", { name: "Zone brush [Z]" }).click();
  assert.equal(
    await admin.page.evaluate(() => window.context.zones.active),
    true,
  );
  await admin.page.getByRole("button", { name: "Bots" }).click();
  await admin.page.getByText("Active bots:").waitFor();
  await admin.page.getByRole("button", { name: "Spawn", exact: true }).click();
  await admin.page.getByRole("button", { name: "Save spawn" }).waitFor();
  await member.page.getByRole("button", { name: "Paint [E]" }).waitFor();
  assert.equal(
    await member.page.getByRole("button", { name: "Zones" }).count(),
    0,
  );
  assert.equal(
    await member.page.getByRole("button", { name: "Paint [E]" }).isEnabled(),
    true,
  );
  await member.page.getByRole("button", { name: "Paint [E]" }).click();
  assert.equal(
    await member.page.evaluate(() => window.context.editor?.active),
    true,
  );
  await member.page.getByRole("button", { name: "Paint [E]" }).click();
  assert.equal(
    await member.page.evaluate(() => window.context.editor?.active),
    false,
  );
  await member.page.waitForFunction(
    (id) => window.context?.network.idMap.has(id),
    admin.id,
  );
  const beforeMove = await member.page.evaluate((id) => {
    const game = window.context;
    return game.world.components.Position.x[game.network.idMap.get(id)!];
  }, admin.id);
  await admin.page.keyboard.down("d");
  await admin.page.waitForTimeout(900);
  await admin.page.keyboard.up("d");
  await member.page.waitForFunction(
    ({ id, x }) => {
      const game = window.context;
      const entity = game?.network.idMap.get(id);
      return (
        entity !== undefined && game.world.components.Position.x[entity] > x + 1
      );
    },
    { id: admin.id, x: beforeMove },
  );

  await admin.page.goto("about:blank");
  await member.page.waitForFunction(
    (id) => !window.context?.network.idMap.has(id),
    admin.id,
  );
  await admin.page.goto(origin);
  await admin.page
    .locator("canvas")
    .waitFor({ state: "attached", timeout: 20_000 });
  await admin.page.waitForFunction(
    () => window.context?.network.socket?.readyState === WebSocket.OPEN,
  );
  assert.equal(await admin.page.locator("canvas").count(), 1);
  assert.equal(
    admin.sockets.filter((socket) => new URL(socket.url()).pathname === "/ws")
      .length,
    2,
  );
  await member.context.close();
  await admin.page.waitForFunction(
    (id) => !window.context?.network.idMap.has(id),
    member.id,
  );
  assert.deepEqual(browserErrors, []);
  console.log(
    "Burger browser smoke passed: Remix/Pixi mount, assets, two sessions, atlas admin edit/member denial, movement, navigation and disconnect.",
  );
} finally {
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    const exited = new Promise<void>((done) =>
      server.once("exit", () => done()),
    );
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<void>((_, reject) => {
      timer = setTimeout(() => {
        const phases = serverOutput
          .split("\n")
          .filter((line) => line.includes("Burger shutdown"));
        reject(
          new Error(
            `Burger did not stop within 3 seconds of SIGTERM: ${phases.join(" | ")}`,
          ),
        );
      }, 3000);
    });
    try {
      await Promise.race([exited, timeout]);
      assert.equal(server.exitCode, 0, `Burger shutdown: ${serverOutput}`);
    } catch (error) {
      stopError = error as Error;
      if (server.exitCode === null) {
        server.kill("SIGKILL");
        await exited;
      }
    } finally {
      clearTimeout(timer!);
    }
  }
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close();
  const afterDb = new Database(databasePath);
  assert.deepEqual(
    Object.fromEntries(
      businessTables.map((table) => [
        table,
        afterDb.query(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ]),
    ),
    {
      ...before,
      ...(expectedCatalog ? { tile_catalog: expectedCatalog } : {}),
    },
  );
  assert.deepEqual(afterDb.query("PRAGMA foreign_key_check").all(), []);
  assert.equal(
    (
      afterDb.query("PRAGMA integrity_check").get() as {
        integrity_check: string;
      }
    ).integrity_check,
    "ok",
  );
  afterDb.close();
  rmSync(work, { recursive: true, force: true });
}
if (stopError) throw stopError;
