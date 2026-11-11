import { describe, expect, test } from "bun:test";
import { PHYSICS_DT, PHYSICS_SUBSTEPS } from "@harrhy/gurgur-engine";
import {
  PLAYER_CAPSULE_HALF_SEGMENT,
  PLAYER_CAPSULE_RADIUS,
  PLAYER_HALF_HEIGHT,
  PLAYER_MAX_FIXED_TICK_DISPLACEMENT,
  stepPlayerController,
  type PlayerControllerState,
} from "@harrhy/gurgur-game";
import { PhysicsWorld } from "@harrhy/gurgur-engine";

const replay = async (): Promise<string[]> => {
  const world = await PhysicsWorld.create();
  try {
    world.createBox({
      type: "static",
      position: { x: 0, y: -0.5, z: 0 },
      halfExtents: { x: 8, y: 0.5, z: 8 },
    });
    const driven = world.createBox({
      type: "dynamic",
      position: { x: -2, y: 0.5, z: 0 },
      halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    });
    const contacted = world.createBox({
      type: "dynamic",
      position: { x: 0, y: 0.5, z: 0 },
      halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    });
    const trace: string[] = [];
    for (let tick = 0; tick < 180; tick += 1) {
      world.driveBodyToTarget(driven, {
        targetPosition: { x: 2, y: 0.5, z: 0 },
        targetRotation: { x: 0, y: 0, z: 0, w: 1 },
        linearGain: 10,
        maxLinearSpeed: 5,
        maxLinearAcceleration: 30,
        angularGain: 8,
        maxAngularSpeed: Math.PI * 2,
        maxAngularAcceleration: Math.PI * 8,
        seconds: PHYSICS_DT,
      });
      world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      const state = world.state(contacted);
      trace.push(
        [
          state.position.x,
          state.position.y,
          state.position.z,
          state.linearVelocity.x,
          state.linearVelocity.y,
          state.linearVelocity.z,
        ]
          .map((value) => value.toFixed(7))
          .join(","),
      );
    }
    expect(world.state(contacted).position.x).toBeGreaterThan(0.5);
    return trace;
  } finally {
    world.dispose();
  }
};

describe("PhysicsWorld", () => {
  test("extracts bounded Box3D debug bounds without exposing Wasm state", async () => {
    const world = await PhysicsWorld.create();
    try {
      world.createBox({
        type: "dynamic",
        position: { x: 1, y: 2, z: 3 },
        halfExtents: { x: 0.5, y: 0.6, z: 0.7 },
      });
      const debug = world.debugDraw();
      const bounds = debug.primitives.find(
        (primitive) => primitive.kind === "bounds",
      );
      expect(bounds?.kind).toBe("bounds");
      if (bounds?.kind !== "bounds") throw new Error("expected Box3D bounds");
      expect(bounds.lower.x).toBeLessThan(0.5);
      expect(bounds.upper.z).toBeGreaterThan(3.7);
      expect(debug.truncated).toBe(false);
      expect(world.debugDraw(0)).toEqual({ primitives: [], truncated: true });
    } finally {
      world.dispose();
    }
  });

  test("steps a dynamic body onto the ground", async () => {
    const world = await PhysicsWorld.create();
    try {
      world.createBox({
        type: "static",
        position: { x: 0, y: 0, z: 0 },
        halfExtents: { x: 8, y: 0.5, z: 8 },
      });
      const box = world.createBox({
        type: "dynamic",
        position: { x: 0, y: 6, z: 0 },
        halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
      });
      for (let tick = 0; tick < 240; tick += 1)
        world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      expect(world.state(box).position.y).toBeWithin(0.98, 1.02);
    } finally {
      world.dispose();
    }
  });

  test("rejects a generation-stale handle after slot reuse", async () => {
    const world = await PhysicsWorld.create();
    try {
      const first = world.createBox({
        type: "dynamic",
        position: { x: 0, y: 1, z: 0 },
        halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
      });
      expect(world.destroy(first)).toBe(true);
      const replacement = world.createBox({
        type: "dynamic",
        position: { x: 0, y: 1, z: 0 },
        halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
      });
      expect(replacement.index).toBe(first.index);
      expect(replacement.generation).toBe(first.generation + 1);
      expect(() => world.state(first)).toThrow("stale physics handle");
    } finally {
      world.dispose();
    }
  });

  test("recreates the underlying world and invalidates every issued handle", async () => {
    const world = await PhysicsWorld.create();
    try {
      const old = world.createBox({
        type: "dynamic",
        position: { x: 0, y: 1, z: 0 },
        halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
      });
      world.recreate();
      expect(() => world.state(old)).toThrow("stale physics handle");
      const replacement = world.createBox({
        type: "dynamic",
        position: { x: 0, y: 1, z: 0 },
        halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
      });
      expect(replacement.index).toBe(old.index);
      expect(replacement.generation).toBe(old.generation + 1);
      world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      expect(world.state(replacement).position.y).toBeLessThan(1);
    } finally {
      world.dispose();
    }
  });

  test("moves a capsule over ground, stops at walls, and slides along them", async () => {
    const world = await PhysicsWorld.create();
    try {
      world.createBox({
        type: "static",
        position: { x: 0, y: -0.5, z: 0 },
        halfExtents: { x: 10, y: 0.5, z: 10 },
      });
      world.createBox({
        type: "static",
        position: { x: 2.5, y: 2, z: 0 },
        halfExtents: { x: 0.5, y: 2, z: 10 },
      });
      world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      let state = playerState();
      for (let tick = 0; tick < 60; tick += 1) {
        state = stepPlayerController(
          world,
          state,
          { moveX: 1, moveZ: -0.5, lookYaw: 0, jumpCounter: 0 },
          PHYSICS_DT,
        );
      }
      expect(state.position.x).toBeWithin(1.62, 1.68);
      expect(state.position.z).toBeGreaterThan(1.5);
      expect(state.grounded).toBe(true);
    } finally {
      world.dispose();
    }
  });

  test("rejects an implausible fixed-tick mover result", () => {
    const state = playerState();
    const result = stepPlayerController(
      {
        applyLinearImpulse: () => false,
        capsuleFits: () => true,
        castCapsule: (start, desired) => ({
          x: start.x + desired.x,
          y: start.y + desired.y,
          z: start.z + desired.z,
        }),
        moveCapsule: () => ({
          x: state.position.x + PLAYER_MAX_FIXED_TICK_DISPLACEMENT + 100,
          y: state.position.y,
          z: state.position.z,
        }),
        pointVelocity: () => ({ x: 0, y: 0, z: 0 }),
        raycastClosest: () => null,
      },
      state,
      {
        moveX: 1,
        moveZ: 0,
        lookYaw: 1.25,
        jumpCounter: 7,
      },
      PHYSICS_DT,
    );

    expect(result.position).toEqual(state.position);
    expect(result.verticalVelocity).toBe(0);
    expect(result.yaw).toBe(1.25);
    expect(result.lastJumpCounter).toBe(7);
  });

  test("steps onto a 0.28 metre obstacle and jumps only on a counter edge", async () => {
    const world = await PhysicsWorld.create();
    try {
      world.createBox({
        type: "static",
        position: { x: 0, y: -0.5, z: 0 },
        halfExtents: { x: 10, y: 0.5, z: 10 },
      });
      world.createBox({
        type: "static",
        position: { x: 2.5, y: 0.14, z: 0 },
        halfExtents: { x: 2, y: 0.14, z: 2 },
      });
      world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      let state = playerState();
      for (let tick = 0; tick < 30; tick += 1) {
        state = stepPlayerController(
          world,
          state,
          { moveX: 1, moveZ: 0, lookYaw: 0, jumpCounter: 0 },
          PHYSICS_DT,
        );
      }
      expect(state.position.x).toBeGreaterThan(1.7);
      expect(state.position.y).toBeWithin(1.17, 1.19);
      const jumped = stepPlayerController(
        world,
        state,
        { moveX: 0, moveZ: 0, lookYaw: 0, jumpCounter: 1 },
        PHYSICS_DT,
      );
      expect(jumped.position.y).toBeGreaterThan(state.position.y);
      const held = stepPlayerController(
        world,
        jumped,
        { moveX: 0, moveZ: 0, lookYaw: 0, jumpCounter: 1 },
        PHYSICS_DT,
      );
      expect(held.verticalVelocity).toBeLessThan(jumped.verticalVelocity);
    } finally {
      world.dispose();
    }
  });

  test("rejects an obstacle above the step-height limit", async () => {
    const world = await PhysicsWorld.create();
    try {
      world.createBox({
        type: "static",
        position: { x: 0, y: -0.5, z: 0 },
        halfExtents: { x: 10, y: 0.5, z: 10 },
      });
      world.createBox({
        type: "static",
        position: { x: 2.5, y: 0.18, z: 0 },
        halfExtents: { x: 2, y: 0.18, z: 2 },
      });
      world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      let state = playerState();
      for (let tick = 0; tick < 30; tick += 1) {
        state = stepPlayerController(
          world,
          state,
          { moveX: 1, moveZ: 0, lookYaw: 0, jumpCounter: 0 },
          PHYSICS_DT,
        );
      }
      expect(state.position.x).toBeLessThan(0.2);
      expect(state.position.y).toBeWithin(0.89, 0.91);
    } finally {
      world.dispose();
    }
  });

  test("accepts a 49-degree slope and rejects a 55-degree slope as ground", async () => {
    for (const [degrees, expectedGrounded] of [
      [49, true],
      [55, false],
    ] as const) {
      const world = await PhysicsWorld.create();
      try {
        const radians = (degrees * Math.PI) / 180;
        world.createBox({
          type: "static",
          position: { x: 0, y: 0, z: 0 },
          halfExtents: { x: 4, y: 0.2, z: 3 },
          rotation: {
            x: 0,
            y: 0,
            z: Math.sin(radians / 2),
            w: Math.cos(radians / 2),
          },
        });
        let state = {
          ...playerState(),
          position: {
            x: 0,
            y: 0.2 / Math.cos(radians) + 0.55 + 0.35 / Math.cos(radians) + 0.01,
            z: 0,
          },
        };
        for (let tick = 0; tick < 90; tick += 1) {
          state = stepPlayerController(
            world,
            state,
            { moveX: 0, moveZ: 0, lookYaw: 0, jumpCounter: 0 },
            PHYSICS_DT,
          );
        }
        expect(state.grounded).toBe(expectedGrounded);
        if (!expectedGrounded) expect(state.position.x).toBeLessThan(-0.1);
      } finally {
        world.dispose();
      }
    }
  });

  test("keeps the player proxy query-visible without making it drive the geometric mover", async () => {
    const world = await PhysicsWorld.create();
    try {
      world.createBox({
        type: "static",
        position: { x: 0, y: -0.5, z: 0 },
        halfExtents: { x: 10, y: 0.5, z: 10 },
      });
      world.createPlayerProxy(
        { x: 0, y: PLAYER_HALF_HEIGHT, z: 0 },
        {
          radius: PLAYER_CAPSULE_RADIUS,
          halfSegment: PLAYER_CAPSULE_HALF_SEGMENT,
        },
      );
      world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);

      const moved = world.moveCapsule(
        { x: -2, y: PLAYER_HALF_HEIGHT, z: 0 },
        { x: 4, y: 0, z: 0 },
        {
          radius: PLAYER_CAPSULE_RADIUS,
          halfSegment: PLAYER_CAPSULE_HALF_SEGMENT,
        },
      );
      expect(moved.x).toBeGreaterThan(1.9);
      expect(
        world.raycastClosest(
          { x: -2, y: PLAYER_HALF_HEIGHT, z: 0 },
          { x: 4, y: 0, z: 0 },
          { includePlayerProxies: true },
        )?.fraction,
      ).toBeWithin(0.3, 0.7);
    } finally {
      world.dispose();
    }
  });

  test("keeps sensor hulls non-solid to player geometry queries", async () => {
    const world = await PhysicsWorld.create();
    try {
      world.createSensorHull({
        position: { x: 0, y: PLAYER_HALF_HEIGHT, z: 0 },
        vertices: boxVertices(1),
      });
      const start = { x: -2, y: PLAYER_HALF_HEIGHT, z: 0 };
      const desired = { x: 4, y: 0, z: 0 };
      const capsule = {
        radius: PLAYER_CAPSULE_RADIUS,
        halfSegment: PLAYER_CAPSULE_HALF_SEGMENT,
      };

      expect(world.moveCapsule(start, desired, capsule).x).toBeGreaterThan(1.9);
      expect(world.castCapsule(start, desired, capsule).x).toBeGreaterThan(1.9);
      expect(
        world.capsuleFits({ x: 0, y: PLAYER_HALF_HEIGHT, z: 0 }, capsule),
      ).toBe(true);
      expect(world.raycastClosest(start, desired)).toBeNull();
    } finally {
      world.dispose();
    }
  });

  test("carries a grounded controller with kinematic support point velocity", async () => {
    const world = await PhysicsWorld.create();
    try {
      const platform = world.createBox({
        type: "kinematic",
        position: { x: 0, y: 0.25, z: 0 },
        halfExtents: { x: 2, y: 0.25, z: 2 },
      });
      world.setBodyVelocity(
        platform,
        { x: 2, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      );
      let state = {
        ...playerState(),
        position: { x: 0, y: 1.4, z: 0 },
        grounded: true,
      };
      for (let tick = 0; tick < 60; tick += 1) {
        state = stepPlayerController(
          world,
          state,
          { moveX: 0, moveZ: 0, lookYaw: 0, jumpCounter: 0 },
          PHYSICS_DT,
        );
        world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      }
      const platformX = world.state(platform).position.x;
      expect(platformX).toBeWithin(1.95, 2.05);
      expect(state.position.x).toBeWithin(platformX - 0.08, platformX + 0.08);
      expect(state.position.y).toBeWithin(1.38, 1.42);
    } finally {
      world.dispose();
    }
  });

  test("moves a kinematic proxy through fixed-step position and rotation targets", async () => {
    const world = await PhysicsWorld.create({ gravity: { x: 0, y: 0, z: 0 } });
    try {
      const proxy = world.createBox({
        type: "kinematic",
        position: { x: 0, y: 0, z: 0 },
        halfExtents: { x: 0.5, y: 0.2, z: 0.1 },
      });
      const rotation = {
        x: 0,
        y: Math.sin(Math.PI / 4),
        z: 0,
        w: Math.cos(Math.PI / 4),
      };
      for (let tick = 0; tick < 4; tick += 1) {
        world.setKinematicTargetTransform(
          proxy,
          { x: 1, y: 0.5, z: -0.25 },
          rotation,
          PHYSICS_DT,
        );
        world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      }
      const state = world.state(proxy);
      expect(state.position.x).toBeCloseTo(1, 5);
      expect(state.position.y).toBeCloseTo(0.5, 5);
      expect(state.position.z).toBeCloseTo(-0.25, 5);
      expect(Math.abs(state.rotation.y)).toBeCloseTo(Math.SQRT1_2, 5);
      expect(Math.abs(state.rotation.w)).toBeCloseTo(Math.SQRT1_2, 5);
    } finally {
      world.dispose();
    }
  });

  test("replays the same fixed-step contact fixture to the same authoritative trace", async () => {
    expect(await replay()).toEqual(await replay());
  });

  test("applies a bounded reaction impulse when the controller pushes a dynamic body", async () => {
    const world = await PhysicsWorld.create();
    try {
      world.createBox({
        type: "static",
        position: { x: 0, y: -0.5, z: 0 },
        halfExtents: { x: 10, y: 0.5, z: 10 },
      });
      const crate = world.createBox({
        type: "dynamic",
        position: { x: 1.2, y: 0.5, z: 0 },
        halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
        density: 1,
      });
      for (let tick = 0; tick < 30; tick += 1)
        world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      let state = playerState();
      for (let tick = 0; tick < 45; tick += 1) {
        state = stepPlayerController(
          world,
          state,
          { moveX: 1, moveZ: 0, lookYaw: 0, jumpCounter: 0 },
          PHYSICS_DT,
        );
        world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      }
      expect(world.state(crate).position.x).toBeGreaterThan(1.45);
      expect(world.state(crate).linearVelocity.x).toBeLessThan(8);
    } finally {
      world.dispose();
    }
  });

  test("crouches atomically and refuses to stand into a low ceiling", async () => {
    const world = await PhysicsWorld.create();
    try {
      world.createBox({
        type: "static",
        position: { x: 0, y: -0.5, z: 0 },
        halfExtents: { x: 10, y: 0.5, z: 10 },
      });
      world.createBox({
        type: "static",
        position: { x: 0.5, y: 1.4, z: 0 },
        halfExtents: { x: 2, y: 0.1, z: 2 },
      });
      let state = {
        ...playerState(),
        position: { x: -2, y: 0.9, z: 0 },
        grounded: true,
      };
      state = stepPlayerController(
        world,
        state,
        { moveX: 0, moveZ: 0, lookYaw: 0, jumpCounter: 0, crouch: true },
        PHYSICS_DT,
      );
      expect(state.crouched).toBe(true);
      expect(state.position.y).toBeWithin(0.58, 0.62);

      state = { ...state, position: { x: 0, y: state.position.y, z: 0 } };
      state = stepPlayerController(
        world,
        state,
        { moveX: 0, moveZ: 0, lookYaw: 0, jumpCounter: 0, crouch: false },
        PHYSICS_DT,
      );
      expect(state.crouched).toBe(true);

      state = { ...state, position: { x: -2, y: state.position.y, z: 0 } };
      state = stepPlayerController(
        world,
        state,
        { moveX: 0, moveZ: 0, lookYaw: 0, jumpCounter: 0, crouch: false },
        PHYSICS_DT,
      );
      expect(state.crouched).toBe(false);
      expect(state.position.y).toBeWithin(0.88, 0.92);
    } finally {
      world.dispose();
    }
  });

  test("owns static indexed mesh backing data through body destruction", async () => {
    const world = await PhysicsWorld.create();
    try {
      const mesh = world.createStaticMesh({
        vertices: [
          { x: -4, y: 0, z: -4 },
          { x: 4, y: 0, z: -4 },
          { x: 4, y: 0, z: 4 },
          { x: -4, y: 0, z: 4 },
        ],
        triangles: [
          [0, 2, 1],
          [0, 3, 2],
        ],
      });
      const box = world.createBox({
        type: "dynamic",
        position: { x: 0, y: 3, z: 0 },
        halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
      });
      for (let tick = 0; tick < 180; tick += 1)
        world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      expect(world.state(box).position.y).toBeWithin(0.48, 0.52);
      expect(world.destroy(mesh)).toBe(true);
      expect(() => world.state(mesh)).toThrow("stale physics handle");
    } finally {
      world.dispose();
    }
  });

  test("owns static compound and height-field backing resources through destruction", async () => {
    const world = await PhysicsWorld.create();
    try {
      const compound = world.createStaticCompound({
        boxes: [
          {
            position: { x: -1.5, y: 0, z: 0 },
            halfExtents: { x: 1, y: 0.25, z: 2 },
          },
          {
            position: { x: 1.5, y: 0, z: 0 },
            halfExtents: { x: 1, y: 0.25, z: 2 },
          },
        ],
      });
      const heightField = world.createStaticHeightField({
        heights: [0, 0, 0, 0, 0, 0, 0, 0, 0],
        countX: 3,
        countZ: 3,
        scale: { x: 2, y: 1, z: 2 },
      });
      const box = world.createBox({
        type: "dynamic",
        position: { x: -1.5, y: 3, z: 0 },
        halfExtents: { x: 0.25, y: 0.25, z: 0.25 },
      });
      for (let tick = 0; tick < 180; tick += 1)
        world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      expect(world.state(box).position.y).toBeWithin(0.48, 0.53);
      expect(world.destroy(compound)).toBe(true);
      expect(world.destroy(heightField)).toBe(true);
      expect(() => world.state(compound)).toThrow("stale physics handle");
      expect(() => world.state(heightField)).toThrow("stale physics handle");
    } finally {
      world.dispose();
    }
  });

  test("uses multiple convex shapes on one moving body instead of a forbidden dynamic compound", async () => {
    const world = await PhysicsWorld.create();
    try {
      world.createBox({
        type: "static",
        position: { x: 0, y: -0.5, z: 0 },
        halfExtents: { x: 8, y: 0.5, z: 8 },
      });
      const body = world.createCompoundHulls({
        type: "dynamic",
        position: { x: 0, y: 4, z: 0 },
        density: 1,
        hulls: [
          {
            vertices: boxVertices(0.4).map((vertex) => ({
              ...vertex,
              x: vertex.x - 0.6,
            })),
          },
          {
            vertices: boxVertices(0.4).map((vertex) => ({
              ...vertex,
              x: vertex.x + 0.6,
            })),
          },
        ],
      });
      for (let tick = 0; tick < 240; tick += 1)
        world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      const state = world.state(body);
      expect(state.position.y).toBeWithin(0.38, 0.44);
      expect(state.awake).toBe(false);
    } finally {
      world.dispose();
    }
  });

  test("applies surface velocity to every child of a compound conveyor", async () => {
    const world = await PhysicsWorld.create();
    try {
      const conveyor = world.createCompoundHulls({
        type: "static",
        position: { x: 0, y: 0, z: 0 },
        friction: 1,
        hulls: [
          {
            vertices: boxVertices(1).map((vertex) => ({
              x: vertex.x - 1,
              y: vertex.y * 0.25,
              z: vertex.z,
            })),
          },
          {
            vertices: boxVertices(1).map((vertex) => ({
              x: vertex.x + 1,
              y: vertex.y * 0.25,
              z: vertex.z,
            })),
          },
        ],
      });
      world.setSurfaceVelocity(conveyor, { x: 2, y: 0, z: 0 });
      expect(world.pointVelocity(conveyor, { x: 0, y: 0.25, z: 0 })).toEqual({
        x: 2,
        y: 0,
        z: 0,
      });
      const boxes = [-1, 1].map((x) =>
        world.createBox({
          type: "dynamic",
          position: { x, y: 1, z: 0 },
          halfExtents: { x: 0.25, y: 0.25, z: 0.25 },
        }),
      );
      for (let tick = 0; tick < 120; tick += 1)
        world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      for (const [index, box] of boxes.entries())
        expect(world.state(box).position.x).toBeGreaterThan(
          (index === 0 ? -1 : 1) + 0.5,
        );
    } finally {
      world.dispose();
    }
  });

  test("supports native world-anchored hinge and slider motors with stale handles", async () => {
    const world = await PhysicsWorld.create({ gravity: { x: 0, y: 0, z: 0 } });
    try {
      const hingeBody = world.createBox({
        type: "dynamic",
        position: { x: 0, y: 2, z: 0 },
        halfExtents: { x: 1, y: 0.2, z: 0.2 },
      });
      const identity = { x: 0, y: 0, z: 0, w: 1 };
      const hinge = world.createRevoluteConstraint({
        bodyA: hingeBody,
        localFrameA: { position: { x: 0, y: 0, z: 0 }, rotation: identity },
        localFrameB: { position: { x: 0, y: 2, z: 0 }, rotation: identity },
        limit: { lowerAngle: -Math.PI, upperAngle: Math.PI },
        motor: { mode: "target-velocity", targetVelocity: 2, maxTorque: 100 },
      });
      const sliderBody = world.createBox({
        type: "dynamic",
        position: { x: 0, y: 4, z: 0 },
        halfExtents: { x: 0.25, y: 0.25, z: 0.25 },
      });
      const slider = world.createPrismaticConstraint({
        bodyA: sliderBody,
        localFrameA: { position: { x: 0, y: 0, z: 0 }, rotation: identity },
        localFrameB: { position: { x: 0, y: 4, z: 0 }, rotation: identity },
        limit: { lowerTranslation: -2, upperTranslation: 2 },
        motor: { mode: "target-velocity", targetVelocity: 1, maxForce: 100 },
      });
      for (let tick = 0; tick < 60; tick += 1)
        world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      expect(Math.abs(world.state(hingeBody).rotation.z)).toBeGreaterThan(0.2);
      expect(world.state(sliderBody).position.x).toBeWithin(0.3, 0.8);
      world.setRevoluteMotor(hinge, {
        mode: "target-angle",
        targetAngle: 0,
        hertz: 6,
        dampingRatio: 1,
      });
      world.setPrismaticMotor(slider, {
        mode: "target-position",
        targetPosition: 0,
        hertz: 6,
        dampingRatio: 1,
      });
      for (let tick = 0; tick < 120; tick += 1)
        world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      expect(Math.abs(world.state(sliderBody).position.x)).toBeLessThan(0.1);
      expect(world.destroy(hingeBody)).toBe(true);
      expect(() => world.setRevoluteMotor(hinge, { mode: "none" })).toThrow(
        "stale constraint handle",
      );
    } finally {
      world.dispose();
    }
  });

  test("solves spherical, weld, rope, rod, and spring constraints natively", async () => {
    const world = await PhysicsWorld.create({ gravity: { x: 0, y: 0, z: 0 } });
    try {
      const identity = { x: 0, y: 0, z: 0, w: 1 };
      const frame = (position = { x: 0, y: 0, z: 0 }) => ({
        position,
        rotation: identity,
      });
      const sphericalBody = world.createBox({
        type: "dynamic",
        position: { x: 0, y: 0, z: 0 },
        halfExtents: { x: 0.2, y: 0.2, z: 0.2 },
      });
      const weldBody = world.createBox({
        type: "dynamic",
        position: { x: 2, y: 0, z: 0 },
        halfExtents: { x: 0.2, y: 0.2, z: 0.2 },
      });
      const ropeBody = world.createBox({
        type: "dynamic",
        position: { x: 5, y: 0, z: 0 },
        halfExtents: { x: 0.2, y: 0.2, z: 0.2 },
      });
      const springBody = world.createBox({
        type: "dynamic",
        position: { x: 8, y: 0, z: 0 },
        halfExtents: { x: 0.2, y: 0.2, z: 0.2 },
      });
      const rodBody = world.createBox({
        type: "dynamic",
        position: { x: 10, y: 0, z: 0 },
        halfExtents: { x: 0.2, y: 0.2, z: 0.2 },
      });
      world.createSphericalConstraint({
        bodyA: sphericalBody,
        localFrameA: frame(),
        localFrameB: frame(),
      });
      world.createWeldConstraint({
        bodyA: weldBody,
        localFrameA: frame(),
        localFrameB: frame({ x: 2, y: 0, z: 0 }),
      });
      world.createConfigurableDistanceConstraint({
        bodyA: ropeBody,
        localFrameA: frame(),
        localFrameB: frame(),
        length: 2,
        mode: "rope",
      });
      const spring = world.createConfigurableDistanceConstraint({
        bodyA: springBody,
        localFrameA: frame(),
        localFrameB: frame({ x: 6, y: 0, z: 0 }),
        length: 2,
        mode: "spring",
        hertz: 4,
        dampingRatio: 0.8,
        maxForce: 100,
      });
      world.createConfigurableDistanceConstraint({
        bodyA: rodBody,
        localFrameA: frame(),
        localFrameB: frame({ x: 8, y: 0, z: 0 }),
        length: 2,
        mode: "rod",
      });
      for (const body of [
        sphericalBody,
        weldBody,
        ropeBody,
        springBody,
        rodBody,
      ])
        world.applyLinearImpulse(body, { x: 0, y: 4, z: 0 });
      for (let tick = 0; tick < 180; tick += 1)
        world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      expect(
        Math.hypot(...Object.values(world.state(sphericalBody).position)),
      ).toBeLessThan(0.05);
      expect(world.state(weldBody).position.x).toBeWithin(1.95, 2.05);
      expect(
        Math.hypot(...Object.values(world.state(ropeBody).position)),
      ).toBeLessThan(2.05);
      expect(world.state(springBody).position.x).toBeWithin(7.9, 8.1);
      expect(
        Math.hypot(
          world.state(rodBody).position.x - 8,
          world.state(rodBody).position.y,
        ),
      ).toBeWithin(1.95, 2.05);
      expect(world.destroyConstraint(spring)).toBe(true);
      expect(world.destroyConstraint(spring)).toBe(false);
    } finally {
      world.dispose();
    }
  });

  test("supports compound sensors and per-body gravity scale", async () => {
    const world = await PhysicsWorld.create();
    try {
      const sensor = world.createSensorHulls({
        position: { x: 0, y: 1, z: 0 },
        hulls: [
          { vertices: boxVertices(1) },
          {
            vertices: boxVertices(1).map((vertex) => ({
              ...vertex,
              x: vertex.x + 1,
            })),
          },
        ],
      });
      const proxy = world.createPlayerProxy(
        { x: 0.5, y: 1, z: 0 },
        { radius: 0.35, halfSegment: 0.2 },
      );
      const normal = world.createBox({
        type: "dynamic",
        position: { x: -3, y: 5, z: 0 },
        halfExtents: { x: 0.2, y: 0.2, z: 0.2 },
      });
      const light = world.createBox({
        type: "dynamic",
        position: { x: -4, y: 5, z: 0 },
        halfExtents: { x: 0.2, y: 0.2, z: 0.2 },
      });
      world.setGravityScale(light, 0.25);
      const events = world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      expect(
        events.sensorBegin.filter(
          (event) => keyId(event.sensor) === keyId(sensor),
        ),
      ).toHaveLength(2);
      expect(
        events.sensorBegin.every(
          (event) => keyId(event.visitor) === keyId(proxy),
        ),
      ).toBe(true);
      for (let tick = 0; tick < 59; tick += 1)
        world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      expect(world.state(normal).position.y).toBeLessThan(
        world.state(light).position.y - 2,
      );
    } finally {
      world.dispose();
    }
  });

  test("owns distance constraints and invalidates them with an attached body", async () => {
    const world = await PhysicsWorld.create();
    try {
      const anchor = world.createBox({
        type: "kinematic",
        position: { x: 0, y: 5, z: 0 },
        halfExtents: { x: 0.1, y: 0.1, z: 0.1 },
      });
      const body = world.createBox({
        type: "dynamic",
        position: { x: 3, y: 5, z: 0 },
        halfExtents: { x: 0.4, y: 0.4, z: 0.4 },
        density: 1,
      });
      const constraint = world.createDistanceConstraint({
        bodyA: anchor,
        bodyB: body,
        worldAnchorA: { x: 0, y: 5, z: 0 },
        worldAnchorB: { x: 3, y: 5, z: 0 },
        length: 1,
        maxForce: 200,
      });
      for (let tick = 0; tick < 120; tick += 1)
        world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      expect(
        Math.hypot(
          world.state(body).position.x - world.state(anchor).position.x,
          world.state(body).position.y - world.state(anchor).position.y,
        ),
      ).toBeWithin(0.8, 1.2);
      expect(world.destroy(body)).toBe(true);
      expect(world.destroyConstraint(constraint)).toBe(false);
    } finally {
      world.dispose();
    }
  });

  test("manipulates a dynamic body through a private native control joint", async () => {
    const world = await PhysicsWorld.create({ gravity: { x: 0, y: 0, z: 0 } });
    try {
      const body = world.createBox({
        type: "dynamic",
        position: { x: 0, y: 0, z: 0 },
        halfExtents: { x: 0.5, y: 0.15, z: 0.15 },
        density: 2,
      });
      const control = world.createControlConstraint({
        body,
        localAnchor: { x: 0.45, y: 0, z: 0 },
        targetPosition: { x: 0.45, y: 0, z: 0 },
        targetRotation: { x: 0, y: 0, z: 0, w: 1 },
      });
      world.setControlTarget(
        control,
        { x: 0.45, y: 1.5, z: 0 },
        { x: 0, y: 0, z: Math.sin(Math.PI / 4), w: Math.cos(Math.PI / 4) },
      );
      for (let tick = 0; tick < 120; tick += 1)
        world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      const state = world.state(body);
      expect(state.position.y).toBeGreaterThan(1);
      expect(Math.abs(state.rotation.z)).toBeGreaterThan(0.4);
      expect(world.destroyConstraint(control)).toBe(true);
      expect(() =>
        world.setControlTarget(
          control,
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 0, w: 1 },
        ),
      ).toThrow("stale constraint handle");
    } finally {
      world.dispose();
    }
  });

  test("drives light and heavy bodies to a target without mass-dependent lag", async () => {
    const world = await PhysicsWorld.create({ gravity: { x: 0, y: 0, z: 0 } });
    try {
      const bodies = [1, 8].map((density, index) =>
        world.createBox({
          type: "dynamic",
          position: { x: 3, y: index * 2, z: 0 },
          halfExtents: { x: 0.3, y: 0.3, z: 0.3 },
          density,
        }),
      );
      for (let tick = 0; tick < 60; tick += 1) {
        for (const [index, body] of bodies.entries())
          world.driveBodyToTarget(body, {
            targetPosition: { x: 0, y: index * 2, z: 0 },
            targetRotation: { x: 0, y: 0, z: 0, w: 1 },
            linearGain: 10,
            maxLinearSpeed: 12,
            maxLinearAcceleration: 50,
            angularGain: 8,
            maxAngularSpeed: Math.PI * 2,
            maxAngularAcceleration: Math.PI * 8,
            seconds: PHYSICS_DT,
          });
        world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      }
      const errors = bodies.map((body) =>
        Math.abs(world.state(body).position.x),
      );
      expect(errors[0]!).toBeLessThan(0.08);
      expect(errors[1]!).toBeLessThan(0.08);
      expect(Math.abs(errors[0]! - errors[1]!)).toBeLessThan(0.02);

      expect(
        world.driveBodyToTarget(bodies[0]!, {
          targetPosition: { x: -1, y: 0, z: 0 },
          targetRotation: { x: 0, y: 0, z: 0, w: 1 },
          linearGain: 10,
          maxLinearSpeed: 12,
          maxLinearAcceleration: 50,
          angularGain: 8,
          maxAngularSpeed: Math.PI * 2,
          maxAngularAcceleration: Math.PI * 8,
          seconds: PHYSICS_DT,
        }),
      ).toBe(true);
      for (let tick = 0; tick < 30; tick += 1) {
        world.driveBodyToTarget(bodies[0]!, {
          targetPosition: { x: -1, y: 0, z: 0 },
          targetRotation: { x: 0, y: 0, z: 0, w: 1 },
          linearGain: 10,
          maxLinearSpeed: 12,
          maxLinearAcceleration: 50,
          angularGain: 8,
          maxAngularSpeed: Math.PI * 2,
          maxAngularAcceleration: Math.PI * 8,
          seconds: PHYSICS_DT,
        });
        world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      }
      expect(world.state(bodies[0]!).position.x).toBeLessThan(-0.9);
      expect(() =>
        world.driveBodyToTarget(bodies[0]!, {
          targetPosition: { x: Number.NaN, y: 0, z: 0 },
          targetRotation: { x: 0, y: 0, z: 0, w: 1 },
          linearGain: 10,
          maxLinearSpeed: 12,
          maxLinearAcceleration: 50,
          angularGain: 8,
          maxAngularSpeed: Math.PI * 2,
          maxAngularAcceleration: Math.PI * 8,
          seconds: PHYSICS_DT,
        }),
      ).toThrow("pose must be finite");
    } finally {
      world.dispose();
    }
  });

  test("raycasts past an ignored dynamic body to the nearest obstruction", async () => {
    const world = await PhysicsWorld.create();
    try {
      const wall = world.createBox({
        type: "static",
        position: { x: 2, y: 1, z: 0 },
        halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
      });
      const ignored = world.createBox({
        type: "dynamic",
        position: { x: 1, y: 1, z: 0 },
        halfExtents: { x: 0.2, y: 0.2, z: 0.2 },
      });
      const hit = world.raycastClosest(
        { x: 0, y: 1, z: 0 },
        { x: 4, y: 0, z: 0 },
        { ignoreBodies: [ignored] },
      );
      expect(hit?.body).toEqual(wall);
      expect(hit?.fraction).toBeWithin(0.37, 0.38);
      expect(hit?.point.x).toBeWithin(1.49, 1.51);
    } finally {
      world.dispose();
    }
  });

  test("reports allocation-free sensor lifecycle against player proxies", async () => {
    const world = await PhysicsWorld.create();
    try {
      const sensor = world.createSensorHull({
        position: { x: 0, y: PLAYER_HALF_HEIGHT, z: 0 },
        vertices: boxVertices(1),
      });
      const player = world.createPlayerProxy(
        { x: 0, y: PLAYER_HALF_HEIGHT, z: 0 },
        {
          radius: PLAYER_CAPSULE_RADIUS,
          halfSegment: PLAYER_CAPSULE_HALF_SEGMENT,
        },
      );
      const entered = world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      expect(entered.sensorBegin).toContainEqual({ sensor, visitor: player });
      world.setBodyTransform(
        player,
        { x: 5, y: PLAYER_HALF_HEIGHT, z: 0 },
        { x: 0, y: 0, z: 0, w: 1 },
      );
      const exited = world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      expect(exited.sensorEnd).toContainEqual({ sensor, visitor: player });
    } finally {
      world.dispose();
    }
  });

  test("drops stale Box3D events after a contacted body is destroyed", async () => {
    const world = await PhysicsWorld.create();
    try {
      const ground = world.createBox({
        type: "static",
        position: { x: 0, y: -0.5, z: 0 },
        halfExtents: { x: 5, y: 0.5, z: 5 },
      });
      const body = world.createBox({
        type: "dynamic",
        position: { x: 0, y: 0.5, z: 0 },
        halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
      });
      const entered = world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      expect(
        entered.contactBegin.some(
          ({ a, b }) =>
            [keyId(a), keyId(b)].includes(keyId(ground)) &&
            [keyId(a), keyId(b)].includes(keyId(body)),
        ),
      ).toBe(true);

      expect(world.destroy(body)).toBe(true);
      const afterDestroy = world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      const emittedIds = [
        ...afterDestroy.contactBegin.flatMap(({ a, b }) => [a, b]),
        ...afterDestroy.contactEnd.flatMap(({ a, b }) => [a, b]),
        ...afterDestroy.contactHit.flatMap(({ a, b }) => [a, b]),
        ...afterDestroy.moved.map(({ body: movedBody }) => movedBody),
      ];
      expect(emittedIds.map(keyId)).not.toContain(keyId(body));
    } finally {
      world.dispose();
    }
  });

  test("reports packed contact, movement, hit, and sleep transitions", async () => {
    const world = await PhysicsWorld.create();
    try {
      const ground = world.createBox({
        type: "static",
        position: { x: 0, y: -0.5, z: 0 },
        halfExtents: { x: 5, y: 0.5, z: 5 },
      });
      const body = world.createBox({
        type: "dynamic",
        position: { x: 0, y: 3, z: 0 },
        halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
        density: 1,
      });
      let began = false;
      let hit = false;
      let moved = false;
      let slept = false;
      for (let tick = 0; tick < 600 && !slept; tick += 1) {
        const events = world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
        began ||= events.contactBegin.some(
          (event) =>
            [keyId(event.a), keyId(event.b)].includes(keyId(ground)) &&
            [keyId(event.a), keyId(event.b)].includes(keyId(body)),
        );
        hit ||= events.contactHit.some(
          (event) =>
            keyId(event.a) === keyId(body) || keyId(event.b) === keyId(body),
        );
        moved ||= events.moved.some(
          (event) => keyId(event.body) === keyId(body),
        );
        slept ||= events.moved.some(
          (event) => keyId(event.body) === keyId(body) && event.fellAsleep,
        );
      }
      expect({ began, hit, moved, slept }).toEqual({
        began: true,
        hit: true,
        moved: true,
        slept: true,
      });
    } finally {
      world.dispose();
    }
  });
});

function keyId(id: { index: number; generation: number }): string {
  return `${id.index}:${id.generation}`;
}

function boxVertices(half: number) {
  return [-half, half].flatMap((x) =>
    [-half, half].flatMap((y) => [-half, half].map((z) => ({ x, y, z }))),
  );
}

function playerState(): PlayerControllerState {
  return {
    position: { x: 0, y: 0.9, z: 0 },
    verticalVelocity: 0,
    yaw: 0,
    grounded: false,
    lastJumpCounter: 0,
    stepCooldown: 0,
    crouched: false,
  };
}
