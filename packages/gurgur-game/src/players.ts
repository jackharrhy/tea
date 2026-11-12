import {
  INPUT_QUEUE_CAPACITY,
  INPUT_INTENT_TIMEOUT_TICKS,
  type InputCommand,
  type NetworkPlayerState,
  type RuntimeEntityRef,
  type RuntimeId,
  type Vec3,
} from "@harrhy/gurgur-engine";
import {
  PLAYER_CAPSULE_HALF_SEGMENT,
  PLAYER_CAPSULE_RADIUS,
  PLAYER_CROUCHED_HALF_SEGMENT,
  PLAYER_HALF_HEIGHT,
  PLAYER_WALKABLE_NORMAL_Y,
  type PlayerControllerState,
} from "./controller";
import type { GameEngine } from "./engine-api";
import {
  createPropGrab,
  grabDistanceFor,
  PLAYER_GRAB_REACH,
  playerChest,
  playerViewDirection,
  stepPropGrab,
  type GrabPose,
  type PropGrab,
} from "./grab";
import type { PersistedPlayerState } from "./state";
import type { WorldBundle } from "./world";

const PLAYER_INDEX_BASE = 0x8000_0000;
const MAX_ACTION_EDGES_PER_SERVER_TICK = 4;

export type PlayerIntent = Pick<
  InputCommand,
  | "moveX"
  | "moveZ"
  | "lookYaw"
  | "lookPitch"
  | "buttons"
  | "jumpCounter"
  | "interactCounter"
  | "interactTarget"
  | "primaryCounter"
>;

type Player = {
  id: RuntimeId;
  persistentId: string;
  proxy: RuntimeId;
  state: PlayerControllerState;
  input: PlayerIntent;
  inputQueue: Array<PlayerIntent & { sequence: number }>;
  lastSequence: number;
  lastProcessedInputSequence: number;
  lastInputServerTick: number;
  lastInteractCounter: number;
  lastPrimaryCounter: number;
  grab: PropGrab | null;
  grabStartInputSequence: number | null;
  grabVersion: number;
  authorityVersion: number;
  stateSequence: number;
  sourceTick: number;
};

type PlayerSlot = { generation: number; player: Player | null };

export type GamePlayerView = {
  id: RuntimeId;
  position: Vec3;
  yaw: number;
  verticalVelocity: number;
  grounded: boolean;
  lastProcessedInputSequence: number;
  lastJumpCounter: number;
  stepCooldown: number;
  crouched: boolean;
  grabTarget: RuntimeId | null;
  authorityVersion: number;
};

export type GamePlayerPrediction = {
  lastProcessedInputSequence: number | null;
  grabVersion: number;
  grabStartInputSequence: number | null;
  grab: PropGrab | null;
};

export type GamePlayerTrace = {
  lastReceivedInputSequence: number;
  lastProcessedInputSequence: number;
  queuedInputSequences: number[];
  input: PlayerIntent;
  grabVersion: number;
  grabTarget: RuntimeId | null;
};

export type GamePlayers = {
  views(): GamePlayerView[];
  proxies(): RuntimeId[];
  runtimeRefs(): RuntimeEntityRef[];
  networkStates(): NetworkPlayerState[];
  persisted(): PersistedPlayerState[];
  position(id: RuntimeId): Vec3 | null;
  grabbedTarget(id: RuntimeId): RuntimeId | null;
  releaseGrab(id: RuntimeId): RuntimeId | null;
  prediction(id: RuntimeId): GamePlayerPrediction | null;
  trace(id: RuntimeId): GamePlayerTrace | null;
  canResume(persistentId: string): boolean;
  connect(
    persistentId?: string,
    initial?: { position: Vec3; yaw: number },
  ): RuntimeId;
  disconnect(id: RuntimeId, options?: { persist?: boolean }): boolean;
  acceptInput(
    id: RuntimeId,
    command: InputCommand,
    worldEpoch: number,
  ): boolean;
  reassign(id: RuntimeId): NetworkPlayerState | null;
  step(): void;
  reset(): void;
};

export type GamePlayersOptions = {
  engine: GameEngine;
  bundle: WorldBundle;
  restored: PersistedPlayerState[];
  spawnPosition?: Vec3;
  stepController(
    state: PlayerControllerState,
    input: PlayerIntent,
    proxy: RuntimeId,
  ): PlayerControllerState;
  use(target: RuntimeId, origin: Vec3, displacement: Vec3): boolean;
};

export function createGamePlayers(options: GamePlayersOptions): GamePlayers {
  const { engine, bundle, stepController, use } = options;
  const spawn = bundle.playerSpawns.find(
    (candidate) => candidate.name === "default",
  );
  if (!spawn) throw new Error("map requires a default player spawn");
  const spawnPosition = options.spawnPosition
    ? { ...options.spawnPosition }
    : {
        x: spawn.position.x,
        y: spawn.position.y + PLAYER_HALF_HEIGHT,
        z: spawn.position.z,
      };
  const voidY =
    Math.min(...bundle.staticCollision.vertices.map((vertex) => vertex.y)) - 10;
  const slots: PlayerSlot[] = [];
  const freeSlots: number[] = [];
  const dormant = new Map(
    options.restored.map((player) => [
      player.persistentId,
      structuredClone(player),
    ]),
  );

  const players = (): Player[] =>
    slots.flatMap((slot) => (slot.player ? [slot.player] : []));

  const resolve = (
    id: RuntimeId,
  ): { slotIndex: number; slot: PlayerSlot; player: Player } | null => {
    const slotIndex = id.index - PLAYER_INDEX_BASE;
    const slot = slots[slotIndex];
    if (!slot || slot.generation !== id.generation || !slot.player) return null;
    return { slotIndex, slot, player: slot.player };
  };

  const bodyForAuthoredId = (authoredId: string): RuntimeId | null => {
    const entityIndex = bundle.entities.findIndex(
      (entity) => entity.authoredId === authoredId,
    );
    return entityIndex < 0
      ? null
      : (engine.bodies.forEntity(entityIndex)?.id ?? null);
  };

  const grabbedAuthoredId = (player: Player): string | null => {
    if (!player.grab) return null;
    const body = engine.bodies.resolve(player.grab.target);
    return body
      ? (bundle.entities[body.entityIndex]?.authoredId ?? null)
      : null;
  };

  const persistedPlayer = (player: Player): PersistedPlayerState => ({
    persistentId: player.persistentId,
    position: { ...player.state.position },
    yaw: player.state.yaw,
    verticalVelocity: player.state.verticalVelocity,
    grounded: player.state.grounded,
    lastJumpCounter: player.state.lastJumpCounter,
    stepCooldown: player.state.stepCooldown,
    crouched: player.state.crouched,
    grabbedAuthoredId: grabbedAuthoredId(player),
    grabDistance: player.grab?.distance ?? 0,
  });

  const createGrab = (
    player: Player,
    target: RuntimeId,
    holdDistance: number,
  ): void => {
    player.grabVersion = nextVersion(player.grabVersion);
    player.grabStartInputSequence =
      player.lastProcessedInputSequence < 0
        ? null
        : player.lastProcessedInputSequence;
    player.grab = createPropGrab(
      engine,
      target,
      grabPose(player),
      holdDistance,
    );
  };

  const newPlayer = (
    id: RuntimeId,
    persistentId: string,
    restored?: PersistedPlayerState,
    initial?: { position: Vec3; yaw: number },
  ): Player => {
    const state: PlayerControllerState = initial
      ? defaultState(initial.position, initial.yaw)
      : restored
        ? {
            position: { ...restored.position },
            verticalVelocity: restored.verticalVelocity,
            yaw: restored.yaw,
            grounded: restored.grounded,
            lastJumpCounter: restored.lastJumpCounter,
            stepCooldown: restored.stepCooldown,
            crouched: restored.crouched,
          }
        : defaultState(spawnPosition, spawn.yaw);
    const player: Player = {
      id,
      persistentId,
      proxy: engine.createPlayerProxy(
        state.position,
        playerCapsule(state.crouched),
      ),
      state,
      input: defaultInput(state.yaw),
      inputQueue: [],
      lastSequence: -1,
      lastProcessedInputSequence: -1,
      lastInputServerTick: engine.tick,
      lastInteractCounter: 0,
      lastPrimaryCounter: 0,
      grab: null,
      grabStartInputSequence: null,
      grabVersion: 0,
      authorityVersion: 1,
      stateSequence: 0,
      sourceTick: engine.tick >>> 0,
    };
    if (restored?.grabbedAuthoredId) {
      const target = bodyForAuthoredId(restored.grabbedAuthoredId);
      const alreadyOwned = players().some(
        (candidate) =>
          candidate.grab && target && sameId(candidate.grab.target, target),
      );
      if (target && !alreadyOwned) {
        engine.setBodyAwake(target, true);
        createGrab(player, target, restored.grabDistance);
      }
    }
    return player;
  };

  const respawn = (player: Player, worldRecreated = false): void => {
    if (!worldRecreated) {
      engine.destroyBody(player.proxy);
    }
    player.state = {
      ...defaultState(spawnPosition, spawn.yaw),
      lastJumpCounter: player.input.jumpCounter,
    };
    player.input = worldRecreated
      ? defaultInput(spawn.yaw)
      : {
          ...player.input,
          moveX: 0,
          moveZ: 0,
          lookYaw: spawn.yaw,
          buttons: 0,
        };
    player.inputQueue = [];
    player.grab = null;
    player.grabStartInputSequence = null;
    player.stateSequence = 0;
    player.sourceTick = engine.tick >>> 0;
    if (worldRecreated) {
      player.lastSequence = -1;
      player.lastProcessedInputSequence = -1;
      player.lastInputServerTick = engine.tick;
      player.lastInteractCounter = 0;
      player.lastPrimaryCounter = 0;
    }
    player.proxy = engine.createPlayerProxy(
      player.state.position,
      playerCapsule(false),
    );
    engine.requestSave();
  };

  const dropGrab = (player: Player, save: boolean): void => {
    if (!player.grab) return;
    player.grab = null;
    player.grabStartInputSequence = null;
    if (save) engine.requestSave();
  };

  const tryGrab = (
    player: Player,
    intent: PlayerIntent = player.input,
  ): void => {
    if (player.grab) {
      dropGrab(player, true);
      return;
    }
    const anchor = playerChest(player.state.position);
    const hit = engine.raycast(
      anchor,
      scale(
        playerViewDirection(intent.lookYaw, intent.lookPitch),
        PLAYER_GRAB_REACH,
      ),
    );
    if (!hit) return;
    const target = hit.body;
    if (
      players().some(
        (candidate) => candidate.grab && sameId(candidate.grab.target, target),
      )
    )
      return;
    const runtimeBody = engine.bodies.resolve(hit.body);
    if (
      !runtimeBody ||
      bundle.entities[runtimeBody.entityIndex]?.interaction !== "grab"
    )
      return;
    createGrab(
      player,
      target,
      grabDistanceFor(bundle, runtimeBody.entityIndex),
    );
    engine.requestSave();
  };

  const updateGrab = (player: Player): void => {
    const grab = player.grab;
    if (!grab) return;
    if (!stepPropGrab(engine, grab, grabPose(player))) dropGrab(player, true);
  };

  const dropSupportedGrab = (player: Player): void => {
    if (!player.grab) return;
    const halfHeight =
      PLAYER_CAPSULE_RADIUS +
      (player.state.crouched
        ? PLAYER_CROUCHED_HALF_SEGMENT
        : PLAYER_CAPSULE_HALF_SEGMENT);
    const support = engine.raycast(
      player.state.position,
      { x: 0, y: -(halfHeight + 0.15), z: 0 },
      { ignoreBodies: [player.proxy] },
    );
    if (
      support &&
      support.normal.y >= PLAYER_WALKABLE_NORMAL_Y &&
      sameId(support.body, player.grab.target)
    )
      dropGrab(player, true);
  };

  const tryUse = (
    player: Player,
    target: RuntimeId | null,
    intent: PlayerIntent = player.input,
  ): void => {
    if (!target) return;
    use(
      target,
      playerChest(player.state.position),
      scale(playerViewDirection(intent.lookYaw, intent.lookPitch), 3),
    );
  };

  const step = (): void => {
    for (const player of players()) {
      // Prior intent already covered elapsed ticks; replaying late movement would count them twice.
      // Older arrivals recover action edges only.
      const received = player.inputQueue;
      const pending = received.at(-1) ?? null;
      player.inputQueue = [];
      if (pending) {
        const { sequence, ...intent } = pending;
        player.input = intent;
        player.lastProcessedInputSequence = sequence;
        player.lastInputServerTick = engine.tick;
      } else if (
        engine.tick - player.lastInputServerTick >=
        INPUT_INTENT_TIMEOUT_TICKS
      ) {
        player.input = { ...player.input, moveX: 0, moveZ: 0 };
      }
      const wasCrouched = player.state.crouched;
      player.state = stepController(player.state, player.input, player.proxy);
      if (player.state.position.y < voidY) {
        respawn(player);
        continue;
      }
      if (player.state.crouched !== wasCrouched) {
        engine.destroyBody(player.proxy);
        player.proxy = engine.createPlayerProxy(
          player.state.position,
          playerCapsule(player.state.crouched),
        );
      } else {
        engine.updatePlayerProxy(
          player.proxy,
          player.state.position,
          player.state.yaw,
        );
      }
      for (const command of received) {
        const interactEdges = boundedCounterAdvance(
          player.lastInteractCounter,
          command.interactCounter,
        );
        player.lastInteractCounter = command.interactCounter;
        for (let edge = 0; edge < interactEdges; edge += 1)
          tryUse(player, command.interactTarget, command);

        const primaryEdges = boundedCounterAdvance(
          player.lastPrimaryCounter,
          command.primaryCounter,
        );
        player.lastPrimaryCounter = command.primaryCounter;
        for (let edge = 0; edge < primaryEdges; edge += 1)
          tryGrab(player, command);
      }
      // A carried support feeds its motion back into the grab controller; drop it to break the loop.
      dropSupportedGrab(player);
      updateGrab(player);
      player.stateSequence = (player.stateSequence + 1) & 0xffff;
      player.sourceTick = (engine.tick + 1) >>> 0;
    }
  };

  return {
    views: () =>
      players().map((player) => ({
        id: { ...player.id },
        position: { ...player.state.position },
        yaw: player.state.yaw,
        verticalVelocity: player.state.verticalVelocity,
        grounded: player.state.grounded,
        lastProcessedInputSequence: player.lastProcessedInputSequence,
        lastJumpCounter: player.state.lastJumpCounter,
        stepCooldown: player.state.stepCooldown,
        crouched: player.state.crouched,
        grabTarget: player.grab ? { ...player.grab.target } : null,
        authorityVersion: player.authorityVersion,
      })),
    proxies: () => players().map((player) => ({ ...player.proxy })),
    runtimeRefs: () =>
      players().map((player) => ({
        id: { ...player.id },
        kind: "player",
        ownerPlayerId: null,
        authorityVersion: player.authorityVersion,
        transferPolicy: "fixed",
      })),
    networkStates: () => players().map(networkState),
    persisted: () => [
      ...players().map(persistedPlayer),
      ...dormant.values().map((player) => structuredClone(player)),
    ],
    position(id) {
      const position = resolve(id)?.player.state.position;
      return position ? { ...position } : null;
    },
    grabbedTarget(id) {
      const target = resolve(id)?.player.grab?.target;
      return target ? { ...target } : null;
    },
    releaseGrab(id) {
      const player = resolve(id)?.player;
      const target = player?.grab?.target;
      if (!player || !target) return null;
      dropGrab(player, true);
      return { ...target };
    },
    prediction(id) {
      const player = resolve(id)?.player;
      if (!player) return null;
      return {
        lastProcessedInputSequence:
          player.lastProcessedInputSequence < 0
            ? null
            : player.lastProcessedInputSequence,
        grabVersion: player.grabVersion,
        grabStartInputSequence: player.grabStartInputSequence,
        grab: player.grab
          ? {
              ...player.grab,
              target: { ...player.grab.target },
              relativeRotation: { ...player.grab.relativeRotation },
              targetPosition: { ...player.grab.targetPosition },
              targetRotation: { ...player.grab.targetRotation },
            }
          : null,
      };
    },
    trace(id) {
      const player = resolve(id)?.player;
      if (!player) return null;
      return {
        lastReceivedInputSequence: player.lastSequence,
        lastProcessedInputSequence: player.lastProcessedInputSequence,
        queuedInputSequences: player.inputQueue.map(
          (command) => command.sequence,
        ),
        input: {
          ...player.input,
          interactTarget: player.input.interactTarget
            ? { ...player.input.interactTarget }
            : null,
        },
        grabVersion: player.grabVersion,
        grabTarget: player.grab ? { ...player.grab.target } : null,
      };
    },
    canResume: (persistentId) => dormant.has(persistentId),
    connect(persistentId = crypto.randomUUID(), initial) {
      if (players().some((player) => player.persistentId === persistentId))
        throw new Error("persistent player identity is already connected");
      const slotIndex = freeSlots.pop() ?? slots.length;
      const generation = slots[slotIndex]?.generation ?? 1;
      const id = { index: PLAYER_INDEX_BASE + slotIndex, generation };
      const restored = dormant.get(persistentId);
      dormant.delete(persistentId);
      slots[slotIndex] = {
        generation,
        player: newPlayer(id, persistentId, restored, initial),
      };
      return id;
    },
    disconnect(id, disconnectOptions = {}) {
      const resolved = resolve(id);
      if (!resolved) return false;
      if (disconnectOptions.persist !== false)
        dormant.set(
          resolved.player.persistentId,
          persistedPlayer(resolved.player),
        );
      else dormant.delete(resolved.player.persistentId);
      engine.destroyBody(resolved.player.proxy);
      resolved.slot.player = null;
      resolved.slot.generation += 1;
      freeSlots.push(resolved.slotIndex);
      engine.requestSave();
      return true;
    },
    acceptInput(id, command, worldEpoch) {
      const player = resolve(id)?.player;
      if (!player) return false;
      if (
        command.worldEpoch !== worldEpoch ||
        command.sequence <= player.lastSequence
      )
        return true;
      if (
        command.sequence - Math.max(-1, player.lastProcessedInputSequence) >
        INPUT_QUEUE_CAPACITY * 4
      )
        return false;
      player.lastSequence = command.sequence;
      player.inputQueue.push({
        sequence: command.sequence,
        moveX: clamp(command.moveX, -1, 1),
        moveZ: clamp(command.moveZ, -1, 1),
        lookYaw: command.lookYaw,
        lookPitch: command.lookPitch,
        buttons: command.buttons,
        jumpCounter: command.jumpCounter,
        interactCounter: command.interactCounter,
        interactTarget: command.interactTarget
          ? { ...command.interactTarget }
          : null,
        primaryCounter: command.primaryCounter,
      });
      if (player.inputQueue.length > INPUT_QUEUE_CAPACITY)
        player.inputQueue.shift();
      return true;
    },
    reassign(id) {
      const player = resolve(id)?.player;
      if (!player) return null;
      player.authorityVersion = (player.authorityVersion + 1) >>> 0;
      if (player.authorityVersion === 0) player.authorityVersion = 1;
      player.inputQueue = [];
      player.lastSequence = -1;
      player.lastProcessedInputSequence = -1;
      player.stateSequence = 0;
      player.sourceTick = engine.tick >>> 0;
      return networkState(player);
    },
    step,
    reset() {
      dormant.clear();
      for (const player of players()) {
        player.authorityVersion = (player.authorityVersion + 1) >>> 0;
        if (player.authorityVersion === 0) player.authorityVersion = 1;
        respawn(player, true);
      }
    },
  };
}

function defaultState(position: Vec3, yaw: number): PlayerControllerState {
  return {
    position: { ...position },
    verticalVelocity: 0,
    yaw,
    grounded: false,
    lastJumpCounter: 0,
    stepCooldown: 0,
    crouched: false,
  };
}

function networkState(player: Player): NetworkPlayerState {
  return {
    kind: "player",
    id: { ...player.id },
    authorityVersion: player.authorityVersion,
    stateSequence: player.stateSequence,
    sourceTick: player.sourceTick,
    position: { ...player.state.position },
    rotation: yawRotation(player.state.yaw),
    linearVelocity: { x: 0, y: player.state.verticalVelocity, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    flags: 0,
    yaw: player.state.yaw,
    verticalVelocity: player.state.verticalVelocity,
    grounded: player.state.grounded,
    crouched: player.state.crouched,
    lastJumpCounter: player.state.lastJumpCounter,
    stepCooldown: player.state.stepCooldown,
  };
}

function nextVersion(version: number): number {
  const next = (version + 1) >>> 0;
  return next === 0 ? 1 : next;
}

function defaultInput(yaw: number): PlayerIntent {
  return {
    moveX: 0,
    moveZ: 0,
    lookYaw: yaw,
    lookPitch: 0,
    buttons: 0,
    jumpCounter: 0,
    interactCounter: 0,
    interactTarget: null,
    primaryCounter: 0,
  };
}

function playerCapsule(crouched: boolean) {
  return {
    radius: PLAYER_CAPSULE_RADIUS,
    halfSegment: crouched
      ? PLAYER_CROUCHED_HALF_SEGMENT
      : PLAYER_CAPSULE_HALF_SEGMENT,
  };
}

function grabPose(player: Player): GrabPose {
  return {
    position: player.state.position,
    yaw: player.state.yaw,
    lookYaw: player.input.lookYaw,
    lookPitch: player.input.lookPitch,
  };
}

function yawRotation(yaw: number) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

function scale(value: Vec3, amount: number): Vec3 {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount };
}

function sameId(a: RuntimeId, b: RuntimeId): boolean {
  return a.index === b.index && a.generation === b.generation;
}

function boundedCounterAdvance(previous: number, next: number): number {
  const advance = (next - previous) >>> 0;
  return Math.min(advance, MAX_ACTION_EDGES_PER_SERVER_TICK);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
