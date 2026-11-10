import { describe, expect, test } from "bun:test";
import {
  PROTOCOL_VERSION,
  type BodyState,
  type InputCommand,
  type RuntimeId,
} from "@tea/gurgur-engine";
import { compileWorld, createGamePlayers, type GameEngine } from "../src";

const cube = `{
( 0 0 0 ) ( 0 0 16 ) ( 0 16 16 ) TEST [ 1 0 0 0 ] [ 0 1 0 0 ] 0 1 1
( 16 16 16 ) ( 16 0 16 ) ( 16 0 0 ) TEST [ 1 0 0 0 ] [ 0 1 0 0 ] 0 1 1
( 0 0 0 ) ( 16 0 0 ) ( 16 0 16 ) TEST [ 1 0 0 0 ] [ 0 1 0 0 ] 0 1 1
( 16 16 16 ) ( 16 16 0 ) ( 0 16 0 ) TEST [ 1 0 0 0 ] [ 0 1 0 0 ] 0 1 1
( 0 0 0 ) ( 0 16 0 ) ( 16 16 0 ) TEST [ 1 0 0 0 ] [ 0 1 0 0 ] 0 1 1
( 16 16 16 ) ( 0 16 16 ) ( 0 0 16 ) TEST [ 1 0 0 0 ] [ 0 1 0 0 ] 0 1 1
}`;

describe("server-owned player command queue", () => {
  test("deduplicates redundant bundles, consumes newest intent, and executes recovered edges once", () => {
    const bundle = compileWorld(
      `{
"classname" "worldspawn"
"mapversion" "220"
${cube}
}
{
"classname" "info_player_start"
"origin" "0 0 64"
}`,
      "server-player-commands.map",
    );
    let tick = 0;
    let nextBody = 1;
    const processed: Array<{ moveX: number; jumpCounter: number }> = [];
    const used: RuntimeId[] = [];
    const engine: GameEngine = {
      get tick() {
        return tick;
      },
      dt: 1 / 60,
      bodies: {
        forEntity: () => null,
        resolve: () => null,
        state: (id): BodyState => ({
          id,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          linearVelocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 },
          awake: true,
        }),
      },
      setKinematicTarget() {},
      setBodyAwake() {},
      raycast: () => null,
      createPlayerProxy: () => ({ index: nextBody++, generation: 1 }),
      updatePlayerProxy() {},
      destroyBody() {},
      driveBodyToTarget: () => false,
      requestSave() {},
    };
    const players = createGamePlayers({
      engine,
      bundle,
      restored: [],
      stepController: (state, input) => {
        processed.push({ moveX: input.moveX, jumpCounter: input.jumpCounter });
        return { ...state, lastJumpCounter: input.jumpCounter };
      },
      use: (target) => {
        used.push({ ...target });
        return true;
      },
    });
    const id = players.connect("server-player");
    const useTarget = { index: 42, generation: 1 };
    for (const sequence of [0, 1, 2, 3]) {
      const input = command(sequence);
      input.interactCounter = sequence >= 2 ? 2 : 1;
      input.interactTarget = useTarget;
      expect(players.acceptInput(id, input, 1)).toBe(true);
    }
    for (const sequence of [0, 1, 2, 3])
      expect(players.acceptInput(id, command(sequence), 1)).toBe(true);

    players.step();
    expect(processed).toEqual([{ moveX: 0.75, jumpCounter: 1 }]);
    expect(used).toEqual([useTarget, useTarget]);
    expect(players.prediction(id)?.lastProcessedInputSequence).toBe(3);
    expect(players.trace(id)?.queuedInputSequences).toEqual([]);

    tick += 1;
    players.step();
    expect(processed.at(-1)).toEqual({ moveX: 0.75, jumpCounter: 1 });
    expect(players.networkStates()[0]!.lastJumpCounter).toBe(1);
  });

  test("does not retain a permanent command backlog after a producer stall", () => {
    const bundle = compileWorld(
      `{
"classname" "worldspawn"
"mapversion" "220"
${cube}
}
{
"classname" "info_player_start"
"origin" "0 0 64"
}`,
      "server-player-stall.map",
    );
    let tick = 0;
    let nextBody = 1;
    const engine: GameEngine = {
      get tick() {
        return tick;
      },
      dt: 1 / 60,
      bodies: {
        forEntity: () => null,
        resolve: () => null,
        state: (id): BodyState => ({
          id,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          linearVelocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 },
          awake: true,
        }),
      },
      setKinematicTarget() {},
      setBodyAwake() {},
      raycast: () => null,
      createPlayerProxy: () => ({ index: nextBody++, generation: 1 }),
      updatePlayerProxy() {},
      destroyBody() {},
      driveBodyToTarget: () => false,
      requestSave() {},
    };
    const players = createGamePlayers({
      engine,
      bundle,
      restored: [],
      stepController: (state, input) => ({
        ...state,
        position: { ...state.position, x: state.position.x + input.moveX / 60 },
        lastJumpCounter: input.jumpCounter,
      }),
      use: () => false,
    });
    const id = players.connect("stalled-player");
    expect(players.acceptInput(id, { ...command(0), moveX: 1 }, 1)).toBe(true);
    players.step();
    for (tick = 1; tick <= 16; tick += 1) players.step();

    for (let sequence = 1; sequence <= 16; sequence += 1)
      expect(
        players.acceptInput(id, { ...command(sequence), moveX: 1 }, 1),
      ).toBe(true);
    expect(players.trace(id)?.queuedInputSequences).toHaveLength(16);

    const beforeBurst = players.views()[0]!.position.x;
    players.step();
    expect(players.prediction(id)?.lastProcessedInputSequence).toBe(16);
    expect(players.trace(id)?.queuedInputSequences).toEqual([]);
    expect(players.views()[0]!.position.x - beforeBurst).toBeCloseTo(1 / 60, 8);
  });

  test("drops a held body when it becomes the player's support", () => {
    const bundle = compileWorld(
      `{
"classname" "worldspawn"
"mapversion" "220"
${cube}
}
{
"classname" "info_player_start"
"origin" "0 0 64"
}
{
"classname" "func_physics"
"authoredId" "support.prop"
${cube}
}`,
      "held-player-support.map",
    );
    const entityIndex = bundle.entities.findIndex(
      (entity) => entity.kind === "physics-prop",
    );
    const target = { index: 40, generation: 1 };
    const proxy = { index: 41, generation: 1 };
    let tick = 0;
    let heldSupport = false;
    let saves = 0;
    const engine: GameEngine = {
      get tick() {
        return tick;
      },
      dt: 1 / 60,
      bodies: {
        forEntity: (candidate) =>
          candidate === entityIndex ? { id: target, entityIndex } : null,
        resolve: (id) =>
          sameId(id, target) ? { id: target, entityIndex } : null,
        state: (id): BodyState => ({
          id,
          position: { x: 0, y: 0, z: -1 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          linearVelocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 },
          awake: true,
        }),
      },
      setKinematicTarget() {},
      setBodyAwake() {},
      raycast: (origin, displacement) =>
        displacement.y < -0.5
          ? heldSupport
            ? {
                body: target,
                point: { x: origin.x, y: origin.y - 0.9, z: origin.z },
                normal: { x: 0, y: 1, z: 0 },
                fraction: 0.8,
              }
            : null
          : {
              body: target,
              point: { x: 0, y: 0.5, z: -1 },
              normal: { x: 0, y: 0, z: 1 },
              fraction: 0.4,
            },
      createPlayerProxy: () => proxy,
      updatePlayerProxy() {},
      destroyBody() {},
      driveBodyToTarget: () => true,
      requestSave: () => {
        saves += 1;
      },
    };
    const players = createGamePlayers({
      engine,
      bundle,
      restored: [],
      stepController: (state) => state,
      use: () => false,
    });
    const player = players.connect("support-player");
    const pickup = command(0);
    pickup.primaryCounter = 1;
    expect(players.acceptInput(player, pickup, 1)).toBe(true);
    players.step();
    expect(players.grabbedTarget(player)).toEqual(target);

    heldSupport = true;
    tick += 1;
    players.step();
    expect(players.grabbedTarget(player)).toBeNull();
    expect(saves).toBeGreaterThanOrEqual(2);
  });
});

function command(sequence: number): InputCommand {
  return {
    type: "input",
    protocolVersion: PROTOCOL_VERSION,
    worldEpoch: 1,
    sequence,
    clientTick: sequence,
    moveX: sequence / 4,
    moveZ: 0,
    lookYaw: 0,
    lookPitch: 0,
    buttons: 0,
    jumpCounter: 1,
    interactCounter: 0,
    interactTarget: null,
    primaryCounter: 0,
  };
}

function sameId(a: RuntimeId, b: RuntimeId): boolean {
  return a.index === b.index && a.generation === b.generation;
}
