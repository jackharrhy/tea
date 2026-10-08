import type { Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import type { Cookie } from "remix/cookie";
import type { SessionStorage } from "remix/session";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import type { AppConfig } from "../config.ts";
import type { ContentStore } from "../data/content-store.ts";
import type { GitStore } from "../data/git-store.ts";
import {
  SocketRoom,
  type PeerConnection,
  type PeerIdentity,
} from "./sockets.ts";

export interface AttachSocketsOptions {
  store: ContentStore;
  config: AppConfig;
  gitStore?: GitStore;
  sessionStorage: SessionStorage;
  sessionCookie: Cookie;
}

async function readIdentity(
  header: string,
  cookie: Cookie,
  storage: SessionStorage,
): Promise<PeerIdentity | undefined> {
  const raw = await cookie.parse(header);
  if (!raw) return undefined;
  let id: string;
  try {
    const payload = JSON.parse(raw) as { value?: unknown; expires?: unknown };
    if (
      typeof payload.value !== "string" ||
      typeof payload.expires !== "number" ||
      !Number.isFinite(payload.expires) ||
      payload.expires <= Date.now()
    )
      return undefined;
    id = payload.value;
  } catch {
    return undefined;
  }
  const session = await storage.read(id);
  const saved = session.get("identity") as
    | { name: string; color: string; discordId: string }
    | undefined;
  return saved ? { name: saved.name, color: saved.color } : undefined;
}

function reject(socket: Duplex, status: number, reason: string) {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data);
}

export function attachSockets(
  server: HttpServer,
  options: AttachSocketsOptions,
) {
  const room = new SocketRoom({
    store: options.store,
    gitStore: options.gitStore,
    persistIdleMs: options.config.git?.persistIdleMs,
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024 * 1024,
  });
  void room.rescan().then(
    () =>
      console.info(
        `marky: ${room.filenameToSubdoc.size} markdown files loaded`,
      ),
    (error) => console.error("marky: initial rescan failed:", error),
  );

  server.on("upgrade", async (request, socket, head) => {
    if (request.url !== "/ws") return reject(socket, 404, "Not Found");
    let identity: PeerIdentity | undefined;
    if (options.config.auth.mode === "discord") {
      if (
        request.headers.origin &&
        request.headers.origin !== options.config.auth.baseUrl
      ) {
        return reject(socket, 403, "Forbidden");
      }
      try {
        identity = await readIdentity(
          request.headers.cookie ?? "",
          options.sessionCookie,
          options.sessionStorage,
        );
        if (!identity) return reject(socket, 401, "Unauthorized");
      } catch (error) {
        console.error("marky: ws session read failed", error);
        return reject(socket, 500, "Internal Server Error");
      }
    }
    if (socket.destroyed) return;
    wss.handleUpgrade(request, socket, head, (ws) => {
      const peer: PeerConnection = {
        send(frame) {
          if (ws.readyState === WebSocket.OPEN) ws.send(frame);
        },
        isOpen: () => ws.readyState === WebSocket.OPEN,
      };
      room.addPeer(peer, identity);
      ws.on("message", (data) => {
        void room.receive(peer, toBytes(data)).catch((error) => {
          console.error("marky: error handling ws message:", error);
        });
      });
      ws.on("close", () => room.removePeer(peer));
    });
  });

  const pushIntervalMs = options.config.git?.pushIntervalMs ?? 0;
  if (options.gitStore && pushIntervalMs > 0) {
    const gitStore = options.gitStore;
    room.attachPushTimer(
      setInterval(async () => {
        try {
          if (await gitStore.hasUnpushed()) await gitStore.push();
        } catch (error) {
          console.error("marky: git push failed", error);
        }
      }, pushIntervalMs),
    );
  }

  return {
    room,
    close() {
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
