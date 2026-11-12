import { Database } from "bun:sqlite";
import type { ServerWebSocket } from "bun";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { router } from "../app/router";
import { staticFiles } from "./static-files";
import {
  MAX_POOL_TRACE_MESSAGE_LENGTH,
  MAX_CLIENT_MESSAGE_LENGTH,
  parseClientMessage,
} from "@harrhy/pool-protocol";
import { Hall } from "./hall";
import { createUpdateControl } from "./update-control";
import { GameRecorder } from "./recordings";
import { createAuth } from "./auth";
import { createAdmin } from "./admin";
import { database, matches, migrateDatabase } from "./db";
const dataDir = process.env.DATA_DIR ?? "data";
mkdirSync(dataDir, { recursive: true });
const db = new Database(resolve(dataDir, "8ball.sqlite"), { create: true });
const serveStatic =
  process.env.NODE_ENV === "production"
    ? staticFiles(process.env.WEB_ROOT ?? resolve(process.cwd(), "dist/client"))
    : null;
db.exec("PRAGMA journal_mode=WAL");
migrateDatabase(db);
const store = database(db);
const recorder =
  process.env.POOL_RECORDINGS === "0"
    ? undefined
    : new GameRecorder(db, {
        revision: process.env.APP_REVISION,
      });
const hall = new Hall(
  (table, winner, players) =>
    store
      .insert(matches)
      .values({
        tableId: table,
        winner,
        players: JSON.stringify(players),
        finishedAt: Date.now(),
      })
      .run(),
  recorder,
);
const auth = createAuth();
const admin = createAdmin(hall, recorder, auth);
type SocketData = {
  id: string | null;
  watch: boolean;
  window: number;
  count: number;
  connected: number;
  traceAt: number;
};
const updateControl = createUpdateControl(hall);
let connections = 0;
const pending = new Set<ServerWebSocket<SocketData>>();
const watchers = new Set<ServerWebSocket<SocketData>>();
const server = Bun.serve<SocketData>({
  hostname: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.API_PORT ?? 3188),
  async fetch(req, bunServer) {
    const url = new URL(req.url);
    if (url.pathname === "/api/health")
      return Response.json({
        status: "ok",
        players: hall.guests.size,
        uptime: Math.floor(process.uptime()),
      });
    const authResponse = await auth.handle(req);
    if (authResponse) return authResponse;
    const adminResponse = await admin.handle(req);
    if (adminResponse) return adminResponse;
    if (url.pathname !== "/ws")
      return serveStatic?.(req, url.pathname) ?? router.fetch(req);
    const origin = req.headers.get("origin");
    if (
      origin &&
      origin !== (process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:3188")
    )
      return new Response("Origin not allowed", { status: 403 });
    if (connections >= 80) return new Response("Hall busy", { status: 503 });
    if (
      bunServer.upgrade(req, {
        data: {
          id: null,
          watch: url.searchParams.get("watch") === "1",
          window: Date.now(),
          count: 0,
          connected: Date.now(),
          traceAt: -Infinity,
        },
      })
    )
      return;
    return new Response("WebSocket required", { status: 426 });
  },
  websocket: {
    maxPayloadLength: MAX_POOL_TRACE_MESSAGE_LENGTH,
    idleTimeout: 30,
    sendPings: true,
    backpressureLimit: 512_000,
    closeOnBackpressureLimit: true,
    open(ws) {
      if (++connections > 80) {
        ws.close(1013, "Hall busy");
        return;
      }
      if (ws.data.watch) {
        watchers.add(ws);
        hall.send(ws, hall.snapshot());
      } else pending.add(ws);
    },
    message(ws, raw) {
      if (ws.data.watch) {
        ws.close(1008, "Join to interact with the hall");
        return;
      }
      const now = Date.now();
      if (!ws.data.id && now - ws.data.connected >= 5000) {
        ws.close(1008, "Join timed out");
        return;
      }
      if (now - ws.data.window > 1000) {
        ws.data.window = now;
        ws.data.count = 0;
      }
      if (++ws.data.count > 65) {
        ws.close(1008, "Too many messages");
        return;
      }
      if (typeof raw !== "string") {
        ws.close(1003, "Text messages required");
        return;
      }
      if (raw.length > MAX_CLIENT_MESSAGE_LENGTH) {
        if (!ws.data.id || now - ws.data.traceAt < 30_000) return;
        ws.data.traceAt = now;
      }
      const message = parseClientMessage(raw);
      if (!message) {
        hall.error(ws, "Invalid message. Refresh if this keeps happening.");
        return;
      }
      if (!ws.data.id) {
        if (message.type !== "hello") {
          ws.close(1008, "Join first");
          return;
        }
        ws.data.id = hall.connect(
          ws,
          message.name,
          message.token,
          message.color,
        );
        pending.delete(ws);
        return;
      }
      hall.handle(ws.data.id, ws, message, now);
    },
    close(ws) {
      pending.delete(ws);
      watchers.delete(ws);
      connections--;
      if (ws.data.id) hall.disconnect(ws.data.id, ws);
    },
  },
});
let previous = performance.now(),
  accumulator = 0,
  frames = 0;
const timer = setInterval(() => {
  const wallTime = Date.now();
  for (const ws of pending) {
    if (wallTime - ws.data.connected >= 5000) {
      pending.delete(ws);
      ws.close(1008, "Join timed out");
    }
  }
  const now = performance.now();
  accumulator += Math.min((now - previous) / 1000, 0.2);
  previous = now;
  while (accumulator >= 1 / 60) {
    hall.update(1 / 60);
    accumulator -= 1 / 60;
    frames++;
    if (frames % 2 === 0) {
      const snapshot = hall.snapshot();
      hall.broadcast(snapshot);
      for (const ws of watchers) hall.send(ws, snapshot);
    }
  }
}, 1000 / 60);
console.log(`8ball server listening on ${server.hostname}:${server.port}`);
console.log(
  `8ball update control listening on ${updateControl.hostname}:${updateControl.port}`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    clearInterval(timer);
    server.stop(true);
    updateControl.stop(true);
    hall.dispose();
    db.close();
    process.exit(0);
  });
