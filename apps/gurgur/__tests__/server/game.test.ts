import { describe, expect, test } from "bun:test";
import { compileWorld, type WorldBundle } from "@harrhy/gurgur-game";
import {
  PHYSICS_DT,
  PHYSICS_HZ,
  NETWORK_FLAG_ACTIVE,
  NETWORK_FLAG_HELD,
  PROTOCOL_VERSION,
  type InputCommand,
  type ManipulationRequestMessage,
  type NetworkBodyState,
  type NetworkPlayerState,
  type RuntimeId,
} from "@harrhy/gurgur-engine";
import {
  NETWORK_TRACE_DURATION_SECONDS,
  WorldHost,
} from "../../server/src/game";
import { WorldStore } from "../../server/src/store";

const fixtures = [
  "network-boxes",
  "network-push-corridor",
  "network-stack-tower",
  "network-domino-field",
] as const;

describe("per-object authority host", () => {
  test("loads every interaction fixture and simulates every unowned body at fixed steps", async () => {
    for (const name of fixtures) {
      const bundle = await fixture(name);
      const store = new WorldStore(":memory:");
      const game = await WorldHost.create(
        store,
        () => {},
        () => {},
        { worldBundle: bundle },
      );
      try {
        const expectedBodies = bundle.entities.filter(
          (entity) => entity.body !== null,
        ).length;
        expect(game.worldMessage().runtimeEntities).toHaveLength(
          expectedBodies,
        );
        for (let tick = 0; tick < 360; tick += 1) game.advance(PHYSICS_DT);
        const snapshot = game.snapshot();
        expect(snapshot.bodies).toHaveLength(expectedBodies);
        for (const snapshotBody of snapshot.bodies) {
          expect(
            [
              ...Object.values(snapshotBody.position),
              ...Object.values(snapshotBody.rotation),
              ...Object.values(snapshotBody.linearVelocity ?? {}),
              ...Object.values(snapshotBody.angularVelocity ?? {}),
            ].every(Number.isFinite),
          ).toBe(true);
          expect(snapshotBody.position.y).toBeGreaterThan(-0.1);
        }
      } finally {
        game.stop();
        store.close();
      }
    }
  });

  test("owns player truth, consumes ordered commands once, and checkpoints acknowledgements", async () => {
    const store = new WorldStore(":memory:");
    const game = await WorldHost.create(
      store,
      () => {},
      () => {},
    );
    try {
      const player = game.connectPlayer("server-player");
      const initial = playerState(game, player);
      expect(descriptorFor(game, player).ownerPlayerId).toBeNull();
      expect(game.acceptInput(player, input(game, 1))).toBe(true);
      expect(game.acceptInput(player, input(game, 1))).toBe(true);
      expect(game.acceptInput(player, input(game, 10_000))).toBe(false);
      game.advance(PHYSICS_DT);
      const first = game.predictionCheckpoint(player)!;
      expect(first.lastProcessedInputSequence).toBe(1);
      expect(first.serverTick).toBe(game.serverTick);
      expect(first.player.position).not.toEqual(initial.position);

      const action = { ...input(game, 2), jumpCounter: 1 };
      expect(game.acceptInput(player, action)).toBe(true);
      game.advance(PHYSICS_DT);
      const afterAction = game.predictionCheckpoint(player)!;
      expect(afterAction.lastProcessedInputSequence).toBe(2);
      expect(afterAction.player.lastJumpCounter).toBe(1);
      game.advance(PHYSICS_DT);
      expect(game.predictionCheckpoint(player)!.player.lastJumpCounter).toBe(1);
    } finally {
      game.stop();
      store.close();
    }
  });

  test("records a bounded 15-second authoritative physics timeline for one player", async () => {
    const bundle = await fixture("network-push-corridor");
    const store = new WorldStore(":memory:");
    const game = await WorldHost.create(
      store,
      () => {},
      () => {},
      { worldBundle: bundle },
    );
    try {
      const player = game.connectPlayer("physics-trace-player");
      const started = game.startPhysicsTrace(player);
      const durationTicks = NETWORK_TRACE_DURATION_SECONDS * PHYSICS_HZ;
      for (let tick = 0; tick < durationTicks; tick += 1) {
        game.acceptInput(player, input(game, tick));
        game.advance(PHYSICS_DT);
      }
      const capture = game.physicsTrace(started.id)!;
      expect(game.physicsTraceStatus(started.id)).toEqual({
        complete: true,
        startedAtServerTick: capture.startedAtServerTick,
        endingAtServerTick: capture.endingAtServerTick,
        completedAtServerTick: capture.endingAtServerTick,
        frameCount: durationTicks,
      });
      expect(capture.complete).toBe(true);
      expect(capture.endReason).toBe("duration");
      expect(capture.frames).toHaveLength(durationTicks);
      expect(capture.frames[0]!.serverTick).toBe(capture.startedAtServerTick);
      expect(capture.frames.at(-1)!.serverTick).toBe(
        capture.endingAtServerTick,
      );
      expect(capture.frames.at(-1)!.input.lastProcessedInputSequence).toBe(
        durationTicks - 1,
      );
      expect(capture.frames.every((frame) => frame.bodies.length <= 32)).toBe(
        true,
      );
      expect(
        capture.frames.every((frame) => frame.player.kind === "player"),
      ).toBe(true);
      capture.frames[0]!.player.position.x = 999;
      expect(
        game.physicsTrace(started.id)!.frames[0]!.player.position.x,
      ).not.toBe(999);
    } finally {
      game.stop();
      store.close();
    }
  });

  test("drives a loose grab through one host control claim without authority transfer", async () => {
    const bundle = await fixture("network-push-corridor");
    const playerSpawn = spawnNear(bundle, "corridor.light");
    const store = new WorldStore(":memory:");
    const published: NetworkBodyState[][] = [];
    const game = await WorldHost.create(
      store,
      (states) =>
        published.push(
          states.filter(
            (state): state is NetworkBodyState => state.kind === "body",
          ),
        ),
      () => {},
      { worldBundle: bundle, playerSpawn },
    );
    try {
      const player = game.connectPlayer("host-grabber");
      const competitor = game.connectPlayer("competing-grabber");
      const target = runtimeId(game, "corridor.light");
      const initial = bodyState(game, target);
      expect(descriptorFor(game, target).transferPolicy).toBe("fixed");
      game.acceptInput(player, grabInput(game, 1, target, 1));
      game.acceptInput(competitor, grabInput(game, 1, target, 1));
      game.advance(PHYSICS_DT);
      expect(game.grabbedTarget(player)).toEqual(target);
      expect(game.grabbedTarget(competitor)).toBeNull();
      expect(descriptorFor(game, target).ownerPlayerId).toBeNull();
      expect(descriptorFor(game, target).authorityVersion).toBe(
        initial.authorityVersion,
      );
      const heldCheckpoint = game.predictionCheckpoint(player)!;
      expect(heldCheckpoint.held?.body.id).toEqual(target);
      expect(
        heldCheckpoint.nearbyBodies.every(
          (body) => key(body.id) !== key(target),
        ),
      ).toBe(true);
      published.length = 0;
      game.acceptInput(player, {
        ...grabInput(game, 2, target, 1),
        lookYaw: 0.7,
      });
      for (let tick = 0; tick < 4; tick += 1) game.advance(PHYSICS_DT);
      const hotTicks = published.flatMap((states) =>
        states
          .filter((state) => key(state.id) === key(target))
          .map((state) => state.sourceTick),
      );
      expect(hotTicks).toHaveLength(4);
      expect(new Set(hotTicks).size).toBe(4);
      for (let tick = 0; tick < 30; tick += 1) game.advance(PHYSICS_DT);
      const controlled = bodyState(game, target);
      expect(
        Math.hypot(
          controlled.position.x - initial.position.x,
          controlled.position.z - initial.position.z,
        ),
      ).toBeGreaterThan(0.1);
      game.acceptInput(player, grabInput(game, 3, target, 2));
      game.advance(PHYSICS_DT);
      const releasedCheckpoint = game.predictionCheckpoint(player)!;
      expect(releasedCheckpoint.held).toBeNull();
      expect(
        releasedCheckpoint.nearbyBodies.some(
          (body) => key(body.id) === key(target),
        ),
      ).toBe(true);
      expect(descriptorFor(game, target).ownerPlayerId).toBeNull();
    } finally {
      game.stop();
      store.close();
    }
  });

  test("prioritizes a held prop's live contact island over nearer loose bodies", async () => {
    const bundle = await fixture("network-push-corridor");
    const store = new WorldStore(":memory:");
    const game = await WorldHost.create(
      store,
      () => {},
      () => {},
      { worldBundle: bundle, playerSpawn: { x: 0, y: 0.9, z: 1.2 } },
    );
    try {
      const player = game.connectPlayer("contact-priority-player");
      const archetype = game.devPropArchetypes()[0];
      if (!archetype) throw new Error("fixture has no loose prop archetype");
      const target = game.spawnDevProp(archetype.entityIndex, {
        x: 0,
        y: 0.61,
        z: 0,
      });
      const contact = game.spawnDevProp(archetype.entityIndex, {
        x: 0.82,
        y: 0.61,
        z: 0,
      });
      for (const position of [
        { x: -0.8, y: 0.61, z: 1.2 },
        { x: 0.8, y: 0.61, z: 1.2 },
        { x: -0.8, y: 0.61, z: 2 },
        { x: 0.8, y: 0.61, z: 2 },
      ])
        game.spawnDevProp(archetype.entityIndex, position);
      for (let tick = 0; tick < 30; tick += 1) game.advance(PHYSICS_DT);

      game.acceptInput(player, grabInput(game, 1, target.id, 1));
      game.advance(PHYSICS_DT);
      const checkpoint = game.predictionCheckpoint(player)!;
      expect(checkpoint.held?.body.id).toEqual(target.id);
      expect(
        checkpoint.nearbyBodies.some(
          (body) => key(body.id) === key(contact.id),
        ),
      ).toBe(true);
    } finally {
      game.stop();
      store.close();
    }
  });

  test("ends a loose-prop claim on disconnect and permits a new first-wins claim", async () => {
    const bundle = await fixture("network-push-corridor");
    const playerSpawn = spawnNear(bundle, "corridor.light");
    const store = new WorldStore(":memory:");
    const game = await WorldHost.create(
      store,
      () => {},
      () => {},
      { worldBundle: bundle, playerSpawn },
    );
    try {
      const disconnected = game.connectPlayer("disconnect-holder");
      const successor = game.connectPlayer("successor");
      const target = runtimeId(game, "corridor.light");
      game.acceptInput(disconnected, grabInput(game, 1, target, 1));
      game.advance(PHYSICS_DT);
      expect(game.grabbedTarget(disconnected)).toEqual(target);
      expect(game.releasePlayerGrab(disconnected)).toEqual(target);
      game.acceptInput(successor, grabInput(game, 1, target, 1));
      game.advance(PHYSICS_DT);
      expect(game.grabbedTarget(successor)).toEqual(target);
      expect(descriptorFor(game, target).ownerPlayerId).toBeNull();
    } finally {
      game.stop();
      store.close();
    }
  });

  test("reconnect and reset publish fresh player authority assignments", async () => {
    const store = new WorldStore(":memory:");
    const worlds: number[] = [];
    const game = await WorldHost.create(
      store,
      () => {},
      (world) => worlds.push(world.worldEpoch),
    );
    try {
      const player = game.connectPlayer("reconnect-player");
      const initial = playerState(game, player);
      const reassigned = game.reassignPlayer(player);
      expect(reassigned?.authorityVersion).toBe(initial.authorityVersion + 1);
      expect(game.acceptInput(player, input(game, 1))).toBe(true);

      const oldEpoch = game.worldEpoch;
      game.reset();
      expect(game.worldEpoch).toBe(oldEpoch + 1);
      expect(worlds).toEqual([oldEpoch + 1]);
      expect(playerState(game, player).authorityVersion).toBe(
        reassigned!.authorityVersion + 1,
      );
    } finally {
      game.stop();
      store.close();
    }
  });

  test("keeps compiled contraption graphs fixed and rebuilds them across reset", async () => {
    const path = "content/maps/fixtures/physics-contraptions.map";
    const bundle = compileWorld(await Bun.file(path).text(), path);
    const store = new WorldStore(":memory:");
    const game = await WorldHost.create(
      store,
      () => {},
      () => {},
      { worldBundle: bundle },
    );
    try {
      const world = game.worldMessage();
      const bodyDescriptors = world.runtimeEntities.filter(
        (entity) => entity.kind === "world-entity",
      );
      for (const descriptor of bodyDescriptors) {
        expect(descriptor.transferPolicy).toBe("fixed");
      }
      expect(
        descriptorFor(game, runtimeId(game, "fixture.trebuchet.projectile"))
          .transferPolicy,
      ).toBe("fixed");
      const conveyor = runtimeId(game, "fixture.conveyor");
      expect(bodyState(game, conveyor).flags & NETWORK_FLAG_ACTIVE).toBe(
        NETWORK_FLAG_ACTIVE,
      );
      for (let tick = 0; tick < 180; tick += 1) game.advance(PHYSICS_DT);
      expect(
        game
          .snapshot()
          .bodies.every((body) =>
            [
              ...Object.values(body.position),
              ...Object.values(body.rotation),
            ].every(Number.isFinite),
          ),
      ).toBe(true);
      const oldEpoch = game.worldEpoch;
      game.reset();
      expect(game.worldEpoch).toBe(oldEpoch + 1);
      expect(
        bodyState(game, runtimeId(game, "fixture.conveyor")).flags &
          NETWORK_FLAG_ACTIVE,
      ).toBe(NETWORK_FLAG_ACTIVE);
    } finally {
      game.stop();
      store.close();
    }
  });

  test("manipulates a jointed body on the host with an exclusive disposable claim", async () => {
    const path = "content/maps/fixtures/physics-contraptions.map";
    const bundle = compileWorld(await Bun.file(path).text(), path);
    const store = new WorldStore(":memory:");
    const game = await WorldHost.create(
      store,
      () => {},
      () => {},
      {
        worldBundle: bundle,
        playerSpawn: spawnNear(bundle, "fixture.lever.body"),
      },
    );
    try {
      const first = game.connectPlayer("lever-first");
      const second = game.connectPlayer("lever-second");
      const target = runtimeId(game, "fixture.lever.body");
      const initial = bodyState(game, target);
      const request: ManipulationRequestMessage = {
        type: "manipulation-request",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: game.worldEpoch,
        requestId: 31,
        target,
        authorityVersion: initial.authorityVersion,
        localAnchor: { x: 0, y: 0, z: 0 },
        holdDistance: 1.5,
      };
      const granted = game.requestManipulation(first, request);
      expect(typeof granted).not.toBe("string");
      if (typeof granted === "string") throw new Error(granted);
      expect(granted.manipulatorPlayerId).toEqual(first);
      expect(
        game.requestManipulation(second, { ...request, requestId: 32 }),
      ).toBe("busy");
      expect(bodyState(game, target).flags & NETWORK_FLAG_HELD).toBe(
        NETWORK_FLAG_HELD,
      );
      expect(
        game.acceptManipulationState(first, {
          worldEpoch: game.worldEpoch,
          target,
          authorityVersion: initial.authorityVersion,
          claimVersion: granted.claimVersion,
          stateSequence: 1,
          targetPosition: {
            x: initial.position.x,
            y: initial.position.y + 0.75,
            z: initial.position.z,
          },
          targetRotation: { x: 0, y: 0, z: 0, w: 1 },
        }),
      ).toBe(true);
      expect(
        game.acceptManipulationState(second, {
          worldEpoch: game.worldEpoch,
          target,
          authorityVersion: initial.authorityVersion,
          claimVersion: granted.claimVersion,
          stateSequence: 2,
          targetPosition: initial.position,
          targetRotation: initial.rotation,
        }),
      ).toBe(false);
      game.advance(PHYSICS_DT);
      const released = game.endManipulationsForPlayer(first);
      expect(released).toHaveLength(1);
      expect(released[0]!.manipulatorPlayerId).toBeNull();
      expect(bodyState(game, target).flags & NETWORK_FLAG_HELD).toBe(0);
      expect(descriptorFor(game, target).ownerPlayerId).toBeNull();
      expect(descriptorFor(game, target).authorityVersion).toBe(
        initial.authorityVersion,
      );
    } finally {
      game.stop();
      store.close();
    }
  });

  test("persists bodies by authored identity and invalidates runtime generations on reset", async () => {
    const bundle = await fixture("network-domino-field");
    const store = new WorldStore(":memory:");
    const first = await WorldHost.create(
      store,
      () => {},
      () => {},
      { worldBundle: bundle },
    );
    for (let tick = 0; tick < 240; tick += 1) first.advance(PHYSICS_DT);
    const saved = first.snapshot();
    const oldIds = new Set(
      first.worldMessage().runtimeEntities.map(({ id }) => key(id)),
    );
    first.stop();

    const restored = await WorldHost.create(
      store,
      () => {},
      () => {},
      { worldBundle: bundle },
    );
    try {
      expect(
        restored.snapshot().bodies.map(({ position }) => position),
      ).toEqual(saved.bodies.map(({ position }) => position));
      const reset = restored.reset();
      expect(restored.worldEpoch).toBe(saved.worldEpoch + 1);
      expect(
        restored
          .worldMessage()
          .runtimeEntities.every(({ id }) => !oldIds.has(key(id))),
      ).toBe(true);
      expect(reset.bodies).toHaveLength(
        restored.worldMessage().runtimeEntities.length,
      );
    } finally {
      restored.stop();
      store.close();
    }
  });
});

function input(game: WorldHost, sequence: number): InputCommand {
  return {
    type: "input" as const,
    protocolVersion: PROTOCOL_VERSION,
    worldEpoch: game.worldEpoch,
    sequence,
    clientTick: sequence,
    moveX: 1,
    moveZ: 0,
    lookYaw: 0,
    lookPitch: 0,
    buttons: 0,
    jumpCounter: 0,
    interactCounter: 0,
    interactTarget: null,
    primaryCounter: 0,
  };
}

function grabInput(
  game: WorldHost,
  sequence: number,
  target: RuntimeId,
  primaryCounter: number,
): InputCommand {
  return {
    ...input(game, sequence),
    moveX: 0,
    lookPitch: -0.18,
    interactTarget: { ...target },
    primaryCounter,
  };
}

function spawnNear(bundle: WorldBundle, authoredId: string) {
  const entity = bundle.entities.find(
    (candidate) => candidate.authoredId === authoredId,
  );
  const brush = entity?.body
    ? bundle.brushes[entity.body.brushIndices[0]!]
    : null;
  if (!brush) throw new Error(`spawn target is unavailable: ${authoredId}`);
  return {
    x: brush.center.x,
    y: 0.9,
    z: brush.center.z + 1.2,
  };
}

function playerState(game: WorldHost, id: RuntimeId): NetworkPlayerState {
  const state = game
    .bootstrapStates()
    .find(
      (candidate): candidate is NetworkPlayerState =>
        candidate.kind === "player" && same(candidate.id, id),
    );
  if (!state) throw new Error("player state is unavailable");
  return structuredClone(state);
}

function bodyState(game: WorldHost, id: RuntimeId): NetworkBodyState {
  const state = game
    .bootstrapStates()
    .find(
      (candidate): candidate is NetworkBodyState =>
        candidate.kind === "body" && same(candidate.id, id),
    );
  if (!state) throw new Error("body state is unavailable");
  return structuredClone(state);
}

function descriptorFor(game: WorldHost, id: RuntimeId) {
  const descriptor = game
    .worldMessage()
    .runtimeEntities.find((candidate) => same(candidate.id, id));
  if (!descriptor) throw new Error("runtime descriptor is unavailable");
  return descriptor;
}

function runtimeId(game: WorldHost, authoredId: string): RuntimeId {
  const world = game.worldMessage();
  const runtime = world.runtimeEntities.find(
    (candidate) =>
      candidate.kind === "world-entity" &&
      world.bundle.entities[candidate.entityIndex]?.authoredId === authoredId,
  );
  if (!runtime) throw new Error(`runtime entity is unavailable: ${authoredId}`);
  return { ...runtime.id };
}

function same(left: RuntimeId, right: RuntimeId): boolean {
  return left.index === right.index && left.generation === right.generation;
}

function key(id: RuntimeId): string {
  return `${id.index}:${id.generation}`;
}

async function fixture(name: (typeof fixtures)[number]): Promise<WorldBundle> {
  const path = `content/maps/fixtures/${name}.map`;
  return compileWorld(await Bun.file(path).text(), path);
}
