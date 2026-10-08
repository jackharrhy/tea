import * as assert from "remix/assert";
import { it } from "remix/test";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { createCookie } from "remix/cookie";
import { createMemorySessionStorage } from "remix/session-storage/memory";
import WebSocket from "ws";

import { loadConfig } from "../app/config.ts";
import { ContentStore } from "../app/data/content-store.ts";
import { attachSockets } from "../app/middleware/websocket-server.ts";

it("requires a live signed Discord session for WebSocket upgrades", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tea-marky-ws-"));
  const store = new ContentStore({ dir });
  await store.ensureDir();
  const cookie = createCookie("marky.session", {
    secrets: ["test-secret"],
    maxAge: 60,
  });
  const storage = createMemorySessionStorage();
  const config = loadConfig({
    MARKY_AUTH: "discord",
    DISCORD_CLIENT_ID: "id",
    DISCORD_CLIENT_SECRET: "secret",
    DISCORD_GUILD_ID: "guild",
    SESSION_SECRET: "test-secret",
    MARKY_BASE_URL: "http://localhost",
  });
  const server = http.createServer((_request, response) => response.end());
  const sockets = attachSockets(server, {
    store,
    config,
    sessionCookie: cookie,
    sessionStorage: storage,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const url = `ws://127.0.0.1:${address.port}/ws`;
  async function status(cookieHeader?: string, origin = "http://localhost") {
    return new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(url, {
        origin,
        headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      });
      ws.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      ws.once("open", () => {
        ws.close();
        resolve(101);
      });
      ws.once("error", reject);
    });
  }
  try {
    assert.equal(await status(), 401);
    const session = await storage.read(null);
    session.set("identity", { discordId: "1", name: "Jack", color: "#123456" });
    const id = await storage.save(session);
    assert.ok(id);
    const live = await cookie.serialize(
      JSON.stringify({ value: id, expires: Date.now() + 60_000 }),
    );
    assert.equal(await status(live), 101);
    assert.equal(await status(live, "https://attacker.example"), 403);
    const expired = await cookie.serialize(
      JSON.stringify({ value: id, expires: Date.now() - 1 }),
    );
    assert.equal(await status(expired), 401);
  } finally {
    sockets.close();
    await sockets.room.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
