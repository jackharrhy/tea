import invariant from "tiny-invariant";
import {
  applyInputToVelocity,
  moveAndSlide,
  type PlayerState,
  SERVER_TICK_RATE_MS,
} from "@harrhy/burger-core";
import { removeEntity } from "bitecs";
import {
  createServer,
  getPlayerConnections,
  processPlayerInputs,
  broadcastGameState,
  resetPaintCounters,
} from "./network.server";
import { spawnAiPlayers, updateAiPlayers, getAiEntities } from "./ai";
import { createPlayer } from "./players";
import { openDatabase } from "./db";
import { loadAuthConfig } from "./auth/config";
import { initWorld } from "./world";

const db = openDatabase();
const authConfig = loadAuthConfig();
const world = initWorld(db);

export type { World } from "./world";

let isIdle = false;
let stopping = false;
let tickTimer: ReturnType<typeof setTimeout> | undefined;

const scheduleTick = (tick: () => void, delay: number) => {
  if (!stopping) tickTimer = setTimeout(tick, delay);
};

const activeTick = () => {
  if (stopping) return;
  const { Position, Velocity } = world.components;

  resetPaintCounters();

  updateAiPlayers(world, SERVER_TICK_RATE_MS);

  processPlayerInputs((eid, cmd) => {
    invariant(Velocity.x[eid] !== undefined);
    invariant(Velocity.y[eid] !== undefined);
    invariant(Position.x[eid] !== undefined);
    invariant(Position.y[eid] !== undefined);

    // Apply physics for the dt the client perceived for this input. The
    // validator clamps cmd.msec to [0, MAX_INPUT_MSEC] so a malicious
    // client can't smuggle absurd values. Frame-rate-independent.
    const newVel = applyInputToVelocity(
      Velocity.x[eid],
      Velocity.y[eid],
      cmd,
      cmd.msec,
    );
    Velocity.x[eid] = newVel.vx;
    Velocity.y[eid] = newVel.vy;

    const newPos = moveAndSlide(
      world,
      Position.x[eid],
      Position.y[eid],
      Velocity.x[eid],
      Velocity.y[eid],
      cmd.msec,
    );
    Position.x[eid] = newPos.x;
    Position.y[eid] = newPos.y;
  });

  const playerStates: PlayerState[] = [];

  for (const [, connection] of getPlayerConnections()) {
    const { eid, lastAckedSeq } = connection;
    invariant(Position.x[eid] !== undefined);
    invariant(Position.y[eid] !== undefined);
    invariant(Velocity.x[eid] !== undefined);
    invariant(Velocity.y[eid] !== undefined);

    playerStates.push({
      eid,
      x: Position.x[eid],
      y: Position.y[eid],
      vx: Velocity.x[eid],
      vy: Velocity.y[eid],
      lastInputSeq: lastAckedSeq,
    });
  }

  for (const ai of getAiEntities()) {
    const { eid } = ai;
    invariant(Position.x[eid] !== undefined);
    invariant(Position.y[eid] !== undefined);
    invariant(Velocity.x[eid] !== undefined);
    invariant(Velocity.y[eid] !== undefined);

    playerStates.push({
      eid,
      x: Position.x[eid],
      y: Position.y[eid],
      vx: Velocity.x[eid],
      vy: Velocity.y[eid],
      lastInputSeq: -1,
    });
  }

  const hasPlayers = getPlayerConnections().size > 0;
  if (hasPlayers) {
    isIdle = false;
  } else {
    console.log("Switching to idle mode");
    isIdle = true;
  }

  broadcastGameState({ playerStates });

  scheduleTick(
    isIdle ? idleTick : activeTick,
    isIdle ? 1000 : SERVER_TICK_RATE_MS,
  );
};

const idleTick = () => {
  if (stopping) return;
  const hasPlayers = getPlayerConnections().size > 0;
  if (hasPlayers) {
    console.log("Switching to active mode");
    isIdle = false;
    scheduleTick(activeTick, SERVER_TICK_RATE_MS);
  } else {
    scheduleTick(idleTick, 1000);
  }
};

const SERVER_PORT = Number(process.env.PORT ?? 5000);

const server = createServer({
  port: SERVER_PORT,
  world,
  db,
  authConfig,
  onPlayerJoin: (displayName: string) => createPlayer(world, displayName),
  onPlayerLeave: (eid) => removeEntity(world, eid),
});

spawnAiPlayers(world);

activeTick();

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(tickTimer);
  console.info("Burger shutdown: draining connections");
  try {
    for (const ws of getPlayerConnections().keys())
      ws.close(1012, "Server restarting");
    const deadline = Date.now() + 1000;
    while (getPlayerConnections().size && Date.now() < deadline)
      await Bun.sleep(25);
    for (const ws of getPlayerConnections().keys()) ws.terminate();
    console.info("Burger shutdown: stopping listener");
    await server.stop(true);
    db.close();
    console.info("Burger shutdown: complete");
    // Bun can retain closed WebSocket handles after the listener and DB close.
    process.exit(0);
  } catch (error) {
    console.error("Burger shutdown failed", error);
    process.exitCode = 1;
  }
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
