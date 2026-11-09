/**
 * CLIENT-SIDE PREDICTION
 * - The client immediately applies input locally
 * - Input commands are stored in a buffer
 *
 * SERVER AUTHORITY
 * - The server is the single source of truth.
 * - It processes client inputs, runs physics,
 *   and broadcasts authoritative state at (TICK_RATE)Hz.
 *
 * RECONCILIATION
 * When server state arrives, the client:
 * - Discards acknowledged inputs
 * - Resets to server position
 * - Replays unacknowledged inputs at the dt each was originally predicted
 *   with (cmd.msec). The server applies the same cmd.msec server-side
 *   (clamped to MAX_INPUT_MSEC), so client prediction and server
 *   simulation agree on motion-per-input regardless of frame rate.
 * - Smooths any prediction error over time
 *
 * INTERPOLATION
 * Remote players are rendered with a delay (INTERP_DELAY), interpolating
 * between received snapshots for smooth movement. When data runs out,
 * we extrapolate using velocity.
 *
 * Message Flow:
 *   Client -> Server: INPUT (input commands at (CLIENT_UPDATE_RATE)Hz
 *   Server -> Client: YOUR_EID  (on connect, [PROTOCOL_VERSION, eid,
 *                                bounds.x, bounds.y, bounds.w, bounds.h];
 *                                client populates world.bounds and
 *                                disconnects on version mismatch)
 *   Server -> Client: SNAPSHOT (initial world state, includes SoA data)
 *   Server -> Client: OBSERVER (entity add/remove deltas, no field data)
 *   Server -> Client: SOA      (field-data delta following OBSERVER adds —
 *                                bitecs's observer stream is purely
 *                                structural, so we follow up with SoA to
 *                                send the actual values)
 *   Server -> Client: GAME_STATE (authoritative positions at (TICK_RATE)Hz)
 */

import {
  MESSAGE_TYPES,
  networkedComponents,
  applyInputToVelocity,
  moveAndSlide,
  type InputCmd,
  type GameStateMessage,
  CLIENT_UPDATE_RATE,
  PROTOCOL_VERSION,
} from "@tea/burger-core";
import {
  createObserverDeserializer,
  createSnapshotDeserializer,
  createSoADeserializer,
} from "bitecs/serialization";
import debugFactory from "debug";
import { INTERP_HISTORY_MS, TELEPORT_THRESHOLD } from "./consts";
import { refetchZones, useGameStore } from "../store";
import type { World } from "./";

const debug = debugFactory("burger:network.client");

export type PositionSnapshot = { x: number; y: number; time: number };

export type NetworkState = {
  socket: WebSocket | null;
  inputSeq: number;
  lastSentSeq: number;
  pendingInputs: InputCmd[];
  predictionError: { x: number; y: number };
  idMap: Map<number, number>; // Server EID -> Client EID
  bytesSent: number;
  bytesReceived: number;
  lagMs: number;
  jitterMs: number;
  onCatalogUpdated?: (
    catalog: Array<{
      id: number;
      type: string;
      src_x: number;
      src_y: number;
      label: string;
    }>,
  ) => void;
};

export type PlayerIdentity = {
  eid: number | null; // Client-side EID (after mapping)
  serverEid: number | null; // Server-side EID (before mapping)
};

export const setupSocket = ({
  world,
  network,
  me,
  onLocalPlayerReady,
  onSnapshotReceived,
  onSocketClose,
  context,
}: {
  world: World;
  network: NetworkState;
  me: PlayerIdentity;
  onLocalPlayerReady: () => void;
  onSnapshotReceived: () => void;
  onSocketClose?: () => void;
  // Narrow slice of the game Context that this socket setup needs. Avoids a
  // circular dep between network.ts and the full Context type in index.ts.
  context: { metrics: { serverTicksCount: number } };
}): void => {
  const { Networked } = world.components;
  const { idMap } = network;

  const snapshotDeserializer = createSnapshotDeserializer(
    world,
    networkedComponents,
  );
  const observerDeserializer = createObserverDeserializer(
    world,
    Networked,
    networkedComponents,
  );
  const soaDeserializer = createSoADeserializer(networkedComponents);

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  socket.binaryType = "arraybuffer";
  network.socket = socket;

  socket.addEventListener("open", () => {
    console.log("connected to server");
  });

  socket.addEventListener("message", (event) => {
    network.bytesReceived += event.data.byteLength;

    const delay = network.lagMs + Math.random() * network.jitterMs;
    setTimeout(() => {
      const messageView = new Uint8Array(event.data);
      const type = messageView[0];
      const payload = messageView.slice(1).buffer;

      switch (type) {
        case MESSAGE_TYPES.SNAPSHOT:
          snapshotDeserializer(payload, idMap);
          tryMapLocalPlayer(me, idMap, onLocalPlayerReady);
          onSnapshotReceived();
          break;

        case MESSAGE_TYPES.OBSERVER:
          debug("observer delta: %d bytes", payload.byteLength);
          observerDeserializer(payload, idMap);
          tryMapLocalPlayer(me, idMap, onLocalPlayerReady);
          break;

        case MESSAGE_TYPES.SOA:
          // Field-data delta following an OBSERVER add. The observer
          // announces structural changes (entity / component add/remove)
          // but doesn't carry field values. The SoA payload fills them in.
          debug("soa delta: %d bytes", payload.byteLength);
          soaDeserializer(payload, idMap);
          break;

        case MESSAGE_TYPES.GAME_STATE: {
          const decoder = new TextDecoder();
          const json = decoder.decode(payload);
          const gameState = JSON.parse(json);
          reconcile(world, network, me, gameState);
          context.metrics.serverTicksCount++;
          break;
        }

        case MESSAGE_TYPES.YOUR_EID: {
          const view = new Int32Array(payload);
          const version = view[0];
          if (version !== PROTOCOL_VERSION) {
            console.error(
              `Protocol version mismatch: server=${version} client=${PROTOCOL_VERSION}`,
            );
            network.socket?.close();
            return;
          }
          me.serverEid = view[1]!;
          world.bounds = {
            x: view[2]!,
            y: view[3]!,
            w: view[4]!,
            h: view[5]!,
          };
          break;
        }

        case MESSAGE_TYPES.CATALOG_UPDATED: {
          debug("catalog_updated received: %d bytes", payload.byteLength);
          const decoder = new TextDecoder();
          const json = decoder.decode(payload);
          const catalog = JSON.parse(json) as Array<{
            id: number;
            type: string;
            src_x: number;
            src_y: number;
            label: string;
          }>;
          network.onCatalogUpdated?.(catalog);
          break;
        }

        case MESSAGE_TYPES.ZONES_UPDATED: {
          // Admin-only signal. The server only broadcasts this to admin
          // connections, so no extra client-side gate is needed here.
          // Errors are swallowed so a transient fetch failure doesn't crash
          // the WS handler — the next ZONES_UPDATED retries.
          debug("zones_updated received");
          refetchZones().catch((err: unknown) => {
            console.error("refetchZones failed", err);
          });
          break;
        }

        case MESSAGE_TYPES.MY_ZONES: {
          // Per-user payload: the flat union of cells the user is allowed
          // to paint. Sent on connect (non-admins) and whenever their
          // membership or any of their zones' cells change.
          const decoder = new TextDecoder();
          const json = decoder.decode(payload);
          const parsed = JSON.parse(json) as { cells: [number, number][] };
          useGameStore.getState().setMyZoneCells(parsed.cells);
          break;
        }
      }
    }, delay);
  });

  socket.addEventListener("close", () => {
    console.log("disconnected from server");
    network.socket = null;
    onSocketClose?.();
  });

  socket.addEventListener("error", (error) => {
    console.error("WebSocket error:", error);
  });
};

export const sendPaint = (
  network: NetworkState,
  x: number,
  y: number,
  tileId: number | null,
): void => {
  const { socket } = network;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const msg = JSON.stringify({ type: "paint", x, y, tileId });
  socket.send(msg);
  network.bytesSent += msg.length;
};

const tryMapLocalPlayer = (
  me: PlayerIdentity,
  idMap: Map<number, number>,
  onReady: () => void,
): void => {
  if (me.serverEid !== null && me.eid === null) {
    const clientEid = idMap.get(me.serverEid);
    if (clientEid !== undefined) {
      me.eid = clientEid;
      onReady();
    }
  }
};

let lastSendTime = 0;

export const sendInputs = (
  network: NetworkState,
  meEid: number | null,
  metrics?: { updatesCount: number },
): void => {
  const now = performance.now();
  if (now - lastSendTime < CLIENT_UPDATE_RATE) return;
  lastSendTime = now;

  const { socket, pendingInputs, lastSentSeq } = network;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  if (meEid === null) return;

  const unsentInputs = pendingInputs.filter((cmd) => cmd.seq > lastSentSeq);
  if (unsentInputs.length === 0) return;

  for (const cmd of unsentInputs) {
    const msg = JSON.stringify({
      type: "input",
      seq: cmd.seq,
      msec: cmd.msec,
      up: cmd.up,
      down: cmd.down,
      left: cmd.left,
      right: cmd.right,
      interact: cmd.interact,
    });
    const delay = network.lagMs + Math.random() * network.jitterMs;
    setTimeout(() => {
      network.bytesSent += msg.length;
      socket.send(msg);
    }, delay);
  }

  network.lastSentSeq = unsentInputs[unsentInputs.length - 1]!.seq;
  if (metrics) metrics.updatesCount++;
};

export const reconcile = (
  world: World,
  network: NetworkState,
  me: PlayerIdentity,
  serverState: GameStateMessage,
): void => {
  const { Position, Velocity, PositionHistory } = world.components;
  const { idMap, pendingInputs, predictionError } = network;

  for (const playerState of serverState.players) {
    const serverEid = playerState.eid;
    const eid = idMap.get(serverEid);
    if (eid === undefined) continue;

    const isLocalPlayer = serverEid === me.serverEid;

    if (isLocalPlayer && me.eid !== null) {
      const predictedX = Position.x[eid]!;
      const predictedY = Position.y[eid]!;

      while (
        pendingInputs.length > 0 &&
        pendingInputs[0]!.seq <= playerState.lastInputSeq
      ) {
        pendingInputs.shift();
      }

      Position.x[eid] = playerState.x;
      Position.y[eid] = playerState.y;
      Velocity.x[eid] = playerState.vx;
      Velocity.y[eid] = playerState.vy;

      for (const cmd of pendingInputs) {
        // Replay each unacked input at the same dt the client originally
        // predicted with — and the same dt the server (will / already did)
        // applied. cmd.msec is bounded by MAX_INPUT_MSEC server-side, so
        // malicious local replay can't desync further than the server-side
        // clamp would allow.
        const newVel = applyInputToVelocity(
          Velocity.x[eid]!,
          Velocity.y[eid]!,
          cmd,
          cmd.msec,
        );
        Velocity.x[eid] = newVel.vx;
        Velocity.y[eid] = newVel.vy;

        const newPos = moveAndSlide(
          world,
          Position.x[eid]!,
          Position.y[eid]!,
          Velocity.x[eid]!,
          Velocity.y[eid]!,
          cmd.msec,
        );
        Position.x[eid] = newPos.x;
        Position.y[eid] = newPos.y;
      }

      const errorX = predictedX - Position.x[eid]!;
      const errorY = predictedY - Position.y[eid]!;
      const errorLen = Math.abs(errorX) + Math.abs(errorY);

      if (errorLen > TELEPORT_THRESHOLD) {
        predictionError.x = 0;
        predictionError.y = 0;
      } else {
        predictionError.x = errorX;
        predictionError.y = errorY;
      }
    } else {
      Position.x[eid] = playerState.x;
      Position.y[eid] = playerState.y;
      Velocity.x[eid] = playerState.vx;
      Velocity.y[eid] = playerState.vy;

      const history = PositionHistory[eid];
      if (history) {
        const now = performance.now();
        history.push({ x: playerState.x, y: playerState.y, time: now });

        const cutoffTime = now - INTERP_HISTORY_MS;
        while (history.length > 2 && history[0]!.time < cutoffTime) {
          history.shift();
        }
      }
    }
  }
};
