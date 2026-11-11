import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RTCPeerConnection, type RTCDataChannel } from "werift";
import {
  BOOTSTRAP_STATE_TAG,
  LIFECYCLE_TAG,
  NETWORK_FLAG_HELD,
  OWNERSHIP_CHANGED_TAG,
  PREDICTION_CHECKPOINT_TAG,
  PROTOCOL_VERSION,
  STATE_CLUSTER_TAG,
  StateReceiver,
  binaryPacketTag,
  decodeBootstrapState,
  decodeLifecycle,
  decodeOwnershipChanged,
  decodePredictionCheckpoint,
  decodeServerControl,
  decodeStateCluster,
  encodeManipulationState,
  encodeInputBundle,
  encodeStateAck,
  type BootstrapStatePacket,
  type InputCommand,
  type NetworkObjectState,
  type OwnershipChangedPacket,
  type PredictionCheckpointPacket,
  type RuntimeId,
  type WelcomeMessage,
  type WorldManifestMessage,
} from "@harrhy/gurgur-engine";
import { compileWorld } from "@harrhy/gurgur-game";
import { createGurgurServer, type GurgurServer } from "../../server/src/server";
import { guardIceUdpSockets } from "../../server/src/rtc";

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).toReversed()) await dispose();
});

describe("protocol-v7 real server transport", () => {
  test("delivers owner checkpoints on the fixed 30 Hz schedule", async () => {
    const { server } = await launch();
    const client = await connect(server.port);
    cleanup.push(() => close(client));

    const startingTick = server.metrics().serverTick;
    await Bun.sleep(550);
    const ticks = [...new Set(client.checkpointTicks)].filter(
      (tick) => tick > startingTick,
    );
    const gaps = ticks.slice(1).map((tick, index) => tick - ticks[index]!);
    expect(ticks.length).toBeGreaterThanOrEqual(14);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(4);
  });

  test("drives server-owned player state from bundled input and returns prediction checkpoints", async () => {
    const { server } = await launch();
    const first = await connect(server.port);
    const observer = await connect(server.port);
    cleanup.push(
      () => close(first),
      () => close(observer),
    );

    expect(first.welcome.stateHz).toBe(30);
    expect(
      first.world.runtimeEntities.find((entity) =>
        same(entity.id, first.welcome.playerId),
      ),
    ).toMatchObject({
      kind: "player",
      ownerPlayerId: null,
      transferPolicy: "fixed",
    });
    expect(
      (await fetch(`http://127.0.0.1:${server.port}/physics-worker.js`)).ok,
    ).toBe(true);
    expect(
      (await fetch(`http://127.0.0.1:${server.port}/debug-capture-worker.js`))
        .ok,
    ).toBe(true);

    const initial = first.receiver.state(first.welcome.playerId);
    if (!initial || initial.kind !== "player")
      throw new Error("missing player bootstrap");
    const relayedPromise = waitForState(
      observer,
      (state) =>
        state.kind === "player" &&
        same(state.id, first.welcome.playerId) &&
        Math.hypot(
          state.position.x - initial.position.x,
          state.position.y - initial.position.y,
          state.position.z - initial.position.z,
        ) > 0.02,
    );
    const acknowledged = waitForCheckpoint(
      first,
      (checkpoint) => checkpoint.lastProcessedInputSequence === 1,
    );
    first.input.send(
      Buffer.from(
        encodeInputBundle({
          worldEpoch: first.world.worldEpoch,
          commands: [command(first, 1, { moveZ: 1 })],
        }),
      ),
    );
    const [relayed, checkpoint] = await Promise.all([
      relayedPromise,
      acknowledged,
    ]);
    expect(
      Math.hypot(
        checkpoint.player.position.x - initial.position.x,
        checkpoint.player.position.y - initial.position.y,
        checkpoint.player.position.z - initial.position.z,
      ),
    ).toBeGreaterThan(0.02);
    expect(relayed.stateSequence).toBeGreaterThan(0);
    expect(checkpoint.serverTick).toBeGreaterThan(0);
    expect(observer.acks).toBeGreaterThan(0);
    expect(server.metrics().stateTransportClients).toBe(2);
  });

  test("keeps a loose grab host-owned across exclusive claim, targets, and release", async () => {
    const path = "content/maps/fixtures/network-push-corridor.map";
    const bundle = compileWorld(await Bun.file(path).text(), path);
    const prop = bundle.entities.find(
      (entity) =>
        entity.kind === "physics-prop" &&
        entity.authoredId === "corridor.light",
    );
    if (!prop) throw new Error("pickup fixture is unavailable");
    const brush = bundle.brushes[prop.body!.brushIndices[0]!]!;
    const { server, adminToken } = await launch({
      worldBundle: bundle,
      playerSpawn: { x: brush.center.x, y: 0.9, z: brush.center.z + 1.2 },
    });
    const first = await connect(server.port);
    const second = await connect(server.port);
    cleanup.push(
      () => close(first),
      () => close(second),
    );
    const target = first.world.runtimeEntities.find(
      (entity) =>
        entity.kind === "world-entity" &&
        entity.entityIndex === bundle.entities.indexOf(prop),
    )!;
    const initial = first.receiver.state(target.id);
    if (!initial || initial.kind !== "body")
      throw new Error("missing prop bootstrap");

    expect(target).toMatchObject({
      ownerPlayerId: null,
      transferPolicy: "fixed",
    });
    const firstGrab = waitForCheckpoint(
      first,
      (checkpoint) => checkpoint.lastProcessedInputSequence === 1,
    );
    first.input.send(
      Buffer.from(
        encodeInputBundle({
          worldEpoch: first.world.worldEpoch,
          commands: [
            command(first, 1, { lookPitch: -0.18, primaryCounter: 1 }),
          ],
        }),
      ),
    );
    const held = await firstGrab;
    if (!held.held)
      throw new Error(
        `server did not acquire loose grab: ${JSON.stringify({ checkpoint: held, target: first.receiver.state(target.id) })}`,
      );
    expect(held.held.body.id).toEqual(target.id);
    expect(held.held!.body.authorityVersion).toBe(initial.authorityVersion);
    expect(target.ownerPlayerId).toBeNull();

    const secondRejected = waitForCheckpoint(
      second,
      (checkpoint) => checkpoint.lastProcessedInputSequence === 1,
    );
    second.input.send(
      Buffer.from(
        encodeInputBundle({
          worldEpoch: second.world.worldEpoch,
          commands: [
            command(second, 1, { lookPitch: -0.18, primaryCounter: 1 }),
          ],
        }),
      ),
    );
    expect((await secondRejected).held).toBeNull();

    const movedPromise = waitForState(
      second,
      (state) =>
        state.kind === "body" &&
        same(state.id, target.id) &&
        Math.hypot(
          state.position.x - initial.position.x,
          state.position.z - initial.position.z,
        ) > 0.1,
    );
    const hotSourceTicks: number[] = [];
    let collectHotStates = true;
    const collectHotState = (state: NetworkObjectState): void => {
      if (state.kind === "body" && same(state.id, target.id))
        hotSourceTicks.push(state.sourceTick);
      if (collectHotStates) second.states.push(collectHotState);
    };
    second.states.push(collectHotState);
    for (let sequence = 2; sequence <= 12; sequence += 1) {
      first.input.send(
        Buffer.from(
          encodeInputBundle({
            worldEpoch: first.world.worldEpoch,
            commands: [
              command(first, sequence, {
                lookYaw: 0.7,
                lookPitch: -0.18,
                primaryCounter: 1,
              }),
            ],
          }),
        ),
      );
      await Bun.sleep(16);
    }
    const moved = await movedPromise;
    await Bun.sleep(100);
    expectHotStateCadence(hotSourceTicks);
    expect(moved.flags & NETWORK_FLAG_HELD).toBe(NETWORK_FLAG_HELD);
    expect(moved.authorityVersion).toBe(initial.authorityVersion);
    const droppedPromise = waitForCheckpoint(
      first,
      (checkpoint) =>
        checkpoint.lastProcessedInputSequence === 13 &&
        checkpoint.held === null,
    );
    first.input.send(
      Buffer.from(
        encodeInputBundle({
          worldEpoch: first.world.worldEpoch,
          commands: [command(first, 13, { primaryCounter: 2 })],
        }),
      ),
    );
    await droppedPromise;
    expect(target.ownerPlayerId).toBeNull();
    hotSourceTicks.length = 0;
    await Bun.sleep(200);
    collectHotStates = false;
    const pendingCollector = second.states.indexOf(collectHotState);
    if (pendingCollector >= 0) second.states.splice(pendingCollector, 1);
    expectHotStateCadence(hotSourceTicks);

    const resetWorld = waitForWorld(first, first.world.worldEpoch + 1);
    const reset = await fetch(`http://127.0.0.1:${server.port}/admin/reset`, {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(reset.ok).toBe(true);
    await resetWorld;
    await waitForCondition(() =>
      first.receiver
        .states()
        .some(
          (state) =>
            state.kind === "player" &&
            same(state.id, first.welcome.playerId) &&
            state.authorityVersion > 1,
        ),
    );
    expect(
      first.receiver.states().every((state) => state.authorityVersion >= 1),
    ).toBe(true);
  });

  test("keeps a manipulated contraption host-owned across reliable claim and disposable targets", async () => {
    const path = "content/maps/fixtures/physics-contraptions.map";
    const bundle = compileWorld(await Bun.file(path).text(), path);
    const prop = bundle.entities.find(
      (entity) =>
        entity.kind === "physics-prop" &&
        entity.authoredId === "fixture.lever.body",
    );
    if (!prop || prop.kind !== "physics-prop")
      throw new Error("lever fixture is unavailable");
    const brush = bundle.brushes[prop.body.brushIndices[0]!]!;
    const { server } = await launch({
      worldBundle: bundle,
      playerSpawn: { ...brush.center },
    });
    const first = await connect(server.port);
    const second = await connect(server.port);
    cleanup.push(
      () => close(first),
      () => close(second),
    );
    const target = first.world.runtimeEntities.find(
      (entity) =>
        entity.kind === "world-entity" &&
        entity.entityIndex === bundle.entities.indexOf(prop),
    )!;
    const initial = first.receiver.state(target.id);
    if (!initial || initial.kind !== "body")
      throw new Error("missing lever bootstrap");
    const request = {
      type: "manipulation-request" as const,
      protocolVersion: PROTOCOL_VERSION,
      worldEpoch: first.world.worldEpoch,
      requestId: 40,
      target: target.id,
      authorityVersion: initial.authorityVersion,
      localAnchor: { x: 1.5, y: 0, z: 0 },
      holdDistance: 1.5,
    };
    const grantPromise = waitForText(first, "manipulation-changed");
    const denialPromise = waitForText(second, "manipulation-denied");
    first.socket.send(JSON.stringify(request));
    second.socket.send(JSON.stringify({ ...request, requestId: 41 }));
    const grant = await grantPromise;
    expect(grant.manipulatorPlayerId).toEqual(first.welcome.playerId);
    expect(grant.authorityVersion).toBe(initial.authorityVersion);
    expect((await denialPromise).reason).toBe("busy");
    const claimVersion = Number(grant.claimVersion);
    const movedPromise = waitForState(
      second,
      (state) =>
        state.kind === "body" &&
        same(state.id, target.id) &&
        (Math.hypot(
          state.position.x - initial.position.x,
          state.position.y - initial.position.y,
          state.position.z - initial.position.z,
        ) > 0.01 ||
          Math.hypot(
            state.rotation.x - initial.rotation.x,
            state.rotation.y - initial.rotation.y,
            state.rotation.z - initial.rotation.z,
            state.rotation.w - initial.rotation.w,
          ) > 0.01),
    );
    for (let sequence = 1; sequence <= 12; sequence += 1) {
      first.input.send(
        Buffer.from(
          encodeManipulationState({
            worldEpoch: first.world.worldEpoch,
            target: target.id,
            authorityVersion: initial.authorityVersion,
            claimVersion,
            stateSequence: sequence,
            targetPosition: {
              x: initial.position.x + 1.5,
              y: initial.position.y + 0.8,
              z: initial.position.z,
            },
            targetRotation: initial.rotation,
          }),
        ),
      );
      await Bun.sleep(16);
    }
    const moved = await movedPromise;
    expect(moved.authorityVersion).toBe(initial.authorityVersion);
    expect(target.ownerPlayerId).toBeNull();
    const droppedPromise = waitForText(second, "manipulation-changed");
    first.socket.send(
      JSON.stringify({
        type: "manipulation-drop",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: first.world.worldEpoch,
        target: target.id,
        authorityVersion: initial.authorityVersion,
        claimVersion,
      }),
    );
    expect((await droppedPromise).manipulatorPlayerId).toBeNull();
  });
});

type TestClient = {
  socket: WebSocket;
  peer: RTCPeerConnection;
  input: RTCDataChannel;
  state: RTCDataChannel;
  welcome: WelcomeMessage;
  world: WorldManifestMessage;
  receiver: StateReceiver;
  acks: number;
  checkpointTicks: number[];
  states: Array<(state: NetworkObjectState) => void>;
  ownership: Array<(message: OwnershipChangedPacket) => void>;
  checkpoints: Array<(message: PredictionCheckpointPacket) => void>;
  texts: Array<(message: Record<string, unknown>) => void>;
  worlds: Array<(message: WorldManifestMessage) => void>;
};

async function launch(
  options: {
    worldBundle?: NonNullable<
      Parameters<typeof createGurgurServer>[0]
    >["worldBundle"];
    playerSpawn?: NonNullable<
      Parameters<typeof createGurgurServer>[0]
    >["playerSpawn"];
  } = {},
): Promise<{ server: GurgurServer; directory: string; adminToken: string }> {
  const directory = await mkdtemp(join(tmpdir(), "gurgur-v7-"));
  const adminToken = "protocol-v7-test";
  const server = await createGurgurServer({
    port: 0,
    hostname: "127.0.0.1",
    databasePath: join(directory, "world.sqlite"),
    adminToken,
    ...options,
  });
  cleanup.push(() => {
    server.stop();
    return rm(directory, { recursive: true, force: true });
  });
  return { server, directory, adminToken };
}

function connect(port: number): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/game`);
    socket.binaryType = "arraybuffer";
    const peer = new RTCPeerConnection({
      iceAdditionalHostAddresses: ["127.0.0.1"],
    });
    const input = peer.createDataChannel("gurgur-input-v7", {
      ordered: false,
      maxRetransmits: 0,
    });
    const receiver = new StateReceiver();
    let state: RTCDataChannel | null = null;
    let welcome: WelcomeMessage | null = null;
    let world: WorldManifestMessage | null = null;
    let bootstrap: BootstrapStatePacket | null = null;
    let inputOpen = false;
    let stateOpen = false;
    let answerStarted = false;
    const stateListeners: TestClient["states"] = [];
    const ownershipListeners: TestClient["ownership"] = [];
    const checkpointListeners: TestClient["checkpoints"] = [];
    const checkpointTicks: number[] = [];
    const textListeners: TestClient["texts"] = [];
    const worldListeners: TestClient["worlds"] = [];
    let acks = 0;
    const client = (): TestClient => ({
      socket,
      peer,
      input,
      state: state!,
      welcome: welcome!,
      world: world!,
      receiver,
      get acks() {
        return acks;
      },
      checkpointTicks,
      states: stateListeners,
      ownership: ownershipListeners,
      checkpoints: checkpointListeners,
      texts: textListeners,
      worlds: worldListeners,
    });
    const timeout = setTimeout(
      () => reject(new Error("timed out connecting v7 client")),
      7_500,
    );
    const done = (): void => {
      if (
        !state ||
        !welcome ||
        !world ||
        !bootstrap ||
        !inputOpen ||
        !stateOpen
      )
        return;
      clearTimeout(timeout);
      resolve(client());
    };
    input.stateChanged.subscribe((value) => {
      inputOpen = value === "open";
      done();
    });
    peer.onDataChannel.subscribe((channel) => {
      if (channel.label !== "gurgur-state-v7" || state) {
        channel.close();
        return;
      }
      state = channel;
      channel.stateChanged.subscribe((value) => {
        stateOpen = value === "open";
        done();
      });
      channel.onMessage.subscribe((packet) => {
        if (typeof packet === "string") return;
        if (binaryPacketTag(packet) === PREDICTION_CHECKPOINT_TAG) {
          const checkpoint = decodePredictionCheckpoint(packet);
          checkpointTicks.push(checkpoint.serverTick);
          for (const listener of checkpointListeners.splice(0))
            listener(checkpoint);
          return;
        }
        const cluster = decodeStateCluster(packet);
        const received = receiver.applyCluster(cluster);
        for (const accepted of received.accepted)
          for (const listener of stateListeners.splice(0)) listener(accepted);
        if (received.ack.entries.length > 0) {
          input.send(Buffer.from(encodeStateAck(received.ack)));
          acks += 1;
        }
      });
    });
    const acceptOffer = async (description: {
      type: "offer";
      sdp: string;
    }): Promise<void> => {
      if (!welcome || answerStarted) return;
      answerStarted = true;
      try {
        await peer.setRemoteDescription(description);
        await peer.setLocalDescription(await peer.createAnswer());
        guardIceUdpSockets(peer);
        if (!peer.localDescription?.sdp)
          throw new Error("RTC answer is missing SDP");
        socket.send(
          JSON.stringify({
            type: "rtc-answer",
            protocolVersion: PROTOCOL_VERSION,
            worldEpoch: welcome.worldEpoch,
            description: { type: "answer", sdp: peer.localDescription.sdp },
          }),
        );
      } catch (error) {
        reject(error);
      }
    };
    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          type: "hello",
          protocolVersion: PROTOCOL_VERSION,
          mapRevision: null,
          worldEpoch: null,
          sessionToken: null,
          socketGeneration: 0,
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        const message = decodeServerControl(event.data);
        if (message.type === "welcome") welcome = message;
        else if (message.type === "world") {
          world = message;
          for (const listener of worldListeners.splice(0)) listener(message);
        } else if (message.type === "rtc-offer")
          void acceptOffer(message.description);
        for (const listener of textListeners.splice(0))
          listener(message as unknown as Record<string, unknown>);
        done();
        return;
      }
      const data = event.data as ArrayBuffer;
      const tag = binaryPacketTag(data);
      if (tag === BOOTSTRAP_STATE_TAG) {
        bootstrap = decodeBootstrapState(data);
        receiver.reset(bootstrap.states);
      } else if (tag === OWNERSHIP_CHANGED_TAG) {
        const message = decodeOwnershipChanged(data);
        receiver.replaceReliable(message.state);
        for (const listener of ownershipListeners.splice(0)) listener(message);
      } else if (tag === LIFECYCLE_TAG) {
        const lifecycle = decodeLifecycle(data);
        for (const removed of lifecycle.removed) receiver.remove(removed);
      } else if (tag === STATE_CLUSTER_TAG && state) {
        const cluster = decodeStateCluster(data);
        receiver.applyCluster(cluster);
      } else if (tag === PREDICTION_CHECKPOINT_TAG) {
        const checkpoint = decodePredictionCheckpoint(data);
        checkpointTicks.push(checkpoint.serverTick);
        for (const listener of checkpointListeners.splice(0))
          listener(checkpoint);
      }
      done();
    });
    socket.addEventListener("error", () =>
      reject(new Error("v7 websocket failed")),
    );
  });
}

function waitForState(
  client: TestClient,
  predicate: (state: NetworkObjectState) => boolean,
): Promise<NetworkObjectState> {
  return wait(client.states, predicate, "state");
}

function waitForCheckpoint(
  client: TestClient,
  predicate: (checkpoint: PredictionCheckpointPacket) => boolean,
): Promise<PredictionCheckpointPacket> {
  return wait(client.checkpoints, predicate, "prediction checkpoint");
}

function waitForText(
  client: TestClient,
  type: string,
): Promise<Record<string, unknown>> {
  return wait(client.texts, (message) => message.type === type, type);
}

function waitForWorld(
  client: TestClient,
  epoch: number,
): Promise<WorldManifestMessage> {
  if (client.world.worldEpoch === epoch) return Promise.resolve(client.world);
  return wait(
    client.worlds,
    (message) => message.worldEpoch === epoch,
    "world",
  );
}

function wait<T>(
  listeners: Array<(value: T) => void>,
  predicate: (value: T) => boolean,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`timed out waiting for ${label}`)),
      5_000,
    );
    const listener = (value: T): void => {
      if (!predicate(value)) {
        listeners.push(listener);
        return;
      }
      clearTimeout(timeout);
      resolve(value);
    };
    listeners.push(listener);
  });
}

async function close(client: TestClient): Promise<void> {
  await client.peer.close();
  client.socket.close();
}

function command(
  client: TestClient,
  sequence: number,
  patch: Partial<InputCommand> = {},
): InputCommand {
  return {
    type: "input",
    protocolVersion: PROTOCOL_VERSION,
    worldEpoch: client.world.worldEpoch,
    sequence,
    clientTick: sequence,
    moveX: 0,
    moveZ: 0,
    lookYaw: 0,
    lookPitch: 0,
    buttons: 0,
    jumpCounter: 0,
    interactCounter: 0,
    interactTarget: null,
    primaryCounter: 0,
    ...patch,
  };
}

function same(a: RuntimeId, b: RuntimeId): boolean {
  return a.index === b.index && a.generation === b.generation;
}

function expectHotStateCadence(sourceTicks: number[]): void {
  const ticks = [...new Set(sourceTicks)].toSorted(
    (left, right) => left - right,
  );
  expect(ticks.length).toBeGreaterThanOrEqual(8);
  const gaps = ticks.slice(1).map((tick, index) => tick - ticks[index]!);
  const adjacentTicks = gaps.filter((gap) => gap === 1).length;
  expect(adjacentTicks / gaps.length).toBeGreaterThanOrEqual(0.75);
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (!predicate()) {
    if (performance.now() >= deadline)
      throw new Error("timed out waiting for condition");
    await Bun.sleep(5);
  }
}
