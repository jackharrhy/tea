import { PhysicsWorld, type PhysicsStepEvents } from "@tea/gurgur-engine";
import {
  createGameSimulation,
  PLAYER_HALF_HEIGHT,
  stepPlayerController,
  type GameEngine,
  type GamePlayerTrace,
  type GameSimulation,
  type HostMechanismEngine,
  type WorldBundle,
  type WorldMessage,
} from "@tea/gurgur-game";
import {
  MAX_CATCH_UP_TICKS,
  PREDICTION_BODY_CAPACITY,
  PREDICTION_BODY_RADIUS_METRES,
  PHYSICS_DT,
  PHYSICS_HZ,
  PHYSICS_SUBSTEPS,
  PROTOCOL_VERSION,
  NETWORK_FLAG_AWAKE,
  NETWORK_FLAG_HELD,
  STATE_PUBLISH_INTERVAL_TICKS,
  accumulateFixedStepTime,
  cloneNetworkState,
  type InputCommand,
  type ManipulationChangedMessage,
  type ManipulationDropMessage,
  type ManipulationRequestMessage,
  type ManipulationStatePacket,
  type NetworkBodyState,
  type NetworkObjectState,
  type NetworkPlayerState,
  type OwnershipChangedPacket,
  type PhysicsDebugFrame,
  type PredictionCheckpointPacket,
  type Quat,
  type RuntimeId,
  type Snapshot,
  type Vec3,
} from "@tea/gurgur-engine";
import {
  createRuntimeBodies,
  createRuntimeProp,
  runtimeBodyRef,
  type RuntimeBody,
} from "./runtime-bodies";
import type { PersistedWorld, WorldStore } from "./store";
import { WORLD_BUNDLE } from "./world";

const SAVE_INTERVAL_TICKS = 5 / PHYSICS_DT;
const MAX_DEV_PLAYERS = 16;
const MAX_DEV_PROPS = 64;
const DEV_PLAYER_PREFIX = "dev.mcp.player.";

export type DevPlayerIntentUpdate = {
  moveX?: number;
  moveZ?: number;
  lookYaw?: number;
  lookPitch?: number;
  crouch?: boolean;
  action?: "jump" | "interact" | "primary";
  interactTarget?: RuntimeId | null;
  durationSeconds?: number;
};

type DevPlayer = {
  controllerId: string;
  id: RuntimeId;
  sequence: number;
  moveX: number;
  moveZ: number;
  lookYaw: number;
  lookPitch: number;
  buttons: number;
  jumpCounter: number;
  interactCounter: number;
  interactTarget: RuntimeId | null;
  primaryCounter: number;
  stopAtTick: number | null;
};

const RELEASE_HOT_STATE_TICKS = PHYSICS_HZ / 2;
export const NETWORK_TRACE_DURATION_SECONDS = 15;
const NETWORK_TRACE_DURATION_TICKS =
  NETWORK_TRACE_DURATION_SECONDS * PHYSICS_HZ;
const NETWORK_TRACE_RADIUS_METRES = 6;
const NETWORK_TRACE_MAX_BODIES = 32;
const NETWORK_TRACE_MAX_CAPTURES = 4;

type ServerPhysicsTraceContact = {
  kind: "begin" | "end" | "hit";
  a: RuntimeId | null;
  b: RuntimeId | null;
  point?: Vec3;
  normal?: Vec3;
  approachSpeed?: number;
};

type ServerPhysicsTraceFrame = {
  serverTick: number;
  recordedAtMs: number;
  player: NetworkPlayerState;
  input: GamePlayerTrace;
  support: {
    id: RuntimeId | null;
    point: Vec3;
    normal: Vec3;
    fraction: number;
  } | null;
  bodies: NetworkBodyState[];
  contacts: ServerPhysicsTraceContact[];
};

export type ServerPhysicsTraceCapture = {
  format: "gurgur-server-physics-trace";
  version: 1;
  id: string;
  worldEpoch: number;
  mapRevision: string;
  playerId: RuntimeId;
  startedAtServerTick: number;
  endingAtServerTick: number;
  completedAtServerTick: number | null;
  complete: boolean;
  endReason:
    | "duration"
    | "world-reset"
    | "player-missing"
    | "server-stop"
    | null;
  frames: ServerPhysicsTraceFrame[];
};

export class WorldHost {
  readonly #physics: PhysicsWorld;
  readonly #bundle: WorldBundle;
  readonly #store: WorldStore;
  readonly #onState: (states: NetworkObjectState[]) => void;
  readonly #onWorld: (world: WorldMessage) => void;
  readonly #onManipulation: (message: ManipulationChangedMessage) => void;
  #runtimeBodies: RuntimeBody[] = [];
  #simulation!: GameSimulation;
  #saveRequested = false;
  readonly #tickDurationsMs: number[] = [];
  #discardedOverloadSeconds = 0;
  #worldEpoch: number;
  #serverTick: number;
  #accumulator = 0;
  #lastTime = 0;
  #timer: Timer | null = null;
  readonly #playerSpawn: Vec3 | null;
  #extraDynamicBodyCount = 0;
  readonly #devBodyKeys = new Set<string>();
  readonly #devPlayers = new Map<string, DevPlayer>();
  #devBodySequence = 0;
  readonly #lastPublishedBodies = new Map<string, NetworkBodyState>();
  readonly #hotBodyUntilTick = new Map<string, number>();
  readonly #manipulationVersions = new Map<string, number>();
  readonly #networkTraces = new Map<string, ServerPhysicsTraceCapture>();
  readonly #predictionBodySets = new Map<string, string[]>();
  readonly #activeBodyContacts = new Map<string, Set<string>>();

  private constructor(
    physics: PhysicsWorld,
    bundle: WorldBundle,
    store: WorldStore,
    onState: (states: NetworkObjectState[]) => void,
    onWorld: (world: WorldMessage) => void,
    onManipulation: (message: ManipulationChangedMessage) => void,
    worldEpoch: number,
    serverTick: number,
    playerSpawn: Vec3 | null,
  ) {
    this.#physics = physics;
    this.#bundle = bundle;
    this.#store = store;
    this.#onState = onState;
    this.#onWorld = onWorld;
    this.#onManipulation = onManipulation;
    this.#worldEpoch = worldEpoch;
    this.#serverTick = serverTick;
    this.#playerSpawn = playerSpawn ? { ...playerSpawn } : null;
  }

  static async create(
    store: WorldStore,
    onState: (states: NetworkObjectState[]) => void,
    onWorld: (world: WorldMessage) => void,
    options: {
      playerSpawn?: Vec3;
      extraDynamicBodies?: number;
      worldBundle?: WorldBundle;
      onManipulationChanged?: (message: ManipulationChangedMessage) => void;
    } = {},
  ): Promise<WorldHost> {
    const bundle = options.worldBundle ?? WORLD_BUNDLE;
    const physics = await PhysicsWorld.create({
      gravity: bundle.settings.gravity,
    });
    physics.createStaticMesh({
      vertices: bundle.staticCollision.vertices,
      triangles: bundle.staticCollision.triangles,
    });
    const restored = store.load(bundle.mapRevision);
    const game = new WorldHost(
      physics,
      bundle,
      store,
      onState,
      onWorld,
      options.onManipulationChanged ?? (() => {}),
      restored?.worldEpoch ?? 1,
      restored?.serverTick ?? 0,
      options.playerSpawn ? { ...options.playerSpawn } : null,
    );
    game.#extraDynamicBodyCount = options.extraDynamicBodies ?? 0;
    game.#runtimeBodies = createRuntimeBodies(
      physics,
      bundle,
      restored,
      game.#extraDynamicBodyCount,
    );
    game.#simulation = game.#createGameSimulation(restored);
    return game;
  }

  get worldEpoch(): number {
    return this.#worldEpoch;
  }
  get serverTick(): number {
    return this.#serverTick;
  }
  get mapRevision(): string {
    return this.#bundle.mapRevision;
  }
  physicsDebugFrame(maxPrimitives?: number): PhysicsDebugFrame {
    return {
      worldEpoch: this.#worldEpoch,
      serverTick: this.#serverTick,
      ...this.#physics.debugDraw(maxPrimitives),
    };
  }
  startPhysicsTrace(playerId: RuntimeId): ServerPhysicsTraceCapture {
    if (!this.#simulation.players.trace(playerId))
      throw new Error("trace player is unavailable");
    for (const [id, capture] of this.#networkTraces) {
      if (this.#networkTraces.size < NETWORK_TRACE_MAX_CAPTURES) break;
      if (capture.complete) this.#networkTraces.delete(id);
    }
    if (this.#networkTraces.size >= NETWORK_TRACE_MAX_CAPTURES)
      throw new Error("too many active physics traces");
    const startedAtServerTick = this.#serverTick + 1;
    const capture: ServerPhysicsTraceCapture = {
      format: "gurgur-server-physics-trace",
      version: 1,
      id: crypto.randomUUID(),
      worldEpoch: this.#worldEpoch,
      mapRevision: this.#bundle.mapRevision,
      playerId: { ...playerId },
      startedAtServerTick,
      endingAtServerTick:
        startedAtServerTick + NETWORK_TRACE_DURATION_TICKS - 1,
      completedAtServerTick: null,
      complete: false,
      endReason: null,
      frames: [],
    };
    this.#networkTraces.set(capture.id, capture);
    return structuredClone(capture);
  }
  physicsTrace(id: string): ServerPhysicsTraceCapture | null {
    const capture = this.#networkTraces.get(id);
    return capture ? structuredClone(capture) : null;
  }
  physicsTraceStatus(id: string): {
    complete: boolean;
    startedAtServerTick: number;
    endingAtServerTick: number;
    completedAtServerTick: number | null;
    frameCount: number;
  } | null {
    const capture = this.#networkTraces.get(id);
    return capture
      ? {
          complete: capture.complete,
          startedAtServerTick: capture.startedAtServerTick,
          endingAtServerTick: capture.endingAtServerTick,
          completedAtServerTick: capture.completedAtServerTick,
          frameCount: capture.frames.length,
        }
      : null;
  }
  playerPosition(id: RuntimeId): Vec3 | null {
    return this.#simulation.players.position(id);
  }
  metrics(): {
    tickP95Ms: number;
    tickP99Ms: number;
    tickMaxMs: number;
    discardedOverloadSeconds: number;
    maxStateAgeMs: number;
  } {
    const sorted = [...this.#tickDurationsMs].toSorted((a, b) => a - b);
    const percentile = (amount: number): number =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * amount))] ??
      0;
    return {
      tickP95Ms: percentile(0.95),
      tickP99Ms: percentile(0.99),
      tickMaxMs: sorted.at(-1) ?? 0,
      discardedOverloadSeconds: this.#discardedOverloadSeconds,
      maxStateAgeMs: 0,
    };
  }

  canResumePlayer(persistentId: string): boolean {
    return this.#simulation.players.canResume(persistentId);
  }

  connectPlayer(persistentId: string = crypto.randomUUID()): RuntimeId {
    return this.#simulation.players.connect(persistentId);
  }

  disconnectPlayer(id: RuntimeId): boolean {
    this.#predictionBodySets.delete(key(id));
    return this.#simulation.players.disconnect(id);
  }

  acceptInput(id: RuntimeId, command: InputCommand): boolean {
    return this.#simulation.players.acceptInput(id, command, this.#worldEpoch);
  }

  networkStates(advanceHostSequences = false): NetworkObjectState[] {
    return [
      ...this.#runtimeBodies.map((body) =>
        this.#networkBodyState(body, advanceHostSequences),
      ),
      ...this.#simulation.players.networkStates(),
    ];
  }

  networkHotStates(advanceHostSequences = false): NetworkObjectState[] {
    return this.#runtimeBodies
      .filter((body) => {
        const identity = key(body.id);
        if (
          this.#simulation.manipulationOwner(body.id) !== null ||
          this.#isHeldByPlayer(body.id)
        )
          this.#hotBodyUntilTick.set(
            identity,
            this.#serverTick + RELEASE_HOT_STATE_TICKS,
          );
        const hot =
          (this.#hotBodyUntilTick.get(identity) ?? -1) >= this.#serverTick;
        if (!hot) this.#hotBodyUntilTick.delete(identity);
        return hot;
      })
      .map((body) => this.#networkBodyState(body, advanceHostSequences));
  }

  predictionCheckpoint(
    playerId: RuntimeId,
    sourceStatesById: ReadonlyMap<string, NetworkObjectState> = new Map(
      this.networkStates(false).map((state) => [key(state.id), state]),
    ),
  ): PredictionCheckpointPacket | null {
    const prediction = this.#simulation.players.prediction(playerId);
    const playerState = sourceStatesById.get(key(playerId));
    if (!prediction || playerState?.kind !== "player") return null;
    const player: NetworkPlayerState = playerState;
    const heldBody = prediction.grab
      ? this.#body(prediction.grab.target)
      : null;
    const predictionRadiusSquared = PREDICTION_BODY_RADIUS_METRES ** 2;
    const playerKey = key(playerId);
    const previousOrder = new Map(
      (this.#predictionBodySets.get(playerKey) ?? []).map((identity, index) => [
        identity,
        index,
      ]),
    );
    const candidates: Array<{
      state: NetworkBodyState;
      identity: string;
      distanceSquared: number;
    }> = [];
    for (const body of this.#runtimeBodies) {
      if (heldBody && sameId(body.id, heldBody.id)) continue;
      const entity = this.#bundle.entities[body.entityIndex];
      const state = sourceStatesById.get(key(body.id));
      if (
        entity?.kind !== "physics-prop" ||
        entity.interaction !== "grab" ||
        entity.body.kind !== "dynamic-brush" ||
        state?.kind !== "body" ||
        (state.flags & NETWORK_FLAG_HELD) !== 0
      )
        continue;
      const distanceSquared = vec3DistanceSquared(
        player.position,
        state.position,
      );
      if (distanceSquared > predictionRadiusSquared) continue;
      candidates.push({ state, identity: key(body.id), distanceSquared });
    }

    // Retain prior members before nearer candidates to avoid churning the contact island.
    const eligible = new Set(candidates.map((candidate) => candidate.identity));
    const contactDepth = new Map<string, number>();
    if (heldBody) {
      const root = key(heldBody.id);
      contactDepth.set(root, 0);
      const queue = [root];
      for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index]!;
        const depth = contactDepth.get(current)!;
        for (const neighbor of this.#activeBodyContacts.get(current) ?? []) {
          if (!eligible.has(neighbor) || contactDepth.has(neighbor)) continue;
          contactDepth.set(neighbor, depth + 1);
          queue.push(neighbor);
        }
      }
    }
    const playerIndex = this.#simulation.players
      .views()
      .findIndex((candidate) => sameId(candidate.id, playerId));
    const playerProxy = this.#simulation.players.proxies()[playerIndex] ?? null;
    const support = this.#physics.raycastClosest(
      player.position,
      { x: 0, y: -(PLAYER_HALF_HEIGHT + 0.15), z: 0 },
      { ignoreBodies: playerProxy ? [playerProxy] : [] },
    );
    const supportKey = support ? key(support.body) : null;
    candidates.sort((left, right) => {
      const leftContact = contactDepth.get(left.identity);
      const rightContact = contactDepth.get(right.identity);
      const leftPriority =
        left.identity === supportKey
          ? 0
          : leftContact !== undefined
            ? 1 + leftContact
            : previousOrder.has(left.identity)
              ? 100 + previousOrder.get(left.identity)!
              : 1_000;
      const rightPriority =
        right.identity === supportKey
          ? 0
          : rightContact !== undefined
            ? 1 + rightContact
            : previousOrder.has(right.identity)
              ? 100 + previousOrder.get(right.identity)!
              : 1_000;
      return (
        leftPriority - rightPriority ||
        left.distanceSquared - right.distanceSquared ||
        left.identity.localeCompare(right.identity)
      );
    });
    const nearbyBodies = candidates
      .slice(0, PREDICTION_BODY_CAPACITY)
      .map((candidate) => candidate.state);
    this.#predictionBodySets.set(playerKey, [
      ...(heldBody ? [key(heldBody.id)] : []),
      ...nearbyBodies.map((state) => key(state.id)),
    ]);
    const sampledHeldBody = heldBody
      ? sourceStatesById.get(key(heldBody.id))
      : null;
    return {
      worldEpoch: this.#worldEpoch,
      serverTick: this.#serverTick >>> 0,
      lastProcessedInputSequence: prediction.lastProcessedInputSequence,
      player,
      nearbyBodies,
      held:
        prediction.grab && heldBody
          ? {
              claimVersion: prediction.grabVersion,
              startInputSequence: prediction.grabStartInputSequence,
              localAnchor: { x: 0, y: 0, z: 0 },
              body:
                sampledHeldBody?.kind === "body"
                  ? sampledHeldBody
                  : this.#networkBodyState(heldBody, false),
              distance: prediction.grab.distance,
              relativeRotation: { ...prediction.grab.relativeRotation },
              targetPosition: { ...prediction.grab.targetPosition },
              targetRotation: { ...prediction.grab.targetRotation },
              errorSeconds: prediction.grab.errorSeconds,
            }
          : null,
    };
  }

  bootstrapStates(): NetworkObjectState[] {
    return this.networkStates(false).map(cloneNetworkState);
  }

  requestManipulation(
    owner: RuntimeId,
    request: ManipulationRequestMessage,
  ):
    | ManipulationChangedMessage
    | "stale"
    | "unavailable"
    | "out-of-range"
    | "busy" {
    if (request.worldEpoch !== this.#worldEpoch) return "stale";
    const body = this.#body(request.target);
    const entity = body ? this.#bundle.entities[body.entityIndex] : null;
    if (
      !body ||
      body.authorityVersion !== request.authorityVersion ||
      body.ownerPlayerId !== null
    )
      return "stale";
    if (
      body.transferPolicy !== "fixed" ||
      entity?.kind !== "physics-prop" ||
      (entity.interaction !== "grab" && entity.interaction !== "manipulate") ||
      !Number.isFinite(request.holdDistance) ||
      request.holdDistance < 0.25 ||
      request.holdDistance > 10
    )
      return "unavailable";
    const claimVersion = nextVersion(
      this.#manipulationVersions.get(key(body.id)) ?? 0,
    );
    const result = this.#simulation.beginManipulation(
      owner,
      request.target,
      claimVersion,
      request.localAnchor,
    );
    if (result !== true) return result;
    this.#manipulationVersions.set(key(body.id), claimVersion);
    this.#saveRequested = true;
    return this.#manipulationChanged(
      body,
      request.requestId,
      claimVersion,
      owner,
    );
  }

  acceptManipulationState(
    owner: RuntimeId,
    state: ManipulationStatePacket,
  ): boolean {
    if (state.worldEpoch !== this.#worldEpoch) return false;
    const body = this.#body(state.target);
    if (!body || state.authorityVersion !== body.authorityVersion) return false;
    return this.#simulation.updateManipulation(owner, state);
  }

  dropManipulation(
    owner: RuntimeId,
    request: ManipulationDropMessage,
  ): ManipulationChangedMessage | null {
    if (request.worldEpoch !== this.#worldEpoch) return null;
    const body = this.#body(request.target);
    if (!body || request.authorityVersion !== body.authorityVersion)
      return null;
    const claim = this.#simulation.endManipulation(
      owner,
      request.target,
      request.claimVersion,
    );
    if (!claim) return null;
    this.#saveRequested = true;
    return this.#manipulationChanged(body, null, claim.claimVersion, null);
  }

  endManipulationsForPlayer(owner: RuntimeId): ManipulationChangedMessage[] {
    const claims = this.#simulation.endManipulationsForPlayer(owner);
    if (claims.length > 0) this.#saveRequested = true;
    return claims.flatMap((claim) => {
      const body = this.#body(claim.target);
      return body
        ? [this.#manipulationChanged(body, null, claim.claimVersion, null)]
        : [];
    });
  }

  reassignPlayer(id: RuntimeId): OwnershipChangedPacket | null {
    const state = this.#simulation.players.reassign(id);
    if (!state) return null;
    return {
      worldEpoch: this.#worldEpoch,
      requestId: null,
      id: { ...id },
      ownerPlayerId: null,
      authorityVersion: state.authorityVersion,
      state,
    };
  }

  useOwnedPlayer(playerId: RuntimeId, target: RuntimeId): boolean {
    const playerPosition = this.playerPosition(playerId);
    const body = this.#body(target);
    if (!playerPosition || !body) return false;
    const origin = {
      x: playerPosition.x,
      y: playerPosition.y + 0.4,
      z: playerPosition.z,
    };
    const targetPosition = this.#physics.state(body.handle).position;
    const displacement = {
      x: targetPosition.x - origin.x,
      y: targetPosition.y - origin.y,
      z: targetPosition.z - origin.z,
    };
    if (Math.hypot(displacement.x, displacement.y, displacement.z) > 3.25)
      return false;
    return this.#simulation.use(target, origin, displacement);
  }

  devWorldState(connectedNetworkPlayers: readonly RuntimeId[] = []) {
    const connected = new Set(connectedNetworkPlayers.map(key));
    const controllers = new Map(
      [...this.#devPlayers.values()].map((player) => [key(player.id), player]),
    );
    const players = this.#simulation.players.views().map((player) => ({
      ...player,
      control: controllers.has(key(player.id))
        ? ("mcp" as const)
        : ("network" as const),
      controllerId: controllers.get(key(player.id))?.controllerId ?? null,
      connected:
        controllers.has(key(player.id)) || connected.has(key(player.id)),
      intent: controllers.has(key(player.id))
        ? {
            moveX: controllers.get(key(player.id))!.moveX,
            moveZ: controllers.get(key(player.id))!.moveZ,
            lookYaw: controllers.get(key(player.id))!.lookYaw,
            lookPitch: controllers.get(key(player.id))!.lookPitch,
            crouch: Boolean(controllers.get(key(player.id))!.buttons & 4),
            stopAtTick: controllers.get(key(player.id))!.stopAtTick,
          }
        : null,
    }));
    return {
      mapRevision: this.#bundle.mapRevision,
      worldEpoch: this.#worldEpoch,
      serverTick: this.#serverTick,
      gravity: { ...this.#bundle.settings.gravity },
      players,
      bodies: this.#runtimeBodies.map((body) => ({
        entityIndex: body.entityIndex,
        authoredId: body.authoredId,
        kind: this.#bundle.entities[body.entityIndex]?.kind ?? "unknown",
        ephemeral: this.#devBodyKeys.has(key(body.id)),
        ...this.#physics.state(body.handle),
      })),
    };
  }

  devPropArchetypes() {
    return this.#bundle.entities.flatMap((entity, entityIndex) => {
      if (entity.kind !== "physics-prop") return [];
      const vertices = entity.body.brushIndices.flatMap(
        (brushIndex) => this.#bundle.brushes[brushIndex]?.localVertices ?? [],
      );
      const bounds = vertices.reduce(
        (value, vertex) => ({
          min: {
            x: Math.min(value.min.x, vertex.x),
            y: Math.min(value.min.y, vertex.y),
            z: Math.min(value.min.z, vertex.z),
          },
          max: {
            x: Math.max(value.max.x, vertex.x),
            y: Math.max(value.max.y, vertex.y),
            z: Math.max(value.max.z, vertex.z),
          },
        }),
        {
          min: {
            x: Number.POSITIVE_INFINITY,
            y: Number.POSITIVE_INFINITY,
            z: Number.POSITIVE_INFINITY,
          },
          max: {
            x: Number.NEGATIVE_INFINITY,
            y: Number.NEGATIVE_INFINITY,
            z: Number.NEGATIVE_INFINITY,
          },
        },
      );
      return [
        {
          entityIndex,
          authoredId: entity.authoredId,
          density: entity.body.density,
          friction: entity.body.friction,
          restitution: entity.body.restitution,
          bounds,
        },
      ];
    });
  }

  spawnDevProp(entityIndex: number, position: Vec3, yaw = 0): RuntimeBody {
    if (this.#devBodyKeys.size >= MAX_DEV_PROPS)
      throw new Error(`dev prop limit of ${MAX_DEV_PROPS} reached`);
    assertFiniteVec3(position, "dev prop position");
    if (!Number.isFinite(yaw)) throw new Error("dev prop yaw must be finite");
    const authoredId = `dev.mcp.prop.${this.#devBodySequence++}`;
    const body = createRuntimeProp(
      this.#physics,
      this.#bundle,
      entityIndex,
      position,
      yawRotation(yaw),
      authoredId,
    );
    this.#runtimeBodies.push(body);
    this.#devBodyKeys.add(key(body.id));
    return body;
  }

  removeDevProp(id: RuntimeId): boolean {
    const identity = key(id);
    if (!this.#devBodyKeys.delete(identity)) return false;
    const index = this.#runtimeBodies.findIndex(
      (body) => key(body.id) === identity,
    );
    const body = this.#runtimeBodies[index];
    if (!body) return false;
    this.#forgetBodyContacts(body.handle);
    this.#physics.destroy(body.handle);
    this.#runtimeBodies.splice(index, 1);
    return true;
  }

  spawnDevPlayer(
    position?: Vec3,
    yaw?: number,
  ): { controllerId: string; id: RuntimeId } {
    if (this.#devPlayers.size >= MAX_DEV_PLAYERS)
      throw new Error(`dev player limit of ${MAX_DEV_PLAYERS} reached`);
    const spawn = this.#bundle.playerSpawns.find(
      (candidate) => candidate.name === "default",
    );
    if (!spawn) throw new Error("map requires a default player spawn");
    const initialPosition = position
      ? { ...position }
      : this.#playerSpawn
        ? { ...this.#playerSpawn }
        : {
            x: spawn.position.x,
            y: spawn.position.y + PLAYER_HALF_HEIGHT,
            z: spawn.position.z,
          };
    const initialYaw = yaw ?? spawn.yaw;
    assertFiniteVec3(initialPosition, "dev player position");
    if (!Number.isFinite(initialYaw))
      throw new Error("dev player yaw must be finite");
    const controllerId = crypto.randomUUID();
    const id = this.#simulation.players.connect(
      `${DEV_PLAYER_PREFIX}${controllerId}`,
      {
        position: initialPosition,
        yaw: initialYaw,
      },
    );
    this.#devPlayers.set(controllerId, {
      controllerId,
      id,
      sequence: 0,
      moveX: 0,
      moveZ: 0,
      lookYaw: initialYaw,
      lookPitch: 0,
      buttons: 0,
      jumpCounter: 0,
      interactCounter: 0,
      interactTarget: null,
      primaryCounter: 0,
      stopAtTick: null,
    });
    return { controllerId, id: { ...id } };
  }

  setDevPlayerIntent(controllerId: string, update: DevPlayerIntentUpdate) {
    const player = this.#devPlayers.get(controllerId);
    if (!player) throw new Error("unknown MCP player controller");
    if (
      update.durationSeconds !== undefined &&
      (!Number.isFinite(update.durationSeconds) ||
        update.durationSeconds < 0 ||
        update.durationSeconds > 5)
    )
      throw new Error("durationSeconds must be between 0 and 5");
    if (update.moveX !== undefined)
      player.moveX = clampUnit(update.moveX, "moveX");
    if (update.moveZ !== undefined)
      player.moveZ = clampUnit(update.moveZ, "moveZ");
    if (update.lookYaw !== undefined) {
      if (!Number.isFinite(update.lookYaw))
        throw new Error("lookYaw must be finite");
      player.lookYaw = update.lookYaw;
    }
    if (update.lookPitch !== undefined) {
      if (!Number.isFinite(update.lookPitch))
        throw new Error("lookPitch must be finite");
      player.lookPitch = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, update.lookPitch),
      );
    }
    if (update.crouch !== undefined)
      player.buttons = update.crouch ? player.buttons | 4 : player.buttons & ~4;
    if (update.action === "jump")
      player.jumpCounter = nextCounter(player.jumpCounter);
    if (update.action === "primary")
      player.primaryCounter = nextCounter(player.primaryCounter);
    if (update.action === "interact") {
      player.interactTarget = update.interactTarget ?? null;
      player.interactCounter = nextCounter(player.interactCounter);
    } else if (update.interactTarget !== undefined) {
      player.interactTarget = update.interactTarget
        ? { ...update.interactTarget }
        : null;
    }
    if (update.durationSeconds !== undefined) {
      player.stopAtTick =
        update.durationSeconds === 0
          ? this.#serverTick
          : this.#serverTick + Math.ceil(update.durationSeconds * PHYSICS_HZ);
    }
    return (
      this.devWorldState().players.find(
        (view) => key(view.id) === key(player.id),
      ) ?? null
    );
  }

  stopDevPlayer(controllerId: string) {
    return this.setDevPlayerIntent(controllerId, {
      moveX: 0,
      moveZ: 0,
      crouch: false,
    });
  }

  removeDevPlayer(controllerId: string): RuntimeId | null {
    const player = this.#devPlayers.get(controllerId);
    if (!player) return null;
    this.#devPlayers.delete(controllerId);
    if (!this.#simulation.players.disconnect(player.id, { persist: false }))
      return null;
    return { ...player.id };
  }

  devRaycast(origin: Vec3, displacement: Vec3) {
    assertFiniteVec3(origin, "ray origin");
    assertFiniteVec3(displacement, "ray displacement");
    if (Math.hypot(displacement.x, displacement.y, displacement.z) > 1_000)
      throw new Error("ray displacement must be at most 1000 metres");
    const hit = this.#physics.raycastClosest(origin, displacement);
    return hit
      ? {
          body: { ...hit.body },
          point: { ...hit.point },
          normal: { ...hit.normal },
          fraction: hit.fraction,
        }
      : null;
  }

  start(): void {
    if (this.#timer) return;
    this.#lastTime = performance.now();
    this.#timer = setInterval(() => {
      const now = performance.now();
      this.advance((now - this.#lastTime) / 1_000);
      this.#lastTime = now;
    }, 4);
  }

  advance(elapsedSeconds: number): void {
    const accumulated = accumulateFixedStepTime(
      this.#accumulator,
      elapsedSeconds,
    );
    this.#accumulator = accumulated.accumulatorSeconds;
    this.#discardedOverloadSeconds += accumulated.discardedSeconds;
    let steps = 0;
    while (this.#accumulator >= PHYSICS_DT && steps < MAX_CATCH_UP_TICKS) {
      const tickStartedAt = performance.now();
      this.#submitDevPlayerInputs();
      this.#simulation.step();
      for (const claim of this.#simulation.takeTimedOutManipulations()) {
        const body = this.#body(claim.target);
        if (body) {
          this.#saveRequested = true;
          this.#onManipulation(
            this.#manipulationChanged(body, null, claim.claimVersion, null),
          );
        }
      }
      const events = this.#physics.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
      this.#processPostPhysics(events);
      this.#serverTick += 1;
      this.#recordPhysicsTraces(events);
      this.#accumulator -= PHYSICS_DT;
      steps += 1;
      if (this.#serverTick % STATE_PUBLISH_INTERVAL_TICKS === 0) {
        this.#onState(this.networkStates(true));
      } else {
        const hotStates = this.networkHotStates(true);
        if (hotStates.length > 0) this.#onState(hotStates);
      }
      if (this.#saveRequested) {
        this.#saveRequested = false;
        this.save();
      }
      if (this.#serverTick % SAVE_INTERVAL_TICKS === 0) this.save();
      this.#tickDurationsMs.push(performance.now() - tickStartedAt);
      if (this.#tickDurationsMs.length > 1_200) this.#tickDurationsMs.shift();
    }
  }

  snapshot(): Snapshot {
    const players = this.#simulation.players.views();
    const bodies = this.#runtimeBodies.map(
      ({ handle, ownerPlayerId, entityIndex }) => {
        const identity = key(handle);
        const grabbed = players.some(
          (player) => player.grabTarget && key(player.grabTarget) === identity,
        );
        const manipulated = this.#simulation.manipulationOwner(handle) !== null;
        const { awake: _awake, ...state } = this.#physics.state(handle);
        return {
          ...state,
          flags:
            (ownerPlayerId || grabbed || manipulated ? NETWORK_FLAG_HELD : 0) |
            this.#simulation.networkFlags(entityIndex),
        };
      },
    );
    return {
      worldEpoch: this.#worldEpoch,
      serverTick: this.#serverTick,
      bodies: bodies.concat(
        players.map((player) => ({
          id: player.id,
          position: player.position,
          rotation: yawRotation(player.yaw),
          linearVelocity: { x: 0, y: player.verticalVelocity, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 },
          flags: 0,
        })),
      ),
      players: players.map((player) => ({
        id: player.id,
        position: player.position,
        yaw: player.yaw,
        verticalVelocity: player.verticalVelocity,
        grounded: player.grounded,
        lastProcessedInputSequence: player.lastProcessedInputSequence,
        lastJumpCounter: player.lastJumpCounter,
        stepCooldown: player.stepCooldown,
        crouched: player.crouched,
      })),
    };
  }

  worldMessage(): WorldMessage {
    return {
      type: "world",
      protocolVersion: PROTOCOL_VERSION,
      worldEpoch: this.#worldEpoch,
      bundle: this.#bundle,
      runtimeEntities: [
        ...this.#runtimeBodies.map(runtimeBodyRef),
        ...this.#simulation.players.runtimeRefs(),
      ],
    };
  }

  grabbedTarget(playerId: RuntimeId): RuntimeId | null {
    return this.#simulation.players.grabbedTarget(playerId);
  }

  releasePlayerGrab(playerId: RuntimeId): RuntimeId | null {
    return this.#simulation.players.releaseGrab(playerId);
  }

  reset(): Snapshot {
    this.#finishPhysicsTraces("world-reset");
    this.#clearDevPlayers();
    this.#physics.recreate();
    this.#physics.createStaticMesh({
      vertices: this.#bundle.staticCollision.vertices,
      triangles: this.#bundle.staticCollision.triangles,
    });
    this.#runtimeBodies = [];
    this.#saveRequested = false;
    this.#devBodyKeys.clear();
    this.#lastPublishedBodies.clear();
    this.#hotBodyUntilTick.clear();
    this.#manipulationVersions.clear();
    this.#predictionBodySets.clear();
    this.#activeBodyContacts.clear();
    this.#worldEpoch += 1;
    this.#serverTick = 0;
    this.#accumulator = 0;
    this.#runtimeBodies = createRuntimeBodies(
      this.#physics,
      this.#bundle,
      null,
      this.#extraDynamicBodyCount,
    );
    this.#simulation.reset();
    this.save();
    this.#onWorld(this.worldMessage());
    const snapshot = this.snapshot();
    this.#onState(this.networkStates(true));
    return snapshot;
  }

  save(): void {
    this.#store.save(this.#bundle.mapRevision, {
      worldEpoch: this.#worldEpoch,
      serverTick: this.#serverTick,
      bodies: this.#runtimeBodies
        .filter((body) => !this.#devBodyKeys.has(key(body.id)))
        .map((body) => ({
          authoredId: body.authoredId,
          ...this.#physics.state(body.handle),
        })),
      gameState: this.#simulation.persistedState(),
      players: this.#simulation.players
        .persisted()
        .filter((player) => !player.persistentId.startsWith(DEV_PLAYER_PREFIX)),
    });
  }

  stop(): void {
    this.#finishPhysicsTraces("server-stop");
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#clearDevPlayers();
    this.save();
    this.#physics.dispose();
  }

  #createGameSimulation(restored: PersistedWorld | null): GameSimulation {
    return createGameSimulation({
      engine: this.#gameEngine(),
      mechanisms: this.#mechanismEngine(),
      bundle: this.#bundle,
      restored: restored?.gameState ?? null,
      players: {
        restored: restored?.players ?? [],
        ...(this.#playerSpawn ? { spawnPosition: this.#playerSpawn } : {}),
        stepController: (state, input, proxy) =>
          stepPlayerController(
            this.#physics,
            state,
            input,
            PHYSICS_DT,
            Math.max(0, -this.#bundle.settings.gravity.y) *
              (this.#simulation?.gravityFactor(proxy) ?? 1),
          ),
      },
    });
  }

  #gameEngine(): GameEngine {
    const tick = (): number => this.#serverTick;
    return {
      get tick() {
        return tick();
      },
      dt: PHYSICS_DT,
      bodies: {
        forEntity: (entityIndex) => {
          const body = this.#runtimeBodies.find(
            (candidate) => candidate.entityIndex === entityIndex,
          );
          return body
            ? { id: body.handle, entityIndex: body.entityIndex }
            : null;
        },
        resolve: (id) => {
          const body = this.#runtimeBodies.find(
            (candidate) => key(candidate.handle) === key(id),
          );
          return body
            ? { id: body.handle, entityIndex: body.entityIndex }
            : null;
        },
        state: (id) => this.#physics.state(id),
      },
      setKinematicTarget: (id, position) =>
        this.#physics.setKinematicTarget(id, position, PHYSICS_DT),
      setBodyAwake: (id, awake) => this.#physics.setBodyAwake(id, awake),
      raycast: (origin, displacement, options) =>
        this.#physics.raycastClosest(origin, displacement, options),
      createPlayerProxy: (position, shape) =>
        this.#physics.createPlayerProxy(position, shape),
      updatePlayerProxy: (id, position, yaw) =>
        this.#physics.setKinematicTargetTransform(
          id,
          position,
          yawRotation(yaw),
          PHYSICS_DT,
        ),
      destroyBody: (id) => {
        this.#physics.destroy(id);
      },
      driveBodyToTarget: (id, options) =>
        this.#physics.driveBodyToTarget(id, {
          ...options,
          seconds: PHYSICS_DT,
        }),
      requestSave: () => {
        this.#saveRequested = true;
      },
    };
  }

  #mechanismEngine(): HostMechanismEngine {
    return {
      createControl: (options) =>
        this.#physics.createControlConstraint(options),
      setControlTarget: (id, position, rotation) =>
        this.#physics.setControlTarget(id, position, rotation),
      destroyConstraint: (id) => this.#physics.destroyConstraint(id),
      createRevolute: (options) =>
        this.#physics.createRevoluteConstraint(options),
      setRevoluteMotor: (id, motor) =>
        this.#physics.setRevoluteMotor(id, motor),
      createPrismatic: (options) =>
        this.#physics.createPrismaticConstraint(options),
      setPrismaticMotor: (id, motor) =>
        this.#physics.setPrismaticMotor(id, motor),
      createSpherical: (options) =>
        this.#physics.createSphericalConstraint(options),
      createWeld: (options) => this.#physics.createWeldConstraint(options),
      createDistance: (options) =>
        this.#physics.createConfigurableDistanceConstraint(options),
      setSurfaceVelocity: (id, velocity) =>
        this.#physics.setSurfaceVelocity(id, velocity),
      setGravityScale: (id, scale) => this.#physics.setGravityScale(id, scale),
    };
  }

  #processPostPhysics(events: PhysicsStepEvents): void {
    this.#simulation.processSensorEvents(events.sensorBegin, events.sensorEnd);
    for (const event of events.contactBegin)
      this.#setBodyContact(event.a, event.b, true);
    for (const event of events.contactEnd)
      this.#setBodyContact(event.a, event.b, false);
  }

  #setBodyContact(a: RuntimeId, b: RuntimeId, active: boolean): void {
    const aKey = key(a);
    const bKey = key(b);
    if (active) {
      const aContacts = this.#activeBodyContacts.get(aKey) ?? new Set<string>();
      const bContacts = this.#activeBodyContacts.get(bKey) ?? new Set<string>();
      aContacts.add(bKey);
      bContacts.add(aKey);
      this.#activeBodyContacts.set(aKey, aContacts);
      this.#activeBodyContacts.set(bKey, bContacts);
      return;
    }
    const aContacts = this.#activeBodyContacts.get(aKey);
    const bContacts = this.#activeBodyContacts.get(bKey);
    aContacts?.delete(bKey);
    bContacts?.delete(aKey);
    if (aContacts?.size === 0) this.#activeBodyContacts.delete(aKey);
    if (bContacts?.size === 0) this.#activeBodyContacts.delete(bKey);
  }

  #forgetBodyContacts(id: RuntimeId): void {
    const identity = key(id);
    for (const neighbor of this.#activeBodyContacts.get(identity) ?? []) {
      const contacts = this.#activeBodyContacts.get(neighbor);
      contacts?.delete(identity);
      if (contacts?.size === 0) this.#activeBodyContacts.delete(neighbor);
    }
    this.#activeBodyContacts.delete(identity);
  }

  #recordPhysicsTraces(events: PhysicsStepEvents): void {
    const captures = [...this.#networkTraces.values()].filter(
      (capture) => !capture.complete,
    );
    if (captures.length === 0) return;

    const playerStates = this.#simulation.players.networkStates();
    const playerViews = this.#simulation.players.views();
    const playerProxies = this.#simulation.players.proxies();
    const runtimeIdByPhysicsHandle = new Map<string, RuntimeId>();
    for (const body of this.#runtimeBodies)
      runtimeIdByPhysicsHandle.set(key(body.handle), { ...body.id });
    for (let index = 0; index < playerViews.length; index += 1) {
      const proxy = playerProxies[index];
      const player = playerViews[index];
      if (proxy && player)
        runtimeIdByPhysicsHandle.set(key(proxy), { ...player.id });
    }

    for (const capture of captures) {
      if (capture.worldEpoch !== this.#worldEpoch) {
        this.#completePhysicsTrace(capture, "world-reset");
        continue;
      }
      const input = this.#simulation.players.trace(capture.playerId);
      const player = playerStates.find((candidate) =>
        sameId(candidate.id, capture.playerId),
      );
      const playerIndex = playerViews.findIndex((candidate) =>
        sameId(candidate.id, capture.playerId),
      );
      const playerProxy =
        playerIndex < 0 ? null : (playerProxies[playerIndex] ?? null);
      if (!input || !player || !playerProxy) {
        this.#completePhysicsTrace(capture, "player-missing");
        continue;
      }

      const bodies = this.#runtimeBodies
        .map((body) => ({
          distanceSquared: vec3DistanceSquared(
            player.position,
            this.#physics.state(body.handle).position,
          ),
          body,
        }))
        .filter(
          ({ distanceSquared, body }) =>
            distanceSquared <=
              NETWORK_TRACE_RADIUS_METRES * NETWORK_TRACE_RADIUS_METRES ||
            (input.grabTarget !== null && sameId(input.grabTarget, body.id)),
        )
        .toSorted((a, b) => a.distanceSquared - b.distanceSquared)
        .slice(0, NETWORK_TRACE_MAX_BODIES)
        .map(({ body }) => this.#networkBodyState(body, false));
      const relevantIds = new Set([
        key(capture.playerId),
        ...bodies.map((body) => key(body.id)),
      ]);
      const traceId = (handle: RuntimeId): RuntimeId | null => {
        const id = runtimeIdByPhysicsHandle.get(key(handle));
        return id ? { ...id } : null;
      };
      const isRelevant = (id: RuntimeId | null): boolean =>
        id !== null && relevantIds.has(key(id));
      const contacts: ServerPhysicsTraceContact[] = [];
      const appendContact = (
        kind: ServerPhysicsTraceContact["kind"],
        event: {
          a: RuntimeId;
          b: RuntimeId;
          point?: Vec3;
          normal?: Vec3;
          approachSpeed?: number;
        },
      ): void => {
        const a = traceId(event.a);
        const b = traceId(event.b);
        if (!isRelevant(a) && !isRelevant(b)) return;
        contacts.push({
          kind,
          a,
          b,
          ...(event.point ? { point: { ...event.point } } : {}),
          ...(event.normal ? { normal: { ...event.normal } } : {}),
          ...(event.approachSpeed === undefined
            ? {}
            : { approachSpeed: event.approachSpeed }),
        });
      };
      for (const event of events.contactBegin) appendContact("begin", event);
      for (const event of events.contactEnd) appendContact("end", event);
      for (const event of events.contactHit) appendContact("hit", event);

      const supportHit = this.#physics.raycastClosest(
        player.position,
        { x: 0, y: -(PLAYER_HALF_HEIGHT + 0.15), z: 0 },
        { ignoreBodies: [playerProxy] },
      );
      capture.frames.push({
        serverTick: this.#serverTick,
        recordedAtMs: performance.now(),
        player: cloneNetworkState(player),
        input: structuredClone(input),
        support: supportHit
          ? {
              id: traceId(supportHit.body),
              point: { ...supportHit.point },
              normal: { ...supportHit.normal },
              fraction: supportHit.fraction,
            }
          : null,
        bodies: bodies.map(cloneNetworkState),
        contacts,
      });
      if (this.#serverTick >= capture.endingAtServerTick)
        this.#completePhysicsTrace(capture, "duration");
    }
  }

  #finishPhysicsTraces(
    reason: Exclude<ServerPhysicsTraceCapture["endReason"], "duration" | null>,
  ): void {
    for (const capture of this.#networkTraces.values()) {
      if (!capture.complete) this.#completePhysicsTrace(capture, reason);
    }
  }

  #completePhysicsTrace(
    capture: ServerPhysicsTraceCapture,
    reason: Exclude<ServerPhysicsTraceCapture["endReason"], null>,
  ): void {
    capture.complete = true;
    capture.endReason = reason;
    capture.completedAtServerTick = this.#serverTick;
  }

  #body(id: RuntimeId): RuntimeBody | null {
    return (
      this.#runtimeBodies.find((candidate) => sameId(candidate.id, id)) ?? null
    );
  }

  #networkBodyState(
    body: RuntimeBody,
    advanceHostSequence: boolean,
  ): NetworkBodyState {
    const { awake, ...physics } = this.#physics.state(body.handle);
    const candidate: NetworkBodyState = {
      kind: "body",
      ...physics,
      id: { ...body.id },
      authorityVersion: body.authorityVersion,
      stateSequence: body.stateSequence,
      sourceTick: this.#serverTick >>> 0,
      flags:
        (body.ownerPlayerId ||
        this.#simulation.manipulationOwner(body.id) ||
        this.#isHeldByPlayer(body.id)
          ? NETWORK_FLAG_HELD
          : 0) |
        (awake ? NETWORK_FLAG_AWAKE : 0) |
        this.#simulation.networkFlags(body.entityIndex),
    };
    const previous = this.#lastPublishedBodies.get(key(body.id));
    if (
      advanceHostSequence &&
      body.ownerPlayerId === null &&
      (!previous || bodyNetworkStateChanged(previous, candidate))
    ) {
      body.stateSequence = (body.stateSequence + 1) & 0xffff;
      candidate.stateSequence = body.stateSequence;
      this.#lastPublishedBodies.set(key(body.id), cloneNetworkState(candidate));
    }
    return candidate;
  }

  #isHeldByPlayer(id: RuntimeId): boolean {
    return this.#simulation.players
      .views()
      .some(
        (player) => player.grabTarget !== null && sameId(player.grabTarget, id),
      );
  }

  #manipulationChanged(
    body: RuntimeBody,
    requestId: number | null,
    claimVersion: number,
    manipulatorPlayerId: RuntimeId | null,
  ): ManipulationChangedMessage {
    return {
      type: "manipulation-changed",
      protocolVersion: PROTOCOL_VERSION,
      worldEpoch: this.#worldEpoch,
      requestId,
      target: { ...body.id },
      authorityVersion: body.authorityVersion,
      claimVersion,
      manipulatorPlayerId: manipulatorPlayerId
        ? { ...manipulatorPlayerId }
        : null,
    };
  }

  #submitDevPlayerInputs(): void {
    for (const player of this.#devPlayers.values()) {
      if (player.stopAtTick !== null && this.#serverTick >= player.stopAtTick) {
        player.moveX = 0;
        player.moveZ = 0;
        player.buttons &= ~4;
        player.stopAtTick = null;
      }
      const command: InputCommand = {
        type: "input",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: this.#worldEpoch,
        sequence: player.sequence++,
        clientTick: this.#serverTick,
        moveX: player.moveX,
        moveZ: player.moveZ,
        lookYaw: player.lookYaw,
        lookPitch: player.lookPitch,
        buttons: player.buttons,
        jumpCounter: player.jumpCounter,
        interactCounter: player.interactCounter,
        interactTarget: player.interactTarget
          ? { ...player.interactTarget }
          : null,
        primaryCounter: player.primaryCounter,
      };
      this.#simulation.players.acceptInput(
        player.id,
        command,
        this.#worldEpoch,
      );
    }
  }

  #clearDevPlayers(): void {
    for (const controllerId of this.#devPlayers.keys())
      this.removeDevPlayer(controllerId);
  }
}

function yawRotation(yaw: number): Quat {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

function assertFiniteVec3(value: Vec3, label: string): void {
  if (![value.x, value.y, value.z].every(Number.isFinite))
    throw new Error(`${label} must contain finite coordinates`);
}

function clampUnit(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return Math.max(-1, Math.min(1, value));
}

function nextCounter(value: number): number {
  return (value + 1) >>> 0;
}

function key(id: RuntimeId): string {
  return `${id.index}:${id.generation}`;
}

function sameId(a: RuntimeId, b: RuntimeId): boolean {
  return a.index === b.index && a.generation === b.generation;
}

function vec3DistanceSquared(a: Vec3, b: Vec3): number {
  const x = a.x - b.x;
  const y = a.y - b.y;
  const z = a.z - b.z;
  return x * x + y * y + z * z;
}

function nextVersion(version: number): number {
  const next = (version + 1) >>> 0;
  return next === 0 ? 1 : next;
}

function bodyNetworkStateChanged(
  a: NetworkBodyState,
  b: NetworkBodyState,
): boolean {
  return (
    a.authorityVersion !== b.authorityVersion ||
    a.flags !== b.flags ||
    !sameVec3(a.position, b.position) ||
    !sameQuat(a.rotation, b.rotation) ||
    !sameVec3(a.linearVelocity, b.linearVelocity) ||
    !sameVec3(a.angularVelocity, b.angularVelocity)
  );
}

function sameVec3(a: Vec3, b: Vec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function sameQuat(a: Quat, b: Quat): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z && a.w === b.w;
}
