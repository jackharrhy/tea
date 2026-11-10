import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Quat, Vec3 } from "@tea/gurgur-engine";
import {
  decodePersistedGameState,
  encodePersistedGameState,
  type PersistedGameState,
  type PersistedPlayerState,
} from "@tea/gurgur-game";

export type PersistedWorld = {
  worldEpoch: number;
  serverTick: number;
  bodies: Array<{
    authoredId: string;
    position: Vec3;
    rotation: Quat;
    linearVelocity: Vec3;
    angularVelocity: Vec3;
    awake: boolean;
  }>;
  gameState: PersistedGameState;
  players: PersistedPlayerState[];
};

type WorldRow = {
  map_revision: string;
  world_epoch: number;
  server_tick: number;
  game_state: string;
};

type BodyRow = {
  authored_id: string;
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  awake: number;
};

type PlayerRow = {
  persistent_id: string;
  px: number;
  py: number;
  pz: number;
  yaw: number;
  vertical_velocity: number;
  grounded: number;
  last_jump_counter: number;
  step_cooldown: number;
  crouched: number;
  grabbed_authored_id: string | null;
  grab_distance: number;
};

export class WorldStore {
  readonly #database: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#database = new Database(path, { create: true, strict: true });
    if (path !== ":memory:") this.#database.run("PRAGMA journal_mode = WAL");
    this.#database.run("PRAGMA foreign_keys = ON");
    this.#database.run(`
      CREATE TABLE IF NOT EXISTS world_snapshot (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        map_revision TEXT NOT NULL,
        world_epoch INTEGER NOT NULL,
        server_tick INTEGER NOT NULL,
        game_state TEXT NOT NULL CHECK (json_valid(game_state)),
        saved_at_ms INTEGER NOT NULL
      ) STRICT
    `);
    this.#database.run(`
      CREATE TABLE IF NOT EXISTS body_state (
        authored_id TEXT PRIMARY KEY,
        px REAL NOT NULL, py REAL NOT NULL, pz REAL NOT NULL,
        qx REAL NOT NULL, qy REAL NOT NULL, qz REAL NOT NULL, qw REAL NOT NULL,
        vx REAL NOT NULL, vy REAL NOT NULL, vz REAL NOT NULL,
        wx REAL NOT NULL, wy REAL NOT NULL, wz REAL NOT NULL,
        awake INTEGER NOT NULL CHECK (awake IN (0, 1))
      ) STRICT
    `);
    this.#database.run(`
      CREATE TABLE IF NOT EXISTS player_state (
        persistent_id TEXT PRIMARY KEY,
        px REAL NOT NULL, py REAL NOT NULL, pz REAL NOT NULL,
        yaw REAL NOT NULL,
        vertical_velocity REAL NOT NULL,
        grounded INTEGER NOT NULL CHECK (grounded IN (0, 1)),
        last_jump_counter INTEGER NOT NULL CHECK (last_jump_counter >= 0),
        step_cooldown INTEGER NOT NULL CHECK (step_cooldown >= 0),
        crouched INTEGER NOT NULL CHECK (crouched IN (0, 1)),
        grabbed_authored_id TEXT,
        grab_distance REAL NOT NULL CHECK (grab_distance >= 0)
      ) STRICT
    `);
  }

  load(mapRevision: string): PersistedWorld | null {
    const world = this.#database
      .query<WorldRow, []>(`
        SELECT map_revision, world_epoch, server_tick, game_state
        FROM world_snapshot WHERE singleton = 1
      `)
      .get();
    if (!world || world.map_revision !== mapRevision) return null;
    const bodies = this.#database
      .query<BodyRow, []>(`
        SELECT authored_id, px, py, pz, qx, qy, qz, qw, vx, vy, vz, wx, wy, wz, awake
        FROM body_state ORDER BY authored_id
      `)
      .all();
    const players = this.#database
      .query<PlayerRow, []>(`
        SELECT persistent_id, px, py, pz, yaw, vertical_velocity, grounded,
               last_jump_counter, step_cooldown, crouched, grabbed_authored_id, grab_distance
        FROM player_state ORDER BY persistent_id
      `)
      .all();
    return {
      worldEpoch: world.world_epoch,
      serverTick: world.server_tick,
      gameState: decodePersistedGameState(world.game_state),
      bodies: bodies.map((body) => ({
        authoredId: body.authored_id,
        position: { x: body.px, y: body.py, z: body.pz },
        rotation: { x: body.qx, y: body.qy, z: body.qz, w: body.qw },
        linearVelocity: { x: body.vx, y: body.vy, z: body.vz },
        angularVelocity: { x: body.wx, y: body.wy, z: body.wz },
        awake: body.awake === 1,
      })),
      players: players.map((player) => ({
        persistentId: player.persistent_id,
        position: { x: player.px, y: player.py, z: player.pz },
        yaw: player.yaw,
        verticalVelocity: player.vertical_velocity,
        grounded: player.grounded === 1,
        lastJumpCounter: player.last_jump_counter,
        stepCooldown: player.step_cooldown,
        crouched: player.crouched === 1,
        grabbedAuthoredId: player.grabbed_authored_id,
        grabDistance: player.grab_distance,
      })),
    };
  }

  save(mapRevision: string, world: PersistedWorld): void {
    const gameState = encodePersistedGameState(world.gameState);
    const transaction = this.#database.transaction(() => {
      this.#database
        .query(`
          INSERT INTO world_snapshot (
            singleton, map_revision, world_epoch, server_tick, game_state, saved_at_ms
          ) VALUES (1, $mapRevision, $worldEpoch, $serverTick, $gameState, $savedAtMs)
          ON CONFLICT(singleton) DO UPDATE SET
            map_revision = excluded.map_revision,
            world_epoch = excluded.world_epoch,
            server_tick = excluded.server_tick,
            game_state = excluded.game_state,
            saved_at_ms = excluded.saved_at_ms
        `)
        .run({
          mapRevision,
          worldEpoch: world.worldEpoch,
          serverTick: world.serverTick,
          gameState,
          savedAtMs: Date.now(),
        });
      this.#database.run("DELETE FROM body_state");
      const insertBody = this.#database.query(`
        INSERT INTO body_state (
          authored_id, px, py, pz, qx, qy, qz, qw, vx, vy, vz, wx, wy, wz, awake
        ) VALUES (
          $authoredId, $px, $py, $pz, $qx, $qy, $qz, $qw, $vx, $vy, $vz, $wx, $wy, $wz, $awake
        )
      `);
      for (const body of world.bodies)
        insertBody.run({
          authoredId: body.authoredId,
          px: body.position.x,
          py: body.position.y,
          pz: body.position.z,
          qx: body.rotation.x,
          qy: body.rotation.y,
          qz: body.rotation.z,
          qw: body.rotation.w,
          vx: body.linearVelocity.x,
          vy: body.linearVelocity.y,
          vz: body.linearVelocity.z,
          wx: body.angularVelocity.x,
          wy: body.angularVelocity.y,
          wz: body.angularVelocity.z,
          awake: Number(body.awake),
        });
      this.#database.run("DELETE FROM player_state");
      const insertPlayer = this.#database.query(`
        INSERT INTO player_state (
          persistent_id, px, py, pz, yaw, vertical_velocity, grounded,
          last_jump_counter, step_cooldown, crouched, grabbed_authored_id, grab_distance
        ) VALUES (
          $persistentId, $px, $py, $pz, $yaw, $verticalVelocity, $grounded,
          $lastJumpCounter, $stepCooldown, $crouched, $grabbedAuthoredId, $grabDistance
        )
      `);
      for (const player of world.players)
        insertPlayer.run({
          persistentId: player.persistentId,
          px: player.position.x,
          py: player.position.y,
          pz: player.position.z,
          yaw: player.yaw,
          verticalVelocity: player.verticalVelocity,
          grounded: Number(player.grounded),
          lastJumpCounter: player.lastJumpCounter,
          stepCooldown: player.stepCooldown,
          crouched: Number(player.crouched),
          grabbedAuthoredId: player.grabbedAuthoredId,
          grabDistance: player.grabDistance,
        });
    });
    transaction();
  }

  close(): void {
    this.#database.close();
  }
}
