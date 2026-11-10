import {
  INPUT_BUNDLE_REDUNDANCY,
  PREDICTION_BODY_CAPACITY,
  PROTOCOL_VERSION,
  STATE_CLUSTER_MAX_BYTES,
} from "./config";
import type {
  BootstrapStatePacket,
  InputBundlePacket,
  InputCommand,
  ManipulationStatePacket,
  NetworkObjectState,
  OwnershipChangedPacket,
  PredictionCheckpointPacket,
  Quat,
  RuntimeId,
  StateAckPacket,
  StateClusterPacket,
  StateDelta,
  Vec3,
} from "./types";

export const STATE_CLUSTER_TAG = 17;
export const STATE_ACK_TAG = 18;
export const BOOTSTRAP_STATE_TAG = 19;
export const OWNERSHIP_CHANGED_TAG = 20;
export const MANIPULATION_STATE_TAG = 23;
export const INPUT_BUNDLE_TAG = 24;
export const PREDICTION_CHECKPOINT_TAG = 25;

export const STATE_FIELD_POSITION = 1 << 0;
export const STATE_FIELD_ROTATION = 1 << 1;
export const STATE_FIELD_LINEAR_VELOCITY = 1 << 2;
export const STATE_FIELD_ANGULAR_VELOCITY = 1 << 3;
export const STATE_FIELD_FLAGS = 1 << 4;
export const STATE_FIELD_PLAYER = 1 << 5;
export const BODY_STATE_FIELDS =
  STATE_FIELD_POSITION |
  STATE_FIELD_ROTATION |
  STATE_FIELD_LINEAR_VELOCITY |
  STATE_FIELD_ANGULAR_VELOCITY |
  STATE_FIELD_FLAGS;
export const PLAYER_STATE_FIELDS = BODY_STATE_FIELDS | STATE_FIELD_PLAYER;

const MAX_BOOTSTRAP_STATES = 2_048;
const MAX_ACK_ENTRIES = 2_048;
const NULL_REQUEST_ID = 0xffff_ffff;

export function fullStateDelta(state: NetworkObjectState): StateDelta {
  return {
    kind: state.kind,
    id: { ...state.id },
    authorityVersion: state.authorityVersion,
    stateSequence: state.stateSequence,
    sourceTick: state.sourceTick,
    baselineSequence: null,
    fieldMask:
      state.kind === "player" ? PLAYER_STATE_FIELDS : BODY_STATE_FIELDS,
    position: { ...state.position },
    rotation: { ...state.rotation },
    linearVelocity: { ...state.linearVelocity },
    angularVelocity: { ...state.angularVelocity },
    flags: state.flags,
    ...(state.kind === "player"
      ? {
          player: {
            yaw: state.yaw,
            verticalVelocity: state.verticalVelocity,
            grounded: state.grounded,
            crouched: state.crouched,
            lastJumpCounter: state.lastJumpCounter,
            stepCooldown: state.stepCooldown,
          },
        }
      : {}),
  };
}

export function createStateDelta(
  state: NetworkObjectState,
  baseline: NetworkObjectState | null,
): StateDelta {
  if (
    !baseline ||
    baseline.kind !== state.kind ||
    !sameId(baseline.id, state.id) ||
    baseline.authorityVersion !== state.authorityVersion
  ) {
    return fullStateDelta(state);
  }
  let fieldMask = 0;
  const delta: StateDelta = {
    kind: state.kind,
    id: { ...state.id },
    authorityVersion: state.authorityVersion,
    stateSequence: state.stateSequence,
    sourceTick: state.sourceTick,
    baselineSequence: baseline.stateSequence,
    fieldMask,
  };
  if (!sameVec3(state.position, baseline.position)) {
    fieldMask |= STATE_FIELD_POSITION;
    delta.position = { ...state.position };
  }
  if (!sameQuat(state.rotation, baseline.rotation)) {
    fieldMask |= STATE_FIELD_ROTATION;
    delta.rotation = { ...state.rotation };
  }
  if (!sameVec3(state.linearVelocity, baseline.linearVelocity)) {
    fieldMask |= STATE_FIELD_LINEAR_VELOCITY;
    delta.linearVelocity = { ...state.linearVelocity };
  }
  if (!sameVec3(state.angularVelocity, baseline.angularVelocity)) {
    fieldMask |= STATE_FIELD_ANGULAR_VELOCITY;
    delta.angularVelocity = { ...state.angularVelocity };
  }
  if (state.flags !== baseline.flags) {
    fieldMask |= STATE_FIELD_FLAGS;
    delta.flags = state.flags;
  }
  if (
    state.kind === "player" &&
    baseline.kind === "player" &&
    (state.yaw !== baseline.yaw ||
      state.verticalVelocity !== baseline.verticalVelocity ||
      state.grounded !== baseline.grounded ||
      state.crouched !== baseline.crouched ||
      state.lastJumpCounter !== baseline.lastJumpCounter ||
      state.stepCooldown !== baseline.stepCooldown)
  ) {
    fieldMask |= STATE_FIELD_PLAYER;
    delta.player = {
      yaw: state.yaw,
      verticalVelocity: state.verticalVelocity,
      grounded: state.grounded,
      crouched: state.crouched,
      lastJumpCounter: state.lastJumpCounter,
      stepCooldown: state.stepCooldown,
    };
  }
  delta.fieldMask = fieldMask;
  return delta;
}

export function applyStateDelta(
  baseline: NetworkObjectState | null,
  delta: StateDelta,
): NetworkObjectState {
  const required =
    delta.kind === "player" ? PLAYER_STATE_FIELDS : BODY_STATE_FIELDS;
  const matching =
    baseline !== null &&
    baseline.kind === delta.kind &&
    sameId(baseline.id, delta.id) &&
    baseline.authorityVersion === delta.authorityVersion &&
    baseline.stateSequence === delta.baselineSequence;
  if (delta.baselineSequence !== null && !matching)
    throw new Error("state delta requires an unavailable baseline");
  if (
    delta.baselineSequence === null &&
    (delta.fieldMask & required) !== required
  )
    throw new Error(
      "state delta without a baseline must contain complete state",
    );
  const position = pickVec3(
    delta,
    STATE_FIELD_POSITION,
    delta.position,
    baseline?.position,
  );
  const rotation = pickQuat(
    delta,
    STATE_FIELD_ROTATION,
    delta.rotation,
    baseline?.rotation,
  );
  const linearVelocity = pickVec3(
    delta,
    STATE_FIELD_LINEAR_VELOCITY,
    delta.linearVelocity,
    baseline?.linearVelocity,
  );
  const angularVelocity = pickVec3(
    delta,
    STATE_FIELD_ANGULAR_VELOCITY,
    delta.angularVelocity,
    baseline?.angularVelocity,
  );
  const flags =
    delta.fieldMask & STATE_FIELD_FLAGS
      ? requireUint(delta.flags, 0xffff, "state flags")
      : requireUint(baseline?.flags, 0xffff, "baseline flags");
  const common = {
    id: { ...delta.id },
    authorityVersion: delta.authorityVersion,
    stateSequence: delta.stateSequence,
    sourceTick: delta.sourceTick,
    position,
    rotation,
    linearVelocity,
    angularVelocity,
    flags,
  } as const;
  if (delta.kind === "body") return { ...common, kind: "body" };
  const player =
    delta.fieldMask & STATE_FIELD_PLAYER
      ? delta.player
      : baseline?.kind === "player"
        ? {
            yaw: baseline.yaw,
            verticalVelocity: baseline.verticalVelocity,
            grounded: baseline.grounded,
            crouched: baseline.crouched,
            lastJumpCounter: baseline.lastJumpCounter,
            stepCooldown: baseline.stepCooldown,
          }
        : null;
  if (
    !player ||
    !Number.isFinite(player.yaw) ||
    !Number.isFinite(player.verticalVelocity) ||
    typeof player.grounded !== "boolean" ||
    typeof player.crouched !== "boolean" ||
    !Number.isInteger(player.lastJumpCounter) ||
    player.lastJumpCounter < 0 ||
    player.lastJumpCounter > 0xffff_ffff ||
    !Number.isFinite(player.stepCooldown)
  ) {
    throw new Error("invalid player state");
  }
  return { ...common, kind: "player", ...player };
}

export function encodeStateCluster(packet: StateClusterPacket): ArrayBuffer {
  const writer = new Writer();
  writer.u8(STATE_CLUSTER_TAG);
  writer.u32(packet.worldEpoch);
  writer.u16(packet.clusterSequence);
  writer.u16(packet.states.length);
  for (const state of packet.states) writeDelta(writer, state);
  const bytes = writer.finish();
  if (bytes.byteLength > STATE_CLUSTER_MAX_BYTES)
    throw new Error("state cluster exceeds the 1200-byte transport budget");
  return bytes;
}

export function decodeStateCluster(
  bytes: ArrayBuffer | ArrayBufferView,
): StateClusterPacket {
  const reader = new Reader(bytes);
  reader.tag(STATE_CLUSTER_TAG);
  const worldEpoch = reader.u32();
  const clusterSequence = reader.u16();
  const count = reader.u16();
  const states: StateDelta[] = [];
  for (let index = 0; index < count; index += 1) states.push(readDelta(reader));
  reader.done();
  return { worldEpoch, clusterSequence, states };
}

export function clusterStateDeltas(
  worldEpoch: number,
  firstClusterSequence: number,
  states: readonly StateDelta[],
): { clusters: StateClusterPacket[]; nextClusterSequence: number } {
  const clusters: StateClusterPacket[] = [];
  let sequence = firstClusterSequence & 0xffff;
  let pending: StateDelta[] = [];
  for (const state of states) {
    const candidate = {
      worldEpoch,
      clusterSequence: sequence,
      states: [...pending, state],
    };
    try {
      encodeStateCluster(candidate);
      pending.push(state);
    } catch {
      if (pending.length === 0)
        throw new Error(
          "one state delta exceeds the 1200-byte transport budget",
        );
      clusters.push({ worldEpoch, clusterSequence: sequence, states: pending });
      sequence = (sequence + 1) & 0xffff;
      pending = [state];
      encodeStateCluster({
        worldEpoch,
        clusterSequence: sequence,
        states: pending,
      });
    }
  }
  if (pending.length > 0) {
    clusters.push({ worldEpoch, clusterSequence: sequence, states: pending });
    sequence = (sequence + 1) & 0xffff;
  }
  return { clusters, nextClusterSequence: sequence };
}

export function encodeStateAck(packet: StateAckPacket): ArrayBuffer {
  if (packet.entries.length > MAX_ACK_ENTRIES)
    throw new Error("state ack contains too many entries");
  const writer = new Writer();
  writer.u8(STATE_ACK_TAG);
  writer.u32(packet.worldEpoch);
  writer.u16(packet.entries.length);
  for (const entry of packet.entries) {
    writeId(writer, entry.id);
    writer.u32(entry.authorityVersion);
    writer.u16(entry.stateSequence);
  }
  return writer.finish();
}

export function decodeStateAck(
  bytes: ArrayBuffer | ArrayBufferView,
): StateAckPacket {
  const reader = new Reader(bytes);
  reader.tag(STATE_ACK_TAG);
  const worldEpoch = reader.u32();
  const count = reader.u16();
  if (count > MAX_ACK_ENTRIES)
    throw new Error("state ack contains too many entries");
  const entries: StateAckPacket["entries"] = [];
  for (let index = 0; index < count; index += 1) {
    entries.push({
      id: readId(reader),
      authorityVersion: reader.u32(),
      stateSequence: reader.u16(),
    });
  }
  reader.done();
  return { worldEpoch, entries };
}

export function encodeBootstrapState(
  packet: BootstrapStatePacket,
): ArrayBuffer {
  if (packet.states.length > MAX_BOOTSTRAP_STATES)
    throw new Error("bootstrap contains too many objects");
  return encodeStateList(
    BOOTSTRAP_STATE_TAG,
    packet.worldEpoch,
    packet.states.map(fullStateDelta),
  );
}

export function decodeBootstrapState(
  bytes: ArrayBuffer | ArrayBufferView,
): BootstrapStatePacket {
  const packet = decodeStateList(
    bytes,
    BOOTSTRAP_STATE_TAG,
    MAX_BOOTSTRAP_STATES,
  );
  return {
    worldEpoch: packet.worldEpoch,
    states: packet.states.map((state) => applyStateDelta(null, state)),
  };
}

export function encodeOwnershipChanged(
  packet: OwnershipChangedPacket,
): ArrayBuffer {
  assertStateMatchesOwnership(packet);
  const writer = new Writer();
  writer.u8(OWNERSHIP_CHANGED_TAG);
  writer.u32(packet.worldEpoch);
  writer.u32(packet.requestId ?? NULL_REQUEST_ID);
  writeId(writer, packet.id);
  writer.u8(packet.ownerPlayerId ? 1 : 0);
  if (packet.ownerPlayerId) writeId(writer, packet.ownerPlayerId);
  writer.u32(packet.authorityVersion);
  writeDelta(writer, fullStateDelta(packet.state));
  return writer.finish();
}

export function decodeOwnershipChanged(
  bytes: ArrayBuffer | ArrayBufferView,
): OwnershipChangedPacket {
  const reader = new Reader(bytes);
  reader.tag(OWNERSHIP_CHANGED_TAG);
  const worldEpoch = reader.u32();
  const encodedRequestId = reader.u32();
  const id = readId(reader);
  const hasOwner = reader.u8();
  if (hasOwner > 1) throw new Error("invalid ownership owner marker");
  const ownerPlayerId = hasOwner === 1 ? readId(reader) : null;
  const authorityVersion = reader.u32();
  const state = applyStateDelta(null, readDelta(reader));
  reader.done();
  const packet = {
    worldEpoch,
    requestId: encodedRequestId === NULL_REQUEST_ID ? null : encodedRequestId,
    id,
    ownerPlayerId,
    authorityVersion,
    state,
  };
  assertStateMatchesOwnership(packet);
  return packet;
}

export function encodeManipulationState(
  packet: ManipulationStatePacket,
): ArrayBuffer {
  if (
    !Number.isSafeInteger(packet.worldEpoch) ||
    packet.worldEpoch < 0 ||
    !Number.isSafeInteger(packet.authorityVersion) ||
    packet.authorityVersion < 0 ||
    !Number.isSafeInteger(packet.claimVersion) ||
    packet.claimVersion < 1 ||
    !Number.isInteger(packet.stateSequence) ||
    packet.stateSequence < 0 ||
    packet.stateSequence > 0xffff ||
    !finiteVec3(packet.targetPosition) ||
    !finiteQuat(packet.targetRotation)
  ) {
    throw new Error("manipulation state fields are invalid");
  }
  const writer = new Writer();
  writer.u8(MANIPULATION_STATE_TAG);
  writer.u32(packet.worldEpoch);
  writeId(writer, packet.target);
  writer.u32(packet.authorityVersion);
  writer.u32(packet.claimVersion);
  writer.u16(packet.stateSequence);
  writeVec3(writer, packet.targetPosition);
  writeQuat(writer, packet.targetRotation);
  return writer.finish();
}

export function decodeManipulationState(
  bytes: ArrayBuffer | ArrayBufferView,
): ManipulationStatePacket {
  const reader = new Reader(bytes);
  reader.tag(MANIPULATION_STATE_TAG);
  const packet = {
    worldEpoch: reader.u32(),
    target: readId(reader),
    authorityVersion: reader.u32(),
    claimVersion: reader.u32(),
    stateSequence: reader.u16(),
    targetPosition: readVec3(reader),
    targetRotation: readQuat(reader),
  };
  reader.done();
  if (
    packet.claimVersion < 1 ||
    !finiteVec3(packet.targetPosition) ||
    !finiteQuat(packet.targetRotation)
  )
    throw new Error("manipulation state fields are invalid");
  return packet;
}

export function encodeInputBundle(packet: InputBundlePacket): ArrayBuffer {
  if (
    packet.commands.length < 1 ||
    packet.commands.length > INPUT_BUNDLE_REDUNDANCY
  )
    throw new Error("input bundle command count is invalid");
  const writer = new Writer();
  writer.u8(INPUT_BUNDLE_TAG);
  writer.u32(packet.worldEpoch);
  writer.u8(packet.commands.length);
  let previousSequence = -1;
  for (const command of packet.commands) {
    validateInputCommand(command, packet.worldEpoch);
    if (command.sequence <= previousSequence)
      throw new Error("input bundle commands must be ordered by sequence");
    previousSequence = command.sequence;
    writeInputCommand(writer, command);
  }
  return writer.finish();
}

export function decodeInputBundle(
  bytes: ArrayBuffer | ArrayBufferView,
): InputBundlePacket {
  const reader = new Reader(bytes);
  reader.tag(INPUT_BUNDLE_TAG);
  const worldEpoch = reader.u32();
  const count = reader.u8();
  if (count < 1 || count > INPUT_BUNDLE_REDUNDANCY)
    throw new Error("input bundle command count is invalid");
  const commands: InputCommand[] = [];
  let previousSequence = -1;
  for (let index = 0; index < count; index += 1) {
    const command = readInputCommand(reader, worldEpoch);
    if (command.sequence <= previousSequence)
      throw new Error("input bundle commands must be ordered by sequence");
    previousSequence = command.sequence;
    commands.push(command);
  }
  reader.done();
  return { worldEpoch, commands };
}

export function encodePredictionCheckpoint(
  packet: PredictionCheckpointPacket,
): ArrayBuffer {
  if (
    !Number.isSafeInteger(packet.serverTick) ||
    packet.serverTick < 0 ||
    (packet.lastProcessedInputSequence !== null &&
      (!Number.isSafeInteger(packet.lastProcessedInputSequence) ||
        packet.lastProcessedInputSequence < 0 ||
        packet.lastProcessedInputSequence >= NULL_REQUEST_ID))
  )
    throw new Error("prediction checkpoint header is invalid");
  const writer = new Writer();
  writer.u8(PREDICTION_CHECKPOINT_TAG);
  writer.u32(packet.worldEpoch);
  writer.u32(packet.serverTick >>> 0);
  writer.u32(packet.lastProcessedInputSequence ?? NULL_REQUEST_ID);
  writeDelta(writer, fullStateDelta(packet.player));
  if (packet.nearbyBodies.length > PREDICTION_BODY_CAPACITY)
    throw new Error("prediction checkpoint has too many nearby bodies");
  const nearbyIds = new Set<string>();
  writer.u8(packet.nearbyBodies.length);
  for (const body of packet.nearbyBodies) {
    const identity = `${body.id.index}:${body.id.generation}`;
    if (nearbyIds.has(identity))
      throw new Error("prediction checkpoint contains duplicate nearby bodies");
    nearbyIds.add(identity);
    writeDelta(writer, fullStateDelta(body));
  }
  writer.u8(packet.held ? 1 : 0);
  if (packet.held) {
    if (
      nearbyIds.has(
        `${packet.held.body.id.index}:${packet.held.body.id.generation}`,
      )
    )
      throw new Error("prediction checkpoint duplicates its held body");
    if (
      !Number.isSafeInteger(packet.held.claimVersion) ||
      packet.held.claimVersion < 1 ||
      (packet.held.startInputSequence !== null &&
        (!Number.isSafeInteger(packet.held.startInputSequence) ||
          packet.held.startInputSequence < 0 ||
          packet.held.startInputSequence >= NULL_REQUEST_ID)) ||
      !Number.isFinite(packet.held.distance) ||
      !Number.isFinite(packet.held.errorSeconds)
    )
      throw new Error("prediction held-body state is invalid");
    writer.u32(packet.held.claimVersion);
    writer.u32(packet.held.startInputSequence ?? NULL_REQUEST_ID);
    writeVec3(writer, packet.held.localAnchor);
    writeDelta(writer, fullStateDelta(packet.held.body));
    writer.f32(packet.held.distance);
    writeQuat(writer, packet.held.relativeRotation);
    writeVec3(writer, packet.held.targetPosition);
    writeQuat(writer, packet.held.targetRotation);
    writer.f32(packet.held.errorSeconds);
  }
  return writer.finish();
}

export function decodePredictionCheckpoint(
  bytes: ArrayBuffer | ArrayBufferView,
): PredictionCheckpointPacket {
  const reader = new Reader(bytes);
  reader.tag(PREDICTION_CHECKPOINT_TAG);
  const worldEpoch = reader.u32();
  const serverTick = reader.u32();
  const encodedSequence = reader.u32();
  const player = applyStateDelta(null, readDelta(reader));
  if (player.kind !== "player")
    throw new Error("prediction checkpoint requires player state");
  const nearbyCount = reader.u8();
  if (nearbyCount > PREDICTION_BODY_CAPACITY)
    throw new Error("prediction checkpoint has too many nearby bodies");
  const nearbyBodies = [];
  const nearbyIds = new Set<string>();
  for (let index = 0; index < nearbyCount; index += 1) {
    const body = applyStateDelta(null, readDelta(reader));
    const identity = `${body.id.index}:${body.id.generation}`;
    if (body.kind !== "body" || nearbyIds.has(identity))
      throw new Error("prediction checkpoint nearby-body state is invalid");
    nearbyIds.add(identity);
    nearbyBodies.push(body);
  }
  const hasHeld = reader.u8();
  if (hasHeld > 1) throw new Error("invalid prediction held-body marker");
  let held: PredictionCheckpointPacket["held"] = null;
  if (hasHeld === 1) {
    const claimVersion = reader.u32();
    const encodedStartInputSequence = reader.u32();
    const localAnchor = readVec3(reader);
    const body = applyStateDelta(null, readDelta(reader));
    if (claimVersion < 1 || body.kind !== "body")
      throw new Error("prediction held-body state is invalid");
    if (nearbyIds.has(`${body.id.index}:${body.id.generation}`))
      throw new Error("prediction checkpoint duplicates its held body");
    held = {
      claimVersion,
      startInputSequence:
        encodedStartInputSequence === NULL_REQUEST_ID
          ? null
          : encodedStartInputSequence,
      localAnchor,
      body,
      distance: reader.f32(),
      relativeRotation: readQuat(reader),
      targetPosition: readVec3(reader),
      targetRotation: readQuat(reader),
      errorSeconds: reader.f32(),
    };
  }
  reader.done();
  return {
    worldEpoch,
    serverTick,
    lastProcessedInputSequence:
      encodedSequence === NULL_REQUEST_ID ? null : encodedSequence,
    player,
    nearbyBodies,
    held,
  };
}

export function binaryPacketTag(bytes: ArrayBuffer | ArrayBufferView): number {
  const view = byteView(bytes);
  if (view.byteLength === 0) throw new Error("empty binary packet");
  return view[0]!;
}

function writeInputCommand(writer: Writer, command: InputCommand): void {
  writer.u32(command.sequence);
  writer.u32(command.clientTick);
  writer.f32(command.moveX);
  writer.f32(command.moveZ);
  writer.f32(command.lookYaw);
  writer.f32(command.lookPitch);
  writer.u16(command.buttons);
  writer.u32(command.jumpCounter);
  writer.u32(command.interactCounter);
  writer.u8(command.interactTarget ? 1 : 0);
  if (command.interactTarget) writeId(writer, command.interactTarget);
  writer.u32(command.primaryCounter);
}

function readInputCommand(reader: Reader, worldEpoch: number): InputCommand {
  const command: InputCommand = {
    type: "input",
    protocolVersion: PROTOCOL_VERSION,
    worldEpoch,
    sequence: reader.u32(),
    clientTick: reader.u32(),
    moveX: reader.f32(),
    moveZ: reader.f32(),
    lookYaw: reader.f32(),
    lookPitch: reader.f32(),
    buttons: reader.u16(),
    jumpCounter: reader.u32(),
    interactCounter: reader.u32(),
    interactTarget: null,
    primaryCounter: 0,
  };
  const hasTarget = reader.u8();
  if (hasTarget > 1) throw new Error("invalid input target marker");
  command.interactTarget = hasTarget === 1 ? readId(reader) : null;
  command.primaryCounter = reader.u32();
  validateInputCommand(command, worldEpoch);
  return command;
}

function validateInputCommand(command: InputCommand, worldEpoch: number): void {
  if (
    command.type !== "input" ||
    command.protocolVersion !== PROTOCOL_VERSION ||
    command.worldEpoch !== worldEpoch ||
    !Number.isSafeInteger(command.sequence) ||
    command.sequence < 0 ||
    command.sequence >= NULL_REQUEST_ID ||
    !Number.isSafeInteger(command.clientTick) ||
    command.clientTick < 0 ||
    command.clientTick > 0xffff_ffff ||
    ![command.moveX, command.moveZ, command.lookYaw, command.lookPitch].every(
      Number.isFinite,
    ) ||
    Math.abs(command.moveX) > 1 ||
    Math.abs(command.moveZ) > 1 ||
    Math.abs(command.lookPitch) > Math.PI / 2 ||
    !Number.isInteger(command.buttons) ||
    command.buttons < 0 ||
    command.buttons > 0xffff ||
    ![
      command.jumpCounter,
      command.interactCounter,
      command.primaryCounter,
    ].every(
      (value) => Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff,
    )
  )
    throw new Error("input command fields are invalid");
  if (command.interactTarget) {
    requireUint(
      command.interactTarget.index,
      0xffff_ffff,
      "input target index",
    );
    requireUint(
      command.interactTarget.generation,
      0xffff_ffff,
      "input target generation",
    );
  }
}

function encodeStateList(
  tag: number,
  worldEpoch: number,
  states: StateDelta[],
): ArrayBuffer {
  const writer = new Writer();
  writer.u8(tag);
  writer.u32(worldEpoch);
  writer.u16(states.length);
  for (const state of states) writeDelta(writer, state);
  return writer.finish();
}

function decodeStateList(
  bytes: ArrayBuffer | ArrayBufferView,
  tag: number,
  maximum: number,
): { worldEpoch: number; states: StateDelta[] } {
  const reader = new Reader(bytes);
  reader.tag(tag);
  const worldEpoch = reader.u32();
  const count = reader.u16();
  if (count > maximum)
    throw new Error("state packet contains too many objects");
  const states: StateDelta[] = [];
  for (let index = 0; index < count; index += 1) states.push(readDelta(reader));
  reader.done();
  return { worldEpoch, states };
}

function writeDelta(writer: Writer, delta: StateDelta): void {
  validateDelta(delta);
  writer.u8(delta.kind === "body" ? 0 : 1);
  writeId(writer, delta.id);
  writer.u32(delta.authorityVersion);
  writer.u16(delta.stateSequence);
  writer.u32(delta.sourceTick);
  writer.u8(delta.baselineSequence === null ? 0 : 1);
  if (delta.baselineSequence !== null) writer.u16(delta.baselineSequence);
  writer.u8(delta.fieldMask);
  if (delta.fieldMask & STATE_FIELD_POSITION)
    writeVec3(writer, delta.position!);
  if (delta.fieldMask & STATE_FIELD_ROTATION)
    writeQuat(writer, delta.rotation!);
  if (delta.fieldMask & STATE_FIELD_LINEAR_VELOCITY)
    writeVec3(writer, delta.linearVelocity!);
  if (delta.fieldMask & STATE_FIELD_ANGULAR_VELOCITY)
    writeVec3(writer, delta.angularVelocity!);
  if (delta.fieldMask & STATE_FIELD_FLAGS) writer.u16(delta.flags!);
  if (delta.fieldMask & STATE_FIELD_PLAYER) {
    writer.f32(delta.player!.yaw);
    writer.f32(delta.player!.verticalVelocity);
    writer.u8(delta.player!.grounded ? 1 : 0);
    writer.u8(delta.player!.crouched ? 1 : 0);
    writer.u32(delta.player!.lastJumpCounter);
    writer.f32(delta.player!.stepCooldown);
  }
}

function readDelta(reader: Reader): StateDelta {
  const encodedKind = reader.u8();
  if (encodedKind > 1) throw new Error("invalid network object kind");
  const kind = encodedKind === 0 ? "body" : "player";
  const id = readId(reader);
  const authorityVersion = reader.u32();
  const stateSequence = reader.u16();
  const sourceTick = reader.u32();
  const hasBaseline = reader.u8();
  if (hasBaseline > 1) throw new Error("invalid state baseline marker");
  const baselineSequence = hasBaseline === 1 ? reader.u16() : null;
  const fieldMask = reader.u8();
  const permitted = kind === "player" ? PLAYER_STATE_FIELDS : BODY_STATE_FIELDS;
  if ((fieldMask & ~permitted) !== 0)
    throw new Error("invalid state field mask");
  const delta: StateDelta = {
    kind,
    id,
    authorityVersion,
    stateSequence,
    sourceTick,
    baselineSequence,
    fieldMask,
  };
  if (fieldMask & STATE_FIELD_POSITION) delta.position = readVec3(reader);
  if (fieldMask & STATE_FIELD_ROTATION) delta.rotation = readQuat(reader);
  if (fieldMask & STATE_FIELD_LINEAR_VELOCITY)
    delta.linearVelocity = readVec3(reader);
  if (fieldMask & STATE_FIELD_ANGULAR_VELOCITY)
    delta.angularVelocity = readVec3(reader);
  if (fieldMask & STATE_FIELD_FLAGS) delta.flags = reader.u16();
  if (fieldMask & STATE_FIELD_PLAYER) {
    const yaw = reader.f32();
    const verticalVelocity = reader.f32();
    const grounded = readBoolean(reader);
    const crouched = readBoolean(reader);
    const lastJumpCounter = reader.u32();
    const stepCooldown = reader.f32();
    delta.player = {
      yaw,
      verticalVelocity,
      grounded,
      crouched,
      lastJumpCounter,
      stepCooldown,
    };
  }
  validateDelta(delta);
  return delta;
}

function validateDelta(delta: StateDelta): void {
  requireUint(delta.id.index, 0xffff_ffff, "runtime index");
  requireUint(delta.id.generation, 0xffff_ffff, "runtime generation");
  requireUint(delta.authorityVersion, 0xffff_ffff, "authority version");
  requireUint(delta.stateSequence, 0xffff, "state sequence");
  requireUint(delta.sourceTick, 0xffff_ffff, "source tick");
  if (delta.baselineSequence !== null)
    requireUint(delta.baselineSequence, 0xffff, "state baseline sequence");
  const permitted =
    delta.kind === "player" ? PLAYER_STATE_FIELDS : BODY_STATE_FIELDS;
  requireUint(delta.fieldMask, permitted, "state field mask");
  if ((delta.fieldMask & ~permitted) !== 0)
    throw new Error("invalid state field mask");
  if (delta.fieldMask & STATE_FIELD_POSITION)
    assertVec3(delta.position, "position");
  if (delta.fieldMask & STATE_FIELD_ROTATION)
    assertQuat(delta.rotation, "rotation");
  if (delta.fieldMask & STATE_FIELD_LINEAR_VELOCITY)
    assertVec3(delta.linearVelocity, "linear velocity");
  if (delta.fieldMask & STATE_FIELD_ANGULAR_VELOCITY)
    assertVec3(delta.angularVelocity, "angular velocity");
  if (delta.fieldMask & STATE_FIELD_FLAGS)
    requireUint(delta.flags, 0xffff, "state flags");
  if (delta.fieldMask & STATE_FIELD_PLAYER) {
    if (
      !delta.player ||
      !Number.isFinite(delta.player.yaw) ||
      !Number.isFinite(delta.player.verticalVelocity) ||
      typeof delta.player.grounded !== "boolean" ||
      typeof delta.player.crouched !== "boolean" ||
      !Number.isInteger(delta.player.lastJumpCounter) ||
      delta.player.lastJumpCounter < 0 ||
      delta.player.lastJumpCounter > 0xffff_ffff ||
      !Number.isFinite(delta.player.stepCooldown)
    ) {
      throw new Error("invalid player state");
    }
  }
}

function assertStateMatchesOwnership(packet: OwnershipChangedPacket): void {
  if (
    !sameId(packet.id, packet.state.id) ||
    packet.authorityVersion !== packet.state.authorityVersion
  ) {
    throw new Error("ownership state does not match its object");
  }
}

function pickVec3(
  delta: StateDelta,
  bit: number,
  value: Vec3 | undefined,
  baseline: Vec3 | undefined,
): Vec3 {
  const selected = delta.fieldMask & bit ? value : baseline;
  assertVec3(selected, "state vector");
  return { ...selected };
}

function pickQuat(
  delta: StateDelta,
  bit: number,
  value: Quat | undefined,
  baseline: Quat | undefined,
): Quat {
  const selected = delta.fieldMask & bit ? value : baseline;
  assertQuat(selected, "state rotation");
  return { ...selected };
}

function writeId(writer: Writer, id: RuntimeId): void {
  writer.u32(id.index);
  writer.u32(id.generation);
}

function readId(reader: Reader): RuntimeId {
  return { index: reader.u32(), generation: reader.u32() };
}

function writeVec3(writer: Writer, value: Vec3): void {
  assertVec3(value, "state vector");
  writer.f32(value.x);
  writer.f32(value.y);
  writer.f32(value.z);
}

function readVec3(reader: Reader): Vec3 {
  return { x: reader.f32(), y: reader.f32(), z: reader.f32() };
}

function writeQuat(writer: Writer, value: Quat): void {
  assertQuat(value, "state rotation");
  writer.f32(value.x);
  writer.f32(value.y);
  writer.f32(value.z);
  writer.f32(value.w);
}

function readQuat(reader: Reader): Quat {
  return { x: reader.f32(), y: reader.f32(), z: reader.f32(), w: reader.f32() };
}

function readBoolean(reader: Reader): boolean {
  const value = reader.u8();
  if (value > 1) throw new Error("invalid boolean field");
  return value === 1;
}

function assertVec3(
  value: Vec3 | undefined,
  label: string,
): asserts value is Vec3 {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite))
    throw new Error(`invalid ${label}`);
}

function assertQuat(
  value: Quat | undefined,
  label: string,
): asserts value is Quat {
  if (!value || ![value.x, value.y, value.z, value.w].every(Number.isFinite))
    throw new Error(`invalid ${label}`);
}

function requireUint(
  value: number | undefined,
  maximum: number,
  label: string,
): number {
  if (!Number.isInteger(value) || value! < 0 || value! > maximum)
    throw new Error(`invalid ${label}`);
  return value!;
}

function sameId(a: RuntimeId, b: RuntimeId): boolean {
  return a.index === b.index && a.generation === b.generation;
}

function sameVec3(a: Vec3, b: Vec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function finiteVec3(value: Vec3): boolean {
  return [value.x, value.y, value.z].every(Number.isFinite);
}

function finiteQuat(value: Quat): boolean {
  return [value.x, value.y, value.z, value.w].every(Number.isFinite);
}

function sameQuat(a: Quat, b: Quat): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z && a.w === b.w;
}

function byteView(bytes: ArrayBuffer | ArrayBufferView): Uint8Array {
  return bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes)
    : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

class Writer {
  #bytes = new Uint8Array(256);
  #view = new DataView(this.#bytes.buffer);
  #offset = 0;

  u8(value: number): void {
    requireUint(value, 0xff, "uint8");
    this.#reserve(1);
    this.#view.setUint8(this.#offset, value);
    this.#offset += 1;
  }

  u16(value: number): void {
    requireUint(value, 0xffff, "uint16");
    this.#reserve(2);
    this.#view.setUint16(this.#offset, value, true);
    this.#offset += 2;
  }

  u32(value: number): void {
    requireUint(value, 0xffff_ffff, "uint32");
    this.#reserve(4);
    this.#view.setUint32(this.#offset, value, true);
    this.#offset += 4;
  }

  f32(value: number): void {
    if (!Number.isFinite(value)) throw new Error("invalid float32");
    this.#reserve(4);
    this.#view.setFloat32(this.#offset, value, true);
    this.#offset += 4;
  }

  finish(): ArrayBuffer {
    return this.#bytes.buffer.slice(0, this.#offset);
  }

  #reserve(length: number): void {
    if (this.#offset + length <= this.#bytes.byteLength) return;
    let capacity = this.#bytes.byteLength;
    while (capacity < this.#offset + length) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.#bytes);
    this.#bytes = next;
    this.#view = new DataView(next.buffer);
  }
}

class Reader {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  #offset = 0;

  constructor(bytes: ArrayBuffer | ArrayBufferView) {
    this.#bytes = byteView(bytes);
    this.#view = new DataView(
      this.#bytes.buffer,
      this.#bytes.byteOffset,
      this.#bytes.byteLength,
    );
  }

  tag(expected: number): void {
    if (this.u8() !== expected) throw new Error("unexpected binary packet tag");
  }

  u8(): number {
    this.#require(1);
    const value = this.#view.getUint8(this.#offset);
    this.#offset += 1;
    return value;
  }

  u16(): number {
    this.#require(2);
    const value = this.#view.getUint16(this.#offset, true);
    this.#offset += 2;
    return value;
  }

  u32(): number {
    this.#require(4);
    const value = this.#view.getUint32(this.#offset, true);
    this.#offset += 4;
    return value;
  }

  f32(): number {
    this.#require(4);
    const value = this.#view.getFloat32(this.#offset, true);
    this.#offset += 4;
    if (!Number.isFinite(value)) throw new Error("invalid float32");
    return value;
  }

  done(): void {
    if (this.#offset !== this.#bytes.byteLength)
      throw new Error("trailing binary packet bytes");
  }

  #require(length: number): void {
    if (this.#offset + length > this.#bytes.byteLength)
      throw new Error("truncated binary packet");
  }
}
