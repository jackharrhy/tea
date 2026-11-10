import { describe, expect, test } from "bun:test";
import {
  BODY_STATE_FIELDS,
  PLAYER_STATE_FIELDS,
  STATE_CLUSTER_MAX_BYTES,
  StateReceiver,
  StateReplicationPeer,
  applyStateDelta,
  clusterStateDeltas,
  createStateDelta,
  decodeBootstrapState,
  decodeInputBundle,
  decodeManipulationState,
  decodeOwnershipChanged,
  decodePredictionCheckpoint,
  decodeStateAck,
  decodeStateCluster,
  encodeBootstrapState,
  encodeInputBundle,
  encodeManipulationState,
  encodeOwnershipChanged,
  encodePredictionCheckpoint,
  encodeStateAck,
  encodeStateCluster,
  fullStateDelta,
  isNewerSequence16,
  PROTOCOL_VERSION,
  type InputCommand,
  type NetworkBodyState,
  type NetworkObjectState,
  type NetworkPlayerState,
} from "../src";

const body = (overrides: Partial<NetworkBodyState> = {}): NetworkBodyState => ({
  kind: "body",
  id: { index: 7, generation: 2 },
  authorityVersion: 3,
  stateSequence: 4,
  sourceTick: 400,
  position: { x: 1.25, y: -2.5, z: 3.75 },
  rotation: { x: 0, y: 0.25, z: 0, w: 0.968_245_8 },
  linearVelocity: { x: 4, y: 5, z: 6 },
  angularVelocity: { x: -1, y: -2, z: -3 },
  flags: 9,
  ...overrides,
});

const player = (
  overrides: Partial<NetworkPlayerState> = {},
): NetworkPlayerState => ({
  kind: "player",
  id: { index: 50_000, generation: 1 },
  authorityVersion: 8,
  stateSequence: 12,
  sourceTick: 1_200,
  position: { x: 10, y: 2, z: -4 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  linearVelocity: { x: 1, y: 0, z: -1 },
  angularVelocity: { x: 0, y: 0, z: 0 },
  flags: 0,
  yaw: 1.5,
  verticalVelocity: -0.75,
  grounded: false,
  crouched: true,
  lastJumpCounter: 9,
  stepCooldown: 0.125,
  ...overrides,
});

describe("protocol-v7 network state codecs", () => {
  test("round-trips bootstrap, ack, and reliable ownership packets", () => {
    const states: NetworkObjectState[] = [body(), player()];
    expectStateList(
      decodeBootstrapState(encodeBootstrapState({ worldEpoch: 11, states }))
        .states,
      states,
    );

    const ack = {
      worldEpoch: 11,
      entries: states.map((state) => ({
        id: state.id,
        authorityVersion: state.authorityVersion,
        stateSequence: state.stateSequence,
      })),
    };
    expect(decodeStateAck(encodeStateAck(ack))).toEqual(ack);

    const changed = {
      worldEpoch: 11,
      requestId: 91,
      id: body().id,
      ownerPlayerId: player().id,
      authorityVersion: body().authorityVersion,
      state: body(),
    };
    const decodedChanged = decodeOwnershipChanged(
      encodeOwnershipChanged(changed),
    );
    expect(decodedChanged.requestId).toBe(91);
    expect(decodedChanged.ownerPlayerId).toEqual(player().id);
    expectState(decodedChanged.state, body());
  });

  test("round-trips four-command redundancy and a held-body prediction checkpoint", () => {
    const commands = [1, 2, 3, 4].map((sequence) => input(sequence));
    const bundle = decodeInputBundle(
      encodeInputBundle({ worldEpoch: 11, commands }),
    );
    expect(bundle.commands).toEqual(commands);

    const checkpoint = {
      worldEpoch: 11,
      serverTick: 900,
      lastProcessedInputSequence: 3,
      player: player(),
      nearbyBodies: [body({ id: { index: 8, generation: 2 } })],
      held: {
        claimVersion: 7,
        startInputSequence: 2,
        localAnchor: { x: 0, y: 0, z: 0 },
        body: body(),
        distance: 1.75,
        relativeRotation: { x: 0, y: 0.25, z: 0, w: 0.968_245_8 },
        targetPosition: { x: 2, y: 3, z: 4 },
        targetRotation: { x: 0, y: 0, z: 0, w: 1 },
        errorSeconds: 0.125,
      },
    };
    const decoded = decodePredictionCheckpoint(
      encodePredictionCheckpoint(checkpoint),
    );
    expect(decoded.worldEpoch).toBe(checkpoint.worldEpoch);
    expect(decoded.serverTick).toBe(checkpoint.serverTick);
    expect(decoded.lastProcessedInputSequence).toBe(3);
    expectState(decoded.player, checkpoint.player);
    expectState(decoded.nearbyBodies[0]!, checkpoint.nearbyBodies[0]!);
    expectState(decoded.held!.body, checkpoint.held.body);
    expect(decoded.held!.claimVersion).toBe(7);
    expect(decoded.held!.startInputSequence).toBe(2);
    expect(decoded.held!.localAnchor).toEqual({ x: 0, y: 0, z: 0 });
    expect(decoded.held!.distance).toBeCloseTo(1.75);
    expect(decoded.held!.targetPosition).toEqual(
      checkpoint.held.targetPosition,
    );
    expect(() =>
      encodePredictionCheckpoint({
        ...checkpoint,
        nearbyBodies: [checkpoint.held.body],
      }),
    ).toThrow("duplicates its held body");
  });

  test("round-trips a bounded disposable manipulation target", () => {
    const state = {
      worldEpoch: 11,
      target: body().id,
      authorityVersion: body().authorityVersion,
      claimVersion: 9,
      stateSequence: 65_535,
      targetPosition: { x: 1.25, y: 2.5, z: -3.75 },
      targetRotation: { x: 0, y: 0.25, z: 0, w: 0.968_245_8 },
    };
    const encoded = encodeManipulationState(state);
    expect(encoded.byteLength).toBe(51);
    const decoded = decodeManipulationState(encoded);
    expect(decoded.worldEpoch).toBe(state.worldEpoch);
    expect(decoded.target).toEqual(state.target);
    expect(decoded.authorityVersion).toBe(state.authorityVersion);
    expect(decoded.claimVersion).toBe(state.claimVersion);
    expect(decoded.stateSequence).toBe(state.stateSequence);
    expect(decoded.targetPosition.x).toBeCloseTo(state.targetPosition.x);
    expect(decoded.targetPosition.y).toBeCloseTo(state.targetPosition.y);
    expect(decoded.targetPosition.z).toBeCloseTo(state.targetPosition.z);
    expect(decoded.targetRotation.y).toBeCloseTo(state.targetRotation.y);
    expect(decoded.targetRotation.w).toBeCloseTo(state.targetRotation.w);

    const bytes = new Uint8Array(encoded);
    expect(() =>
      decodeManipulationState(bytes.subarray(0, bytes.length - 1)),
    ).toThrow("truncated");
    expect(() =>
      encodeManipulationState({
        ...state,
        targetPosition: { x: Number.NaN, y: 0, z: 0 },
      }),
    ).toThrow("manipulation state");
    expect(() =>
      encodeManipulationState({ ...state, stateSequence: 65_536 }),
    ).toThrow("manipulation state");
  });

  test("encodes complete and baseline-relative field masks", () => {
    expect(fullStateDelta(body()).fieldMask).toBe(BODY_STATE_FIELDS);
    expect(fullStateDelta(player()).fieldMask).toBe(PLAYER_STATE_FIELDS);
    expect(fullStateDelta(body()).baselineSequence).toBeNull();

    const baseline = body();
    const current = body({
      stateSequence: 5,
      position: { x: 8, y: baseline.position.y, z: baseline.position.z },
      flags: 12,
    });
    const delta = createStateDelta(current, baseline);
    expect(delta.baselineSequence).toBe(baseline.stateSequence);
    expect(delta.fieldMask).not.toBe(BODY_STATE_FIELDS);
    expect(delta.position).toEqual(current.position);
    expect(delta.flags).toBe(12);
    expect(delta.rotation).toBeUndefined();
    expectState(applyStateDelta(baseline, delta), current);
    expect(() => applyStateDelta(null, delta)).toThrow("baseline");
  });

  test("splits deterministic disposable clusters below 1200 bytes", () => {
    const deltas = Array.from({ length: 80 }, (_, index) =>
      fullStateDelta(
        body({
          id: { index, generation: 1 },
          stateSequence: index,
          position: { x: index, y: 2, z: -index },
        }),
      ),
    );
    const { clusters, nextClusterSequence } = clusterStateDeltas(
      4,
      65_534,
      deltas,
    );
    expect(clusters.length).toBeGreaterThan(1);
    expect(nextClusterSequence).toBe((65_534 + clusters.length) & 0xffff);
    const decoded = clusters.flatMap((cluster) => {
      const bytes = encodeStateCluster(cluster);
      expect(bytes.byteLength).toBeLessThanOrEqual(STATE_CLUSTER_MAX_BYTES);
      return decodeStateCluster(bytes).states;
    });
    expect(decoded).toHaveLength(deltas.length);
  });

  test("rejects truncation, trailing bytes, non-finite values, and packet overflow", () => {
    const encoded = new Uint8Array(
      encodeBootstrapState({ worldEpoch: 1, states: [body()] }),
    );
    expect(() =>
      decodeBootstrapState(encoded.subarray(0, encoded.length - 1)),
    ).toThrow("truncated");
    const trailing = new Uint8Array(encoded.length + 1);
    trailing.set(encoded);
    expect(() => decodeBootstrapState(trailing)).toThrow("trailing");
    expect(() =>
      encodeBootstrapState({
        worldEpoch: 1,
        states: [body({ position: { x: Number.NaN, y: 0, z: 0 } })],
      }),
    ).toThrow("position");
    expect(() =>
      encodeInputBundle({
        worldEpoch: 1,
        commands: [input(1), input(2), input(3), input(4), input(5)],
      }),
    ).toThrow("command count is invalid");
    expect(() =>
      encodeInputBundle({
        worldEpoch: 11,
        commands: [input(2), input(1)],
      }),
    ).toThrow("ordered");
    expect(() =>
      encodeInputBundle({
        worldEpoch: 11,
        commands: [input(1, { moveX: Number.NaN })],
      }),
    ).toThrow("input command");
    expect(() =>
      encodeStateCluster({
        worldEpoch: 1,
        clusterSequence: 0,
        states: Array.from({ length: 80 }, (_, index) =>
          fullStateDelta(body({ id: { index, generation: 1 } })),
        ),
      }),
    ).toThrow("1200-byte");
  });
});

function input(
  sequence: number,
  patch: Partial<InputCommand> = {},
): InputCommand {
  return {
    type: "input",
    protocolVersion: PROTOCOL_VERSION,
    worldEpoch: 11,
    sequence,
    clientTick: sequence,
    moveX: 0,
    moveZ: 1,
    lookYaw: 0.25,
    lookPitch: -0.25,
    buttons: 0,
    jumpCounter: 2,
    interactCounter: 3,
    interactTarget: null,
    primaryCounter: 4,
    ...patch,
  };
}

describe("per-recipient acknowledged state", () => {
  test("uses the reliable seed as a delta baseline and resends after 250 ms", () => {
    const replication = new StateReplicationPeer();
    const initial = body({ stateSequence: 1 });
    replication.seedReliable([initial]);
    const current = body({ stateSequence: 2, position: { x: 2, y: 3, z: 4 } });
    const first = replication.createClusters(9, [current], 1_000);
    expect(first).toHaveLength(1);
    expect(first[0]!.states[0]!.fieldMask).not.toBe(BODY_STATE_FIELDS);
    expect(replication.createClusters(9, [current], 1_100)).toEqual([]);
    expect(replication.createClusters(9, [current], 1_251)).toHaveLength(1);
  });

  test("advances only from an acknowledged sent state and tolerates ack loss", () => {
    const replication = new StateReplicationPeer();
    const receiver = new StateReceiver();
    const initial = body({ stateSequence: 10 });
    replication.seedReliable([initial]);
    receiver.reset([initial]);

    const current = body({
      stateSequence: 11,
      position: { x: 12, y: 2, z: 3 },
    });
    const cluster = replication.createClusters(5, [current], 0)[0]!;
    const received = receiver.applyCluster(
      decodeStateCluster(encodeStateCluster(cluster)),
    );
    expectState(received.accepted[0]!, current);
    replication.acknowledge(received.ack);
    expect(replication.createClusters(5, [current], 500)).toEqual([]);

    const duplicate = receiver.applyCluster(cluster);
    expect(duplicate.accepted).toEqual([]);
    expect(duplicate.ack.entries).toHaveLength(1);
  });

  test("rejects stale authority and handles uint16 sequence wrap", () => {
    expect(isNewerSequence16(0, 65_535)).toBeTrue();
    expect(isNewerSequence16(65_535, 0)).toBeFalse();
    const receiver = new StateReceiver();
    receiver.reset([body({ authorityVersion: 9, stateSequence: 65_535 })]);
    const wrapped = body({
      authorityVersion: 9,
      stateSequence: 0,
      position: { x: 5, y: 0, z: 0 },
    });
    expect(
      receiver.applyCluster({
        worldEpoch: 1,
        clusterSequence: 0,
        states: [fullStateDelta(wrapped)],
      }).accepted,
    ).toHaveLength(1);
    const stale = body({ authorityVersion: 8, stateSequence: 100 });
    expect(
      receiver.applyCluster({
        worldEpoch: 1,
        clusterSequence: 1,
        states: [fullStateDelta(stale)],
      }).accepted,
    ).toEqual([]);
  });

  test("applies acknowledged-baseline deltas against retained history", () => {
    const receiver = new StateReceiver();
    const baseline = body({ stateSequence: 1, flags: 1 });
    const middle = body({
      stateSequence: 2,
      flags: 2,
      position: { x: 2, y: 0, z: 0 },
    });
    const newest = body({
      stateSequence: 3,
      flags: 1,
      position: { x: 3, y: 0, z: 0 },
    });
    receiver.reset([baseline]);
    expect(
      receiver.applyCluster({
        worldEpoch: 1,
        clusterSequence: 0,
        states: [createStateDelta(middle, baseline)],
      }).accepted,
    ).toHaveLength(1);
    const accepted = receiver.applyCluster({
      worldEpoch: 1,
      clusterSequence: 1,
      states: [createStateDelta(newest, baseline)],
    }).accepted[0];
    expect(accepted?.flags).toBe(1);
    expect(accepted?.position.x).toBe(3);
  });
});

function expectState(
  actual: NetworkObjectState,
  expected: NetworkObjectState,
): void {
  expect(actual.kind).toBe(expected.kind);
  expect(actual.id).toEqual(expected.id);
  expect(actual.authorityVersion).toBe(expected.authorityVersion);
  expect(actual.stateSequence).toBe(expected.stateSequence);
  expect(actual.flags).toBe(expected.flags);
  expectVec(actual.position, expected.position);
  expectVec(actual.rotation, expected.rotation);
  expectVec(actual.linearVelocity, expected.linearVelocity);
  expectVec(actual.angularVelocity, expected.angularVelocity);
  if (actual.kind === "player" && expected.kind === "player") {
    expect(actual.yaw).toBeCloseTo(expected.yaw, 5);
    expect(actual.verticalVelocity).toBeCloseTo(expected.verticalVelocity, 5);
    expect(actual.grounded).toBe(expected.grounded);
    expect(actual.crouched).toBe(expected.crouched);
    expect(actual.lastJumpCounter).toBe(expected.lastJumpCounter);
    expect(actual.stepCooldown).toBeCloseTo(expected.stepCooldown, 5);
  }
}

function expectStateList(
  actual: NetworkObjectState[],
  expected: NetworkObjectState[],
): void {
  expect(actual).toHaveLength(expected.length);
  for (const [index, state] of actual.entries())
    expectState(state, expected[index]!);
}

function expectVec(
  actual: Record<string, number>,
  expected: Record<string, number>,
): void {
  for (const key of Object.keys(expected))
    expect(actual[key]).toBeCloseTo(expected[key]!, 5);
}
