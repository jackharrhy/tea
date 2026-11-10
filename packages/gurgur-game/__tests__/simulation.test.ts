import { describe, expect, test } from "bun:test";
import {
  NETWORK_FLAG_ACTIVE,
  NETWORK_FLAG_REVERSED,
  type BodyState,
  type RuntimeId,
} from "@tea/gurgur-engine";
import {
  compileWorld,
  createGameSimulation,
  type GameEngine,
  type HostMechanismEngine,
} from "../src";

const cube = `{
( 0 0 0 ) ( 0 0 16 ) ( 0 16 16 ) TEST [ 1 0 0 0 ] [ 0 1 0 0 ] 0 1 1
( 16 16 16 ) ( 16 0 16 ) ( 16 0 0 ) TEST [ 1 0 0 0 ] [ 0 1 0 0 ] 0 1 1
( 0 0 0 ) ( 16 0 0 ) ( 16 0 16 ) TEST [ 1 0 0 0 ] [ 0 1 0 0 ] 0 1 1
( 16 16 16 ) ( 16 16 0 ) ( 0 16 0 ) TEST [ 1 0 0 0 ] [ 0 1 0 0 ] 0 1 1
( 0 0 0 ) ( 0 16 0 ) ( 16 16 0 ) TEST [ 1 0 0 0 ] [ 0 1 0 0 ] 0 1 1
( 16 16 16 ) ( 0 16 16 ) ( 0 0 16 ) TEST [ 1 0 0 0 ] [ 0 1 0 0 ] 0 1 1
}`;

describe("typed trigger outputs", () => {
  test("dispatches gameplay inputs by entity index on player enter and exit", () => {
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
"classname" "func_door"
"authoredId" "door.zone"
"targetname" "zone_door"
${cube}
}
{
"classname" "trigger_multiple"
"authoredId" "trigger.zone"
"onEnterTarget" "zone_door"
"onEnterInput" "open"
"onExitTarget" "zone_door"
"onExitInput" "close"
${cube}
}`,
      "trigger-simulation.map",
    );
    const door = runtimeId(0);
    const trigger = runtimeId(1);
    const playerProxy = runtimeId(2);
    let tick = 10;
    const bodyStates = new Map([
      [key(door), bodyState(door)],
      [key(trigger), bodyState(trigger)],
      [key(playerProxy), bodyState(playerProxy)],
    ]);
    const engine: GameEngine = {
      get tick() {
        return tick;
      },
      dt: 1 / 60,
      bodies: {
        forEntity(entityIndex) {
          return entityIndex < 2
            ? { id: runtimeId(entityIndex), entityIndex }
            : null;
        },
        resolve(id) {
          return id.index < 2 ? { id, entityIndex: id.index } : null;
        },
        state(id) {
          return bodyStates.get(key(id))!;
        },
      },
      setKinematicTarget(id, position) {
        bodyStates.get(key(id))!.position = { ...position };
      },
      setBodyAwake() {},
      raycast() {
        return null;
      },
      createPlayerProxy() {
        return playerProxy;
      },
      updatePlayerProxy() {},
      destroyBody() {},
      driveBodyToTarget() {
        return false;
      },
      requestSave() {},
    };
    const simulation = createGameSimulation({
      engine,
      bundle,
      restored: null,
      players: {
        restored: [],
        stepController: (state) => state,
      },
    });
    simulation.players.connect("fixture-player");

    simulation.processSensorEvents(
      [{ sensor: trigger, visitor: playerProxy }],
      [],
    );
    expect(mechanismDirection(simulation.persistedState().entities)).toBe(1);

    tick += 1;
    simulation.step();
    simulation.processSensorEvents(
      [],
      [{ sensor: trigger, visitor: playerProxy }],
    );
    expect(mechanismDirection(simulation.persistedState().entities)).toBe(-1);
  });

  test("reference-counts compound volumes and controls replicated conveyor state", () => {
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
"classname" "func_conveyor"
"authoredId" "conveyor.main"
"targetname" "belt"
"direction" "1 0 0"
"speed" "128"
${cube}
${cube}
}
{
"classname" "trigger_multiple"
"authoredId" "trigger.belt"
"onEnterTarget" "belt"
"onEnterInput" "reverse"
${cube}
${cube}
}
{
"classname" "trigger_gravity"
"gravityFactor" "0.25"
"priority" "3"
${cube}
${cube}
}
{
"classname" "trigger_gravity"
"gravityFactor" "0.5"
"priority" "1"
${cube}
}`,
      "compound-physics.map",
    );
    const playerProxy = runtimeId(4);
    const states = new Map(
      [0, 1, 2, 3, 4].map((index) => [
        key(runtimeId(index)),
        bodyState(runtimeId(index)),
      ]),
    );
    const surfaceVelocities: Array<{ id: RuntimeId; x: number }> = [];
    const engine = mockEngine(states, playerProxy, 4);
    const mechanisms: HostMechanismEngine = {
      createRevolute: () => runtimeId(100),
      setRevoluteMotor() {},
      createPrismatic: () => runtimeId(101),
      setPrismaticMotor() {},
      createSpherical: () => runtimeId(102),
      createWeld: () => runtimeId(103),
      createDistance: () => runtimeId(104),
      createControl: () => runtimeId(105),
      setControlTarget() {},
      destroyConstraint: () => true,
      setSurfaceVelocity(id, velocity) {
        surfaceVelocities.push({ id, x: velocity.x });
      },
      setGravityScale() {},
    };
    const simulation = createGameSimulation({
      engine,
      mechanisms,
      bundle,
      restored: null,
      players: {
        restored: [],
        stepController: (state) => state,
      },
    });
    simulation.players.connect("fixture-player");
    expect(surfaceVelocities.at(-1)?.x).toBeCloseTo(3.2512);

    simulation.processSensorEvents(
      [
        { sensor: runtimeId(1), visitor: playerProxy },
        { sensor: runtimeId(1), visitor: playerProxy },
      ],
      [],
    );
    expect(surfaceVelocities.at(-1)?.x).toBeCloseTo(-3.2512);
    expect(simulation.networkFlags(0)).toBe(
      NETWORK_FLAG_ACTIVE | NETWORK_FLAG_REVERSED,
    );

    simulation.processSensorEvents(
      [{ sensor: runtimeId(3), visitor: playerProxy }],
      [],
    );
    expect(simulation.gravityFactor(playerProxy)).toBe(0.5);
    simulation.processSensorEvents(
      [
        { sensor: runtimeId(2), visitor: playerProxy },
        { sensor: runtimeId(2), visitor: playerProxy },
      ],
      [],
    );
    expect(simulation.gravityFactor(playerProxy)).toBe(0.25);
    simulation.processSensorEvents(
      [],
      [{ sensor: runtimeId(2), visitor: playerProxy }],
    );
    expect(simulation.gravityFactor(playerProxy)).toBe(0.25);
    simulation.processSensorEvents(
      [],
      [{ sensor: runtimeId(2), visitor: playerProxy }],
    );
    expect(simulation.gravityFactor(playerProxy)).toBe(0.5);
    simulation.processSensorEvents(
      [],
      [{ sensor: runtimeId(3), visitor: playerProxy }],
    );
    expect(simulation.gravityFactor(playerProxy)).toBe(1);
    expect(simulation.persistedState().entities).toContainEqual({
      kind: "physics-control",
      authoredId: "conveyor.main",
      enabled: true,
      reversed: true,
    });
  });
});

describe("fixed-authority contraption manipulation", () => {
  test("grants one host control claim and rejects stale or foreign target state", () => {
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
"authoredId" "lever"
"targetname" "lever"
"grabbable" "0"
${cube}
}`,
      "manipulation.map",
    );
    const body = runtimeId(0);
    const playerProxy = runtimeId(1);
    const states = new Map([
      [key(body), bodyState(body)],
      [key(playerProxy), bodyState(playerProxy)],
    ]);
    const targets: Array<{ x: number; y: number; z: number }> = [];
    let destroyed = 0;
    const mechanisms: HostMechanismEngine = {
      createRevolute: () => runtimeId(100),
      setRevoluteMotor() {},
      createPrismatic: () => runtimeId(101),
      setPrismaticMotor() {},
      createSpherical: () => runtimeId(102),
      createWeld: () => runtimeId(103),
      createDistance: () => runtimeId(104),
      createControl: () => runtimeId(105),
      setControlTarget(_id, position) {
        targets.push({ ...position });
      },
      destroyConstraint() {
        destroyed += 1;
        return true;
      },
      setSurfaceVelocity() {},
      setGravityScale() {},
    };
    const simulation = createGameSimulation({
      engine: mockEngine(states, playerProxy, 1),
      mechanisms,
      bundle,
      restored: null,
      players: {
        restored: [],
        stepController: (state) => state,
      },
    });
    const first = simulation.players.connect("first");
    const second = simulation.players.connect("second");
    expect(
      simulation.beginManipulation(first, body, 1, { x: 0, y: 0, z: 0 }),
    ).toBe(true);
    expect(
      simulation.beginManipulation(second, body, 2, { x: 0, y: 0, z: 0 }),
    ).toBe("busy");
    expect(
      simulation.updateManipulation(second, {
        worldEpoch: 1,
        target: body,
        authorityVersion: 1,
        claimVersion: 1,
        stateSequence: 1,
        targetPosition: { x: 0, y: 1, z: 0 },
        targetRotation: { x: 0, y: 0, z: 0, w: 1 },
      }),
    ).toBe(false);
    expect(
      simulation.updateManipulation(first, {
        worldEpoch: 1,
        target: body,
        authorityVersion: 1,
        claimVersion: 1,
        stateSequence: 65_535,
        targetPosition: { x: 0, y: 1, z: 0 },
        targetRotation: { x: 0, y: 0, z: 0, w: 1 },
      }),
    ).toBe(true);
    expect(
      simulation.updateManipulation(first, {
        worldEpoch: 1,
        target: body,
        authorityVersion: 1,
        claimVersion: 1,
        stateSequence: 65_535,
        targetPosition: { x: 0, y: 2, z: 0 },
        targetRotation: { x: 0, y: 0, z: 0, w: 1 },
      }),
    ).toBe(false);
    expect(
      simulation.updateManipulation(first, {
        worldEpoch: 1,
        target: body,
        authorityVersion: 1,
        claimVersion: 1,
        stateSequence: 0,
        targetPosition: { x: 0, y: 1.25, z: 0 },
        targetRotation: { x: 0, y: 0, z: 0, w: 1 },
      }),
    ).toBe(true);
    simulation.step();
    expect(targets.at(-1)?.y).toBe(1.25);
    expect(simulation.endManipulation(second, body, 1)).toBeNull();
    expect(simulation.endManipulation(first, body, 1)?.target).toEqual(body);
    expect(destroyed).toBe(1);
  });
});

function mechanismDirection(
  entities: ReturnType<
    ReturnType<typeof createGameSimulation>["persistedState"]
  >["entities"],
): -1 | 0 | 1 {
  const mechanism = entities.find((entity) => entity.kind === "linear-mover");
  if (!mechanism || mechanism.kind !== "linear-mover")
    throw new Error("mechanism is missing");
  return mechanism.direction;
}

function runtimeId(index: number): RuntimeId {
  return { index, generation: 1 };
}

function key(id: RuntimeId): string {
  return `${id.index}:${id.generation}`;
}

function bodyState(id: RuntimeId): BodyState {
  return {
    id,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    linearVelocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    awake: true,
  };
}

function mockEngine(
  bodyStates: Map<string, BodyState>,
  playerProxy: RuntimeId,
  entityCount: number,
): GameEngine {
  return {
    tick: 10,
    dt: 1 / 60,
    bodies: {
      forEntity(entityIndex) {
        return entityIndex < entityCount
          ? { id: runtimeId(entityIndex), entityIndex }
          : null;
      },
      resolve(id) {
        return id.index < entityCount ? { id, entityIndex: id.index } : null;
      },
      state(id) {
        return bodyStates.get(key(id))!;
      },
    },
    setKinematicTarget(id, position) {
      bodyStates.get(key(id))!.position = { ...position };
    },
    setBodyAwake() {},
    raycast() {
      return null;
    },
    createPlayerProxy() {
      return playerProxy;
    },
    updatePlayerProxy() {},
    destroyBody() {},
    driveBodyToTarget() {
      return false;
    },
    requestSave() {},
  };
}
