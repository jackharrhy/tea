import { expect, spyOn, test } from "bun:test";
import {
  NETWORK_FLAG_AWAKE,
  PHYSICS_DT,
  PhysicsWorld,
  PROTOCOL_VERSION,
  type NetworkBodyState,
  type NetworkPlayerState,
  type PredictionCheckpointPacket,
} from "@harrhy/gurgur-engine";
import { compileWorld, type WorldMessage } from "@harrhy/gurgur-game";
import type {
  PhysicsWorkerRequest,
  PhysicsWorkerResponse,
} from "../../web/src/ownership-client";

test("worker rejects stale checkpoints and preserves the newest body when prediction ends", async () => {
  const bundle = compileWorld(
    await Bun.file("content/maps/fixtures/network-boxes.map").text(),
    "network-boxes.map",
  );
  const entityIndex = bundle.entities.findIndex(
    (entity) => entity.kind === "physics-prop",
  );
  const body: NetworkBodyState = {
    kind: "body",
    id: { index: 1, generation: 1 },
    authorityVersion: 1,
    stateSequence: 0,
    sourceTick: 0,
    position: { x: 2, y: 0.4064, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    linearVelocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    flags: NETWORK_FLAG_AWAKE,
  };
  const player: NetworkPlayerState = {
    ...body,
    kind: "player",
    id: { index: 100, generation: 1 },
    position: { x: 0, y: 0.9, z: 0 },
    yaw: 0,
    verticalVelocity: 0,
    grounded: true,
    crouched: false,
    lastJumpCounter: 0,
    stepCooldown: 0,
  };
  const world: WorldMessage = {
    type: "world",
    protocolVersion: PROTOCOL_VERSION,
    worldEpoch: 1,
    bundle,
    runtimeEntities: [
      {
        id: player.id,
        kind: "player",
        ownerPlayerId: null,
        authorityVersion: 1,
        transferPolicy: "fixed",
      },
      {
        id: body.id,
        kind: "world-entity",
        entityIndex,
        ownerPlayerId: null,
        authorityVersion: 1,
        transferPolicy: "fixed",
      },
    ],
  };
  const messages: PhysicsWorkerResponse[] = [];
  let receive!: (event: MessageEvent<PhysicsWorkerRequest>) => void;
  let stepWorker!: () => void;
  const previousSelf = Object.getOwnPropertyDescriptor(globalThis, "self")!;
  const createWorld = PhysicsWorld.create.bind(PhysicsWorld);
  let physics: PhysicsWorld | null = null;
  const create = spyOn(PhysicsWorld, "create").mockImplementation(
    async (options) => {
      physics = await createWorld({ gravity: options?.gravity });
      return physics;
    },
  );
  const scope = {
    addEventListener: (_type: string, listener: typeof receive) => {
      receive = listener;
    },
    postMessage: (message: PhysicsWorkerResponse) => messages.push(message),
    setInterval: (callback: () => void) => {
      stepWorker = callback;
      return 0;
    },
  };
  const send = async (data: PhysicsWorkerRequest): Promise<void> => {
    receive(new MessageEvent("message", { data }));
    await Promise.resolve();
  };
  const checkpoint = (
    serverTick: number,
    overrides: Partial<PredictionCheckpointPacket> = {},
  ): PredictionCheckpointPacket => ({
    worldEpoch: 1,
    serverTick,
    lastProcessedInputSequence: 4,
    player: { ...player, sourceTick: serverTick, stateSequence: serverTick },
    nearbyBodies: [],
    held: null,
    ...overrides,
  });
  const localStates = () =>
    messages.filter((message) => message.type === "local-states");
  try {
    Object.defineProperty(globalThis, "self", {
      configurable: true,
      value: scope,
    });
    await import("../../web/src/physics-worker");
    Object.defineProperty(globalThis, "self", previousSelf);
    await send({
      type: "world",
      world,
      states: [player, body],
      localPlayerId: player.id,
      traceEnabled: true,
    });
    for (
      let attempt = 0;
      !messages.some((message) => message.type === "world-ready");
      attempt += 1
    ) {
      if (attempt > 100)
        throw new Error(
          `worker did not initialize: ${JSON.stringify(messages)}`,
        );
      await Bun.sleep(1);
    }
    create.mockRestore();

    const startedAtMs = performance.now();
    const clock = spyOn(performance, "now").mockReturnValue(startedAtMs);
    try {
      stepWorker();
      await send({
        type: "input",
        command: {
          type: "input",
          protocolVersion: PROTOCOL_VERSION,
          worldEpoch: 1,
          sequence: 0,
          clientTick: 0,
          moveX: 0,
          moveZ: 0,
          lookYaw: 0,
          lookPitch: 0,
          buttons: 0,
          jumpCounter: 0,
          primaryCounter: 0,
          interactCounter: 0,
          interactTarget: null,
        },
      });
      clock.mockReturnValue(startedAtMs + PHYSICS_DT * 3_000 + 1);
      stepWorker();
      const produced = localStates();
      expect(produced).toHaveLength(3);
      expect(produced.map((message) => message.inputSequence)).toEqual([
        0, 1, 2,
      ]);
      for (let index = 0; index < produced.length; index += 1)
        expect(
          produced[index]!.producedAtMs - performance.timeOrigin,
        ).toBeCloseTo(startedAtMs + (index + 1) * PHYSICS_DT * 1_000, 2);
    } finally {
      clock.mockRestore();
    }
    const producedAtMs = localStates().at(-1)!.producedAtMs;

    await send({ type: "checkpoint", message: checkpoint(12) });
    expect(localStates().at(-1)!.producedAtMs).toBe(producedAtMs);
    const applied = localStates().length;
    for (const stale of [
      checkpoint(10),
      checkpoint(12),
      checkpoint(14, { lastProcessedInputSequence: 3 }),
    ])
      await send({ type: "checkpoint", message: stale });
    expect(localStates()).toHaveLength(applied);

    const predictedBody = {
      ...body,
      sourceTick: 20,
      stateSequence: 20,
      position: { ...body.position, x: 3 },
    };
    await send({
      type: "checkpoint",
      message: checkpoint(20, { nearbyBodies: [predictedBody] }),
    });
    expect(
      localStates()
        .at(-1)!
        .states.find((state) => state.kind === "body")?.position.x,
    ).toBe(3);
    await send({
      type: "network-states",
      states: [{ ...body, sourceTick: 18, stateSequence: 18 }],
    });
    await send({ type: "checkpoint", message: checkpoint(22) });
    const demoted = localStates().at(-1)!;
    expect(demoted.states.some((state) => state.kind === "body")).toBe(false);
    expect(
      demoted.collisionStates.find((state) => state.kind === "body")?.position
        .x,
    ).toBe(3);

    await send({
      type: "network-states",
      states: [
        {
          ...body,
          sourceTick: 28,
          stateSequence: 28,
          position: { ...body.position, x: 4 },
        },
      ],
    });
    await send({ type: "checkpoint", message: checkpoint(24) });
    expect(
      localStates()
        .at(-1)!
        .collisionStates.find((state) => state.kind === "body")?.position.x,
    ).toBe(4);

    const reassigned = {
      ...player,
      authorityVersion: 2,
      stateSequence: 0,
      sourceTick: 30,
      position: { ...player.position, x: 1 },
    };
    await send({
      type: "ownership-changed",
      message: {
        requestId: null,
        worldEpoch: 1,
        id: player.id,
        authorityVersion: 2,
        ownerPlayerId: null,
        state: reassigned,
      },
    });
    await send({
      type: "checkpoint",
      message: checkpoint(31, {
        lastProcessedInputSequence: 0,
        player: { ...reassigned, stateSequence: 1, sourceTick: 31 },
      }),
    });
    expect(localStates().at(-1)!.acknowledgment).toBe(0);
    expect(
      localStates()
        .at(-1)!
        .collisionStates.find((state) => state.kind === "player")?.position.x,
    ).toBe(1);
    const current = localStates().length;
    await send({ type: "checkpoint", message: checkpoint(40) });
    await send({
      type: "checkpoint",
      message: checkpoint(40, { worldEpoch: 0 }),
    });
    expect(localStates()).toHaveLength(current);
    await send({
      type: "lifecycle",
      message: {
        type: "lifecycle",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        created: [],
        removed: [player.id],
      },
    });
    await send({
      type: "checkpoint",
      message: checkpoint(42, { player: { ...reassigned, sourceTick: 42 } }),
    });
    expect(localStates()).toHaveLength(current);
    expect(messages.filter((message) => message.type === "error")).toEqual([]);
  } finally {
    Object.defineProperty(globalThis, "self", previousSelf);
    create.mockRestore();
    (physics as PhysicsWorld | null)?.dispose();
  }
});
