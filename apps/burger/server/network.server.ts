/**
 * Authoritative server model — see app.ts for the route construction.
 *
 * This module owns the per-tick simulation state and serializers:
 * - playerConnections, observerSerializers, dirtyEids
 * - snapshotSerializer / soaSerializer (lazily initialised by createServer)
 * - per-tick helpers: processPlayerInputs, broadcastGameState
 * - per-paint helpers: markEntityDirty, applyPaint dispatch
 *
 * The Elysia route chain is built by app.ts and consumes the helpers
 * exported here.
 */

import { existsSync, mkdirSync } from "node:fs";
import type { Database } from "bun:sqlite";
import {
  MAX_INPUTS_PER_TICK,
  MAX_PAINTS_PER_TICK,
  MESSAGE_TYPES,
  networkedComponents,
  type InputCmd,
  type GameStateMessage,
  type PlayerState,
} from "@tea/burger-core";
import {
  createSnapshotSerializer,
  createSoASerializer,
} from "bitecs/serialization";
import type { World } from "./world";
import debugFactory from "debug";
import type { ServerWebSocket } from "elysia/ws/bun";
import type { TSchema } from "elysia";
import type { TypeCheck } from "elysia/type-system";
import { validateInput } from "./input-validation";
import { validatePaint } from "./paint-validation";
import { applyPaint } from "./paint";
import { buildApp, type AppDeps } from "./app";
import { canPaint } from "./zones";

const debug = debugFactory("burger:network.server");

export type PlayerConnection = {
  eid: number;
  inputQueue: InputCmd[];
  lastAckedSeq: number;
  lastReceivedSeq: number;
  userId: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  paintsThisTick: number;
};

type WS = ServerWebSocket<{
  id?: string | undefined;
  validator?: TypeCheck<TSchema> | undefined;
}>;

const playerConnections = new Map<WS, PlayerConnection>();
const observerSerializers = new Map<WS, () => ArrayBuffer>();
// Reverse lookup so zone broadcasts can target a specific user without
// scanning every connection. Populated on register, cleared on unregister.
const userIdToWs = new Map<string, WS>();

let snapshotSerializer: () => ArrayBuffer;
let soaSerializer: (eids: readonly number[]) => ArrayBuffer;

// Entities whose field data has changed since the last broadcast tick.
// Populated by applyPaint when it creates a new tile entity (because the
// observer stream only carries structural events, not field values — we
// have to follow up with a SoA payload so clients see the painted tile's
// real coords + tileId, not zeros).
const dirtyEids = new Set<number>();

const SNAPSHOT_BUFFER_SIZE = 64 * 1024;
export const OBSERVER_BUFFER_SIZE = 4 * 1024;
const GAME_STATE_BUFFER_SIZE = 8 * 1024;
const snapshotBuffer = new ArrayBuffer(SNAPSHOT_BUFFER_SIZE);

const gameStateBuffer = new Uint8Array(GAME_STATE_BUFFER_SIZE);
const taggedGameStateBuffer = new Uint8Array(GAME_STATE_BUFFER_SIZE + 1);
const taggedObserverBuffer = new Uint8Array(OBSERVER_BUFFER_SIZE + 1);
const textEncoder = new TextEncoder();

export const tagMessage = (type: number, data: ArrayBuffer): ArrayBuffer => {
  const tagged = new Uint8Array(data.byteLength + 1);
  tagged[0] = type;
  tagged.set(new Uint8Array(data), 1);
  return tagged.buffer;
};

export const createServer = (
  deps: AppDeps & { port: number },
): ReturnType<ReturnType<typeof buildApp>["listen"]> => {
  snapshotSerializer = createSnapshotSerializer(
    deps.world,
    networkedComponents,
    snapshotBuffer,
  );
  soaSerializer = createSoASerializer(networkedComponents);

  const assetRoot = process.env.WEB_ROOT
    ? `${process.env.WEB_ROOT}/assets`
    : "./public/assets";
  if (!existsSync(assetRoot)) {
    mkdirSync(assetRoot, { recursive: true });
  }

  const app = buildApp(deps).listen(deps.port);
  console.log(`Server running on ${app.server?.hostname}:${app.server?.port}`);
  return app;
};

export const registerConnection = (
  ws: WS,
  fields: Pick<
    PlayerConnection,
    "eid" | "userId" | "username" | "displayName" | "isAdmin"
  >,
): void => {
  playerConnections.set(ws, {
    ...fields,
    inputQueue: [],
    lastAckedSeq: -1,
    lastReceivedSeq: -1,
    paintsThisTick: 0,
  });
  userIdToWs.set(fields.userId, ws);
};

export const unregisterConnection = (ws: WS): void => {
  const conn = playerConnections.get(ws);
  if (conn) userIdToWs.delete(conn.userId);
  playerConnections.delete(ws);
  observerSerializers.delete(ws);
};

export const getObserverSerializers = () => observerSerializers;
export const getSnapshotPayload = () => snapshotSerializer();

export const handleIncomingMessage = (
  world: World,
  db: Database,
  ws: WS,
  message: unknown,
): void => {
  const connection = playerConnections.get(ws);
  if (!connection) return;
  try {
    const data = message as { type?: string };
    if (data?.type === "paint") {
      handlePaintMessage(world, db, connection, message);
    } else {
      handleInputMessage(connection, message);
    }
  } catch (e) {
    console.error("Failed to parse message:", e);
  }
};

const handleInputMessage = (
  connection: PlayerConnection,
  data: unknown,
): void => {
  const cmd = validateInput(data, connection.lastReceivedSeq);
  if (!cmd) return;
  connection.lastReceivedSeq = cmd.seq;
  connection.inputQueue.push(cmd);
  while (connection.inputQueue.length > 128) connection.inputQueue.shift();
};

const handlePaintMessage = (
  world: World,
  db: Database,
  connection: PlayerConnection,
  data: unknown,
): void => {
  if (connection.paintsThisTick >= MAX_PAINTS_PER_TICK) return;
  const cmd = validatePaint(data, world, world.catalogIds);
  if (!cmd) return;
  if (!canPaint(world, connection.userId, cmd.x, cmd.y, connection.isAdmin)) {
    debug("paint_denied user=%s x=%d y=%d", connection.userId, cmd.x, cmd.y);
    return;
  }
  connection.paintsThisTick++;
  applyPaint(world, db, cmd, connection.userId);
};

export const getPlayerConnections = () => playerConnections;

export const markEntityDirty = (eid: number): void => {
  dirtyEids.add(eid);
};

export const resetPaintCounters = (): void => {
  for (const [, connection] of playerConnections) {
    connection.paintsThisTick = 0;
  }
};

export const processPlayerInputs = (
  applyInput: (eid: number, cmd: InputCmd) => void,
): void => {
  for (const [, connection] of playerConnections) {
    const { eid, inputQueue } = connection;
    const toProcess = inputQueue.splice(0, MAX_INPUTS_PER_TICK);
    for (const cmd of toProcess) {
      applyInput(eid, cmd);
      connection.lastAckedSeq = cmd.seq;
    }
  }
};

const getSoaPayloadForDirty = (): ArrayBuffer | null => {
  if (dirtyEids.size === 0) return null;
  const eids = Array.from(dirtyEids);
  dirtyEids.clear();
  const buf = soaSerializer(eids);
  if (buf.byteLength === 0) return null;
  debug("soa broadcast: %d entities, %d bytes", eids.length, buf.byteLength);
  return buf;
};

export const broadcastCatalogUpdated = (
  catalog: {
    id: number;
    type: string;
    src_x: number;
    src_y: number;
    label: string;
  }[],
): void => {
  if (playerConnections.size === 0) return;
  const json = JSON.stringify(catalog);
  const payload = textEncoder.encode(json);
  const tagged = new Uint8Array(payload.byteLength + 1);
  tagged[0] = MESSAGE_TYPES.CATALOG_UPDATED;
  tagged.set(payload, 1);
  for (const [ws] of playerConnections) {
    ws.sendBinary(tagged);
  }
  debug("catalog_updated broadcast: %d entries", catalog.length);
};

// Broadcasts a single-byte ZONES_UPDATED to every connected admin. The
// payload is empty — admin clients are expected to refetch the zones list
// + all-cells endpoint themselves. Non-admins never receive this tag.
export const broadcastZonesUpdated = (): void => {
  if (playerConnections.size === 0) return;
  const tagged = new Uint8Array(1);
  tagged[0] = MESSAGE_TYPES.ZONES_UPDATED;
  let count = 0;
  for (const [ws, conn] of playerConnections) {
    if (!conn.isAdmin) continue;
    ws.sendBinary(tagged);
    count++;
  }
  debug("zones_updated broadcast to %d admins", count);
};

// Sends a MY_ZONES payload to one non-admin user, if connected. Payload
// is { cells: [[x, y], ...] } as JSON. Admins are skipped — they get the
// full zones list via broadcastZonesUpdated() instead.
export const sendMyZonesTo = (
  userId: string,
  cells: [number, number][],
): void => {
  const ws = userIdToWs.get(userId);
  if (!ws) return;
  const conn = playerConnections.get(ws);
  if (!conn || conn.isAdmin) return;
  const json = JSON.stringify({ cells });
  const payload = textEncoder.encode(json);
  const tagged = new Uint8Array(payload.byteLength + 1);
  tagged[0] = MESSAGE_TYPES.MY_ZONES;
  tagged.set(payload, 1);
  ws.sendBinary(tagged);
};

export const broadcastGameState = ({
  playerStates,
}: {
  playerStates: PlayerState[];
}): void => {
  if (playerConnections.size === 0) return;

  const gameState: GameStateMessage = { players: playerStates };
  const jsonString = JSON.stringify(gameState);
  const { written: gameStateLength } = textEncoder.encodeInto(
    jsonString,
    gameStateBuffer,
  );

  taggedGameStateBuffer[0] = MESSAGE_TYPES.GAME_STATE;
  taggedGameStateBuffer.set(gameStateBuffer.subarray(0, gameStateLength), 1);
  const taggedStateView = taggedGameStateBuffer.subarray(
    0,
    gameStateLength + 1,
  );

  const soa = getSoaPayloadForDirty();
  const soaPayload = soa ? tagMessage(MESSAGE_TYPES.SOA, soa) : null;

  for (const [ws] of playerConnections) {
    ws.sendBinary(taggedStateView);

    const observerSerializer = observerSerializers.get(ws);
    if (observerSerializer) {
      const updates = observerSerializer();
      if (updates.byteLength > 0) {
        taggedObserverBuffer[0] = MESSAGE_TYPES.OBSERVER;
        taggedObserverBuffer.set(new Uint8Array(updates), 1);
        ws.sendBinary(taggedObserverBuffer.subarray(0, updates.byteLength + 1));
      }
    }

    if (soaPayload) {
      ws.sendBinary(soaPayload);
    }
  }
};
