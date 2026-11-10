import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROTOCOL_VERSION,
  decodeServerControl,
  type WelcomeMessage,
} from "@tea/gurgur-engine";
import { createGurgurServer } from "../server/src/server";

const cycles = Number(process.env.CONNECTION_SOAK_CYCLES ?? 1_000);
if (!Number.isInteger(cycles) || cycles < 1)
  throw new Error("CONNECTION_SOAK_CYCLES must be a positive integer");
const directory = await mkdtemp(join(tmpdir(), "gurgur-connection-soak-"));
const adminToken = "connection-soak-admin-token";
const server = await createGurgurServer({
  port: 0,
  hostname: "127.0.0.1",
  databasePath: join(directory, "world.sqlite"),
  adminToken,
});
const startedAt = performance.now();
let sessionToken: string | null = null;
let playerIdentity: string | null = null;
let mapRevision: string | null = null;
let worldEpoch: number | null = null;
let socket: WebSocket | null = null;
try {
  for (let generation = 0; generation < cycles; generation += 1) {
    const next = new WebSocket(`ws://127.0.0.1:${server.port}/game`);
    const welcome = await connect(next, {
      sessionToken,
      socketGeneration: generation,
      mapRevision,
      worldEpoch,
    });
    const identity = `${welcome.playerId.index}:${welcome.playerId.generation}`;
    if (playerIdentity !== null && identity !== playerIdentity)
      throw new Error(`player identity changed at cycle ${generation}`);
    playerIdentity = identity;
    sessionToken = welcome.sessionToken;
    mapRevision = welcome.mapRevision;
    worldEpoch = welcome.worldEpoch;
    if (socket) await waitForClose(socket, 4001);
    socket = next;
    if ((generation + 1) % 250 === 0 && generation + 1 < cycles) {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/admin/reset`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${adminToken}` },
        },
      );
      if (!response.ok) throw new Error(`reset failed at cycle ${generation}`);
      const snapshot = (await response.json()) as { worldEpoch: number };
      worldEpoch = snapshot.worldEpoch;
    }
  }
  const report = {
    reportVersion: 1,
    cycles,
    playerIdentity,
    finalWorldEpoch: worldEpoch,
    elapsedMs: performance.now() - startedAt,
    server: server.metrics(),
    memory: process.memoryUsage(),
  };
  await mkdir("reports/soak", { recursive: true });
  await Bun.write(
    "reports/soak/connections.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report));
} finally {
  socket?.close();
  server.stop();
  await rm(directory, { recursive: true, force: true });
}

function connect(
  clientSocket: WebSocket,
  options: {
    sessionToken: string | null;
    socketGeneration: number;
    mapRevision: string | null;
    worldEpoch: number | null;
  },
): Promise<WelcomeMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("connection soak handshake timed out")),
      3_000,
    );
    clientSocket.addEventListener(
      "open",
      () =>
        clientSocket.send(
          JSON.stringify({
            type: "hello",
            protocolVersion: PROTOCOL_VERSION,
            ...options,
          }),
        ),
      { once: true },
    );
    clientSocket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const message = decodeServerControl(event.data);
      if (message.type !== "welcome") return;
      clearTimeout(timeout);
      resolve(message);
    });
    clientSocket.addEventListener(
      "error",
      () => reject(new Error("connection soak websocket failed")),
      {
        once: true,
      },
    );
  });
}

function waitForClose(
  clientSocket: WebSocket,
  expectedCode: number,
): Promise<void> {
  if (clientSocket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("replaced socket did not close")),
      3_000,
    );
    clientSocket.addEventListener(
      "close",
      (event) => {
        clearTimeout(timeout);
        if (event.code !== expectedCode)
          reject(new Error(`replaced socket closed with ${event.code}`));
        else resolve();
      },
      { once: true },
    );
  });
}
