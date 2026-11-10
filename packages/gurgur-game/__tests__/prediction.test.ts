import { describe, expect, test } from "bun:test";
import {
  PHYSICS_DT,
  PHYSICS_SUBSTEPS,
  PhysicsWorld,
  type BodyState,
  type RuntimeId,
} from "@tea/gurgur-engine";
import {
  PLAYER_CAPSULE_HALF_SEGMENT,
  PLAYER_CAPSULE_RADIUS,
  createPropGrab,
  stepPlayerController,
  stepPropGrab,
  type GameEngine,
  type PlayerControllerState,
  type PropGrab,
} from "../src";

describe("shared Source-style prediction subset", () => {
  test("independent server and browser adapters produce the same player and held-body trace", async () => {
    const server = await createAdapter();
    const browser = await createAdapter();
    try {
      for (let tick = 0; tick < 120; tick += 1) {
        const command = {
          moveX: tick < 50 ? 0.35 : 0,
          moveZ: tick < 80 ? 0.25 : -0.2,
          lookYaw: Math.sin(tick / 30) * 0.7,
          lookPitch: -0.18,
          jumpCounter: tick >= 45 ? 1 : 0,
        };
        const authoritative = stepAdapter(server, command);
        const predicted = stepAdapter(browser, command);
        expectVec3(
          predicted.player.position,
          authoritative.player.position,
          1e-4,
        );
        expect(predicted.player.yaw).toBeCloseTo(authoritative.player.yaw, 4);
        expect(predicted.player.verticalVelocity).toBeCloseTo(
          authoritative.player.verticalVelocity,
          4,
        );
        expectVec3(predicted.body.position, authoritative.body.position, 1e-4);
        expectVec3(
          predicted.body.linearVelocity,
          authoritative.body.linearVelocity,
          1e-4,
        );
        expectQuat(predicted.body.rotation, authoritative.body.rotation, 1e-4);
      }
    } finally {
      server.world.dispose();
      browser.world.dispose();
    }
  });

  test("pickup begins through bounded acceleration and cannot teleport to a distant target", async () => {
    const adapter = await createAdapter();
    try {
      const before = adapter.world.state(adapter.prop);
      const desiredBefore = { ...adapter.grab.targetPosition };
      const after = stepAdapter(adapter, {
        moveX: 0,
        moveZ: 0,
        lookYaw: 0.9,
        lookPitch: -0.18,
        jumpCounter: 0,
      }).body;
      const bodyStep = distance(before.position, after.position);
      const targetStep = distance(desiredBefore, adapter.grab.targetPosition);
      expect(targetStep).toBeGreaterThan(0.1);
      expect(targetStep).toBeLessThanOrEqual(0.2 + 1e-5);
      expect(bodyStep).toBeGreaterThan(0);
      expect(bodyStep).toBeLessThan(0.05);
      expect(
        distance(after.position, adapter.grab.targetPosition),
      ).toBeGreaterThan(0.1);
    } finally {
      adapter.world.dispose();
    }
  });

  test("replays a held prop and its loose-body contact island identically", async () => {
    const server = await createAdapter(true);
    const browser = await createAdapter(true);
    try {
      const initialNeighbor = server.world.state(
        server.looseBodies[0]!,
      ).position;
      for (let tick = 0; tick < 180; tick += 1) {
        const command = {
          moveX: tick < 90 ? 0.2 : -0.15,
          moveZ: tick < 120 ? 0.35 : 0,
          lookYaw: Math.min(1.15, tick / 90),
          lookPitch: -0.18,
          jumpCounter: 0,
        };
        const authoritative = stepAdapter(server, command);
        const predicted = stepAdapter(browser, command);
        expectVec3(
          predicted.player.position,
          authoritative.player.position,
          1e-4,
        );
        expectVec3(predicted.body.position, authoritative.body.position, 1e-4);
        for (
          let index = 0;
          index < authoritative.looseBodies.length;
          index += 1
        ) {
          expectVec3(
            predicted.looseBodies[index]!.position,
            authoritative.looseBodies[index]!.position,
            1e-4,
          );
          expectVec3(
            predicted.looseBodies[index]!.linearVelocity,
            authoritative.looseBodies[index]!.linearVelocity,
            1e-4,
          );
        }
      }
      expect(
        distance(
          server.world.state(server.looseBodies[0]!).position,
          initialNeighbor,
        ),
      ).toBeGreaterThan(0.05);
    } finally {
      server.world.dispose();
      browser.world.dispose();
    }
  });

  test("walks onto, stands on, and crosses the newest loose-prop collision proxy", async () => {
    const world = await PhysicsWorld.create();
    try {
      world.createBox({
        type: "static",
        position: { x: 0, y: -0.5, z: 0 },
        halfExtents: { x: 8, y: 0.5, z: 8 },
      });
      const support = world.createBox({
        type: "kinematic",
        position: { x: 0, y: 0.15, z: 0 },
        halfExtents: { x: 1, y: 0.15, z: 1 },
        density: 100,
      });
      for (let tick = 0; tick < 120; tick += 1)
        world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      let player: PlayerControllerState = {
        position: { x: -2.2, y: 0.9, z: 0 },
        yaw: 0,
        verticalVelocity: 0,
        grounded: true,
        crouched: false,
        lastJumpCounter: 0,
        stepCooldown: 0,
      };
      const proxy = world.createPlayerProxy(player.position, {
        radius: PLAYER_CAPSULE_RADIUS,
        halfSegment: PLAYER_CAPSULE_HALF_SEGMENT,
      });
      let maximumPenetration = 0;
      let groundedTransitions = 0;
      let previousGrounded = player.grounded;
      let standingHeight = 0;
      for (let tick = 0; tick < 96; tick += 1) {
        const moveX = tick < 30 || tick >= 60 ? 1 : 0;
        player = stepPlayerController(
          world,
          player,
          { moveX, moveZ: 0, lookYaw: 0, jumpCounter: 0 },
          PHYSICS_DT,
        );
        world.setKinematicTargetTransform(
          proxy,
          player.position,
          yawRotation(player.yaw),
          PHYSICS_DT,
        );
        world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
        const supportState = world.state(support);
        const horizontallyRelevant =
          Math.abs(player.position.x - supportState.position.x) <= 1 &&
          Math.abs(player.position.z - supportState.position.z) <= 1;
        if (horizontallyRelevant) {
          const playerBottom = player.position.y - 0.9;
          const supportTop = supportState.position.y + 0.15;
          maximumPenetration = Math.max(
            maximumPenetration,
            supportTop - playerBottom,
          );
        }
        if (tick >= 40 && tick < 60)
          standingHeight = Math.max(standingHeight, player.position.y);
        if (player.grounded !== previousGrounded) groundedTransitions += 1;
        previousGrounded = player.grounded;
      }
      expect(maximumPenetration).toBeLessThanOrEqual(0.010_001);
      expect(groundedTransitions).toBeLessThanOrEqual(2);
      expect(standingHeight).toBeGreaterThan(1.15);
      expect(player.position.x).toBeGreaterThan(2);
    } finally {
      world.dispose();
    }
  });
});

type Adapter = {
  world: PhysicsWorld;
  engine: GameEngine;
  prop: RuntimeId;
  playerProxy: RuntimeId;
  player: PlayerControllerState;
  grab: PropGrab;
  looseBodies: RuntimeId[];
  tick: number;
};

async function createAdapter(withContactIsland = false): Promise<Adapter> {
  const world = await PhysicsWorld.create();
  world.createBox({
    type: "static",
    position: { x: 0, y: -0.5, z: 0 },
    halfExtents: { x: 12, y: 0.5, z: 12 },
  });
  const prop = world.createBox({
    type: "dynamic",
    position: { x: 0, y: 0.35, z: -1.4 },
    halfExtents: { x: 0.3, y: 0.3, z: 0.3 },
    density: 1,
  });
  const looseBodies = withContactIsland
    ? [
        world.createBox({
          type: "dynamic",
          position: { x: 0.62, y: 0.35, z: -1.4 },
          halfExtents: { x: 0.3, y: 0.3, z: 0.3 },
          density: 0.5,
        }),
        world.createBox({
          type: "dynamic",
          position: { x: 1.24, y: 0.35, z: -1.4 },
          halfExtents: { x: 0.3, y: 0.3, z: 0.3 },
          density: 3,
        }),
      ]
    : [];
  for (let tick = 0; tick < 60; tick += 1)
    world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
  const player: PlayerControllerState = {
    position: { x: 0, y: 0.9, z: 1.2 },
    yaw: 0,
    verticalVelocity: 0,
    grounded: true,
    crouched: false,
    lastJumpCounter: 0,
    stepCooldown: 0,
  };
  const playerProxy = world.createPlayerProxy(player.position, {
    radius: PLAYER_CAPSULE_RADIUS,
    halfSegment: PLAYER_CAPSULE_HALF_SEGMENT,
  });
  const adapter = {
    world,
    prop,
    playerProxy,
    player,
    looseBodies,
    tick: 0,
  } as Adapter;
  const engine: GameEngine = {
    get tick() {
      return adapter.tick;
    },
    dt: PHYSICS_DT,
    bodies: {
      forEntity: (entityIndex) =>
        entityIndex === 0 ? { id: prop, entityIndex: 0 } : null,
      resolve: (id) => (sameId(id, prop) ? { id: prop, entityIndex: 0 } : null),
      state: (id) => world.state(id),
    },
    setKinematicTarget: (id, position) =>
      world.setKinematicTarget(id, position, PHYSICS_DT),
    setBodyAwake: (id, awake) => world.setBodyAwake(id, awake),
    raycast: (origin, displacement, options) =>
      world.raycastClosest(origin, displacement, options),
    createPlayerProxy: (position, shape) =>
      world.createPlayerProxy(position, shape),
    updatePlayerProxy: (id, position, yaw) =>
      world.setKinematicTargetTransform(
        id,
        position,
        yawRotation(yaw),
        PHYSICS_DT,
      ),
    destroyBody: (id) => {
      world.destroy(id);
    },
    driveBodyToTarget: (id, options) =>
      world.driveBodyToTarget(id, { ...options, seconds: PHYSICS_DT }),
    requestSave() {},
  };
  adapter.engine = engine;
  adapter.grab = createPropGrab(
    engine,
    prop,
    { position: player.position, yaw: 0, lookYaw: 0, lookPitch: -0.18 },
    1.5,
  );
  return adapter;
}

function stepAdapter(
  adapter: Adapter,
  command: {
    moveX: number;
    moveZ: number;
    lookYaw: number;
    lookPitch: number;
    jumpCounter: number;
  },
): {
  player: PlayerControllerState;
  body: BodyState;
  looseBodies: BodyState[];
} {
  adapter.player = stepPlayerController(
    adapter.world,
    adapter.player,
    command,
    PHYSICS_DT,
  );
  adapter.engine.updatePlayerProxy(
    adapter.playerProxy,
    adapter.player.position,
    adapter.player.yaw,
  );
  expect(
    stepPropGrab(adapter.engine, adapter.grab, {
      position: adapter.player.position,
      yaw: adapter.player.yaw,
      lookYaw: command.lookYaw,
      lookPitch: command.lookPitch,
    }),
  ).toBe(true);
  adapter.world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
  adapter.tick += 1;
  return {
    player: structuredClone(adapter.player),
    body: adapter.world.state(adapter.prop),
    looseBodies: adapter.looseBodies.map((body) => adapter.world.state(body)),
  };
}

function expectVec3(
  actual: { x: number; y: number; z: number },
  expected: { x: number; y: number; z: number },
  tolerance: number,
): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.z - expected.z)).toBeLessThanOrEqual(tolerance);
}

function expectQuat(
  actual: { x: number; y: number; z: number; w: number },
  expected: { x: number; y: number; z: number; w: number },
  tolerance: number,
): void {
  expectVec3(actual, expected, tolerance);
  expect(Math.abs(actual.w - expected.w)).toBeLessThanOrEqual(tolerance);
}

function distance(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function sameId(a: RuntimeId, b: RuntimeId): boolean {
  return a.index === b.index && a.generation === b.generation;
}

function yawRotation(yaw: number) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
