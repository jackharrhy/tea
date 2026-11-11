import {
  NETWORK_FLAG_ACTIVE,
  NETWORK_FLAG_REVERSED,
  isNewerSequence16,
  type ConstraintId,
  type ManipulationStatePacket,
  type PhysicsStepEvents,
  type PrismaticMotor,
  type Quat,
  type RevoluteMotor,
  type RuntimeId,
  type Vec3,
} from "@harrhy/gurgur-engine";
import type { GameEngine, HostMechanismEngine } from "./engine-api";
import { playerChest } from "./grab";
import {
  createGamePlayers,
  type GamePlayers,
  type GamePlayersOptions,
} from "./players";
import type { PersistedGameState } from "./state";
import {
  entityInputDomain,
  type EntityInput,
  type OutputConnection,
  type PhysicsJointEntity,
  type TriggerOutputs,
  type WorldBundle,
} from "./world";

type Trigger = {
  entityIndex: number;
  handle: RuntimeId;
  authoredId: string;
  mode: "once" | "multiple";
  outputs: TriggerOutputs;
  waitTicks: number;
  readyAtTick: number;
  consumed: boolean;
  activeVisitors: Map<string, number>;
  emittedVisitors: Set<string>;
};

type PhysicsControl =
  | {
      kind: "joint";
      entityIndex: number;
      authoredId: string;
      targetname?: string;
      enabled: boolean;
      reversed: boolean;
      entity: PhysicsJointEntity;
      constraint: ConstraintId;
    }
  | {
      kind: "surface";
      entityIndex: number;
      authoredId: string;
      targetname?: string;
      enabled: boolean;
      reversed: boolean;
      handle: RuntimeId;
      velocity: Vec3;
    };

type GravityField = {
  entityIndex: number;
  handle: RuntimeId;
  factor: number;
  priority: number;
  visitors: Map<string, number>;
};

export type Mechanism = {
  entityIndex: number;
  handle: RuntimeId;
  authoredId: string;
  mode: "door" | "platform";
  targetname: string;
  start: Vec3;
  end: Vec3;
  speed: number;
  waitTicks: number;
  progress: number;
  direction: -1 | 0 | 1;
  resumeAtTick: number;
};

type Relay = {
  entityIndex: number;
  authoredId: string;
  targetname: string;
  target: string;
  delayTicks: number;
  once: boolean;
  fired: boolean;
};

export type Button = {
  handle: RuntimeId;
  authoredId: string;
  target: string;
  waitTicks: number;
  readyAtTick: number;
};

export type ManipulationClaim = {
  playerId: RuntimeId;
  target: RuntimeId;
  claimVersion: number;
};

type Manipulation = ManipulationClaim & {
  constraint: ConstraintId;
  stateSequence: number | null;
  lastUpdateTick: number;
  targetPosition: Vec3;
  targetRotation: Quat;
};

export type GameSimulation = {
  readonly players: GamePlayers;
  step(): void;
  processSensorEvents(
    begins: PhysicsStepEvents["sensorBegin"],
    ends: PhysicsStepEvents["sensorEnd"],
  ): void;
  use(target: RuntimeId, origin: Vec3, displacement: Vec3): boolean;
  beginManipulation(
    playerId: RuntimeId,
    target: RuntimeId,
    claimVersion: number,
    localAnchor: Vec3,
  ): true | "busy" | "unavailable" | "out-of-range";
  updateManipulation(
    playerId: RuntimeId,
    state: ManipulationStatePacket,
  ): boolean;
  endManipulation(
    playerId: RuntimeId,
    target: RuntimeId,
    claimVersion: number,
  ): ManipulationClaim | null;
  endManipulationsForPlayer(playerId: RuntimeId): ManipulationClaim[];
  manipulationOwner(target: RuntimeId): RuntimeId | null;
  takeTimedOutManipulations(): ManipulationClaim[];
  gravityFactor(id: RuntimeId): number;
  networkFlags(entityIndex: number): number;
  persistedState(): PersistedGameState;
  reset(): void;
};

type GameSimulationOptions = {
  engine: GameEngine;
  bundle: WorldBundle;
  restored: PersistedGameState | null;
  mechanisms?: HostMechanismEngine;
  players: Omit<GamePlayersOptions, "engine" | "bundle" | "use">;
};

export function createGameSimulation(
  options: GameSimulationOptions,
): GameSimulation {
  const { engine, bundle, restored } = options;
  const triggers: Trigger[] = [];
  const mechanisms: Mechanism[] = [];
  const relays: Relay[] = [];
  const buttons: Button[] = [];
  const physicsControls: PhysicsControl[] = [];
  const gravityFields: GravityField[] = [];
  const manipulations: Manipulation[] = [];
  const timedOutManipulations: ManipulationClaim[] = [];
  const gravityFactors = new Map<string, number>();
  const delayedSignals =
    restored?.delayedSignals.map((signal) => ({ ...signal })) ?? [];
  delayedSignals.sort((a, b) => a.dueTick - b.dueTick);

  const setTransform = (mechanism: Mechanism): void => {
    const position = mix(mechanism.start, mechanism.end, mechanism.progress);
    engine.setKinematicTarget(mechanism.handle, position);
  };

  const activateRelay = (relay: Relay): void => {
    if (relay.once && relay.fired) return;
    relay.fired = true;
    delayedSignals.push({
      target: relay.target,
      dueTick: engine.tick + relay.delayTicks,
    });
    delayedSignals.sort((a, b) => a.dueTick - b.dueTick);
    engine.requestSave();
  };

  const activateMechanism = (
    mechanism: Mechanism,
    input: EntityInput,
  ): void => {
    if (input === "open") {
      if (mechanism.progress < 1) mechanism.direction = 1;
    } else if (input === "close") {
      if (mechanism.progress > 0) mechanism.direction = -1;
    } else {
      mechanism.direction = mechanism.progress >= 1 ? -1 : 1;
    }
    mechanism.resumeAtTick = 0;
    engine.requestSave();
  };

  const applyPhysicsControl = (control: PhysicsControl): void => {
    const hostPhysics = options.mechanisms;
    if (!hostPhysics)
      throw new Error("host mechanism physics capabilities are unavailable");
    applyPhysicsControlState(hostPhysics, control);
  };

  const activatePhysicsControl = (
    control: PhysicsControl,
    input: EntityInput,
  ): void => {
    if (input === "enable") control.enabled = true;
    else if (input === "disable") control.enabled = false;
    else if (input === "reverse") control.reversed = !control.reversed;
    else control.enabled = !control.enabled;
    applyPhysicsControl(control);
    engine.requestSave();
  };

  const emitTarget = (targetname: string): void => {
    for (const relay of relays) {
      if (relay.targetname === targetname) activateRelay(relay);
    }
    for (const mechanism of mechanisms) {
      if (mechanism.targetname !== targetname) continue;
      activateMechanism(mechanism, "trigger");
    }
    for (const control of physicsControls) {
      if (control.targetname === targetname)
        activatePhysicsControl(control, "trigger");
    }
  };

  const dispatchConnection = (connection: OutputConnection): void => {
    for (const entityIndex of connection.targetEntityIndices) {
      const relay = relays.find(
        (candidate) => candidate.entityIndex === entityIndex,
      );
      if (relay && connection.input === "trigger") {
        activateRelay(relay);
        continue;
      }
      const mechanism = mechanisms.find(
        (candidate) => candidate.entityIndex === entityIndex,
      );
      if (
        mechanism &&
        (connection.input === "trigger" ||
          connection.input === "open" ||
          connection.input === "close")
      ) {
        activateMechanism(mechanism, connection.input);
        continue;
      }
      const control = physicsControls.find(
        (candidate) => candidate.entityIndex === entityIndex,
      );
      if (
        control &&
        ["trigger", "enable", "disable", "toggle", "reverse"].includes(
          connection.input,
        )
      )
        activatePhysicsControl(control, connection.input);
    }
  };

  const stepMechanisms = (): void => {
    const tick = engine.tick;
    while (delayedSignals[0] && delayedSignals[0].dueTick <= tick) {
      const signal = delayedSignals.shift()!;
      engine.requestSave();
      emitTarget(signal.target);
    }
    for (const mechanism of mechanisms) {
      if (
        mechanism.direction === 0 &&
        mechanism.resumeAtTick > 0 &&
        mechanism.resumeAtTick <= tick
      ) {
        mechanism.direction = mechanism.progress >= 1 ? -1 : 1;
        mechanism.resumeAtTick = 0;
      }
      if (mechanism.direction === 0) {
        engine.setKinematicTarget(
          mechanism.handle,
          engine.bodies.state(mechanism.handle).position,
        );
        continue;
      }
      const distance = vectorLength(mechanism.start, mechanism.end);
      if (distance <= Number.EPSILON || mechanism.speed <= 0) {
        mechanism.direction = 0;
        continue;
      }
      mechanism.progress = clamp(
        mechanism.progress +
          (mechanism.direction * mechanism.speed * engine.dt) / distance,
        0,
        1,
      );
      setTransform(mechanism);
      if (mechanism.progress !== 0 && mechanism.progress !== 1) continue;
      const reachedOpen = mechanism.progress === 1;
      mechanism.direction = 0;
      if (mechanism.mode === "platform" || reachedOpen) {
        mechanism.resumeAtTick = tick + mechanism.waitTicks;
      }
      engine.requestSave();
    }
  };

  const finishManipulation = (
    manipulation: Manipulation,
  ): ManipulationClaim => {
    const index = manipulations.indexOf(manipulation);
    if (index !== -1) manipulations.splice(index, 1);
    options.mechanisms?.destroyConstraint(manipulation.constraint);
    return {
      playerId: { ...manipulation.playerId },
      target: { ...manipulation.target },
      claimVersion: manipulation.claimVersion,
    };
  };

  const stepManipulations = (): void => {
    const timeoutTicks = Math.max(1, Math.ceil(1.5 / engine.dt));
    for (let index = manipulations.length - 1; index >= 0; index -= 1) {
      const manipulation = manipulations[index]!;
      const playerPosition = players.position(manipulation.playerId);
      const body = engine.bodies.resolve(manipulation.target);
      if (
        !playerPosition ||
        !body ||
        engine.tick - manipulation.lastUpdateTick > timeoutTicks ||
        vectorDistance(
          playerPosition,
          engine.bodies.state(manipulation.target).position,
        ) > 5
      ) {
        timedOutManipulations.push(finishManipulation(manipulation));
        continue;
      }
      options.mechanisms?.setControlTarget(
        manipulation.constraint,
        manipulation.targetPosition,
        manipulation.targetRotation,
      );
    }
  };

  const processSensorEvents = (
    begins: PhysicsStepEvents["sensorBegin"],
    ends: PhysicsStepEvents["sensorEnd"],
  ): void => {
    const recomputeGravity = (visitor: RuntimeId): void => {
      const visitorKey = key(visitor);
      const selected = gravityFields
        .filter((field) => (field.visitors.get(visitorKey) ?? 0) > 0)
        .toSorted(
          (left, right) =>
            right.priority - left.priority ||
            left.entityIndex - right.entityIndex,
        )[0];
      const factor = selected?.factor ?? 1;
      gravityFactors.set(visitorKey, factor);
      const body = engine.bodies.resolve(visitor);
      if (!body || !options.mechanisms) return;
      const entity = bundle.entities[body.entityIndex];
      const baseline =
        entity?.body?.kind === "dynamic-brush" ? entity.body.gravityScale : 1;
      options.mechanisms.setGravityScale(visitor, baseline * factor);
    };
    const processGravityEvent = (
      event: PhysicsStepEvents["sensorBegin"][number],
      entering: boolean,
    ): void => {
      const field = gravityFields.find(
        (candidate) => key(candidate.handle) === key(event.sensor),
      );
      if (!field) return;
      const visitorKey = key(event.visitor);
      const previous = field.visitors.get(visitorKey) ?? 0;
      const next = entering ? previous + 1 : Math.max(0, previous - 1);
      if (next === 0) field.visitors.delete(visitorKey);
      else field.visitors.set(visitorKey, next);
      if ((entering && previous === 0) || (!entering && next === 0))
        recomputeGravity(event.visitor);
    };
    for (const event of begins) processGravityEvent(event, true);
    for (const event of ends) processGravityEvent(event, false);

    const proxyKeys = new Set(players.proxies().map(key));
    const tick = engine.tick;
    for (const event of begins) {
      if (!proxyKeys.has(key(event.visitor))) continue;
      const trigger = triggers.find(
        (candidate) => key(candidate.handle) === key(event.sensor),
      );
      if (!trigger) continue;
      const visitor = key(event.visitor);
      const previous = trigger.activeVisitors.get(visitor) ?? 0;
      trigger.activeVisitors.set(visitor, previous + 1);
      if (previous > 0) continue;
      if (trigger.consumed || trigger.readyAtTick > tick) continue;
      if (connectionIsGame(trigger.outputs.enter, bundle))
        dispatchConnection(trigger.outputs.enter);
      trigger.emittedVisitors.add(visitor);
      if (trigger.mode === "once") trigger.consumed = true;
      else trigger.readyAtTick = tick + trigger.waitTicks;
      engine.requestSave();
    }
    for (const event of ends) {
      if (!proxyKeys.has(key(event.visitor))) continue;
      const trigger = triggers.find(
        (candidate) => key(candidate.handle) === key(event.sensor),
      );
      const visitor = key(event.visitor);
      if (!trigger) continue;
      const previous = trigger.activeVisitors.get(visitor) ?? 0;
      const next = Math.max(0, previous - 1);
      if (next > 0) {
        trigger.activeVisitors.set(visitor, next);
        continue;
      }
      trigger.activeVisitors.delete(visitor);
      if (
        previous === 0 ||
        !trigger.outputs.exit ||
        !trigger.emittedVisitors.delete(visitor)
      )
        continue;
      dispatchConnection(trigger.outputs.exit);
    }
  };

  const use = (
    target: RuntimeId,
    rayOrigin: Vec3,
    displacement: Vec3,
  ): boolean => {
    const button = buttons.find(
      (candidate) => key(candidate.handle) === key(target),
    );
    if (!button || button.readyAtTick > engine.tick) return false;
    const hit = engine.raycast(rayOrigin, displacement);
    if (!hit || key(hit.body) !== key(button.handle)) return false;
    button.readyAtTick = engine.tick + button.waitTicks;
    emitTarget(button.target);
    engine.requestSave();
    return true;
  };

  const persistedState = (): PersistedGameState => ({
    entities: [
      ...mechanisms.map((mechanism) => ({
        kind: "linear-mover" as const,
        authoredId: mechanism.authoredId,
        progress: mechanism.progress,
        direction: mechanism.direction,
        resumeAtTick: mechanism.resumeAtTick,
      })),
      ...triggers.map((trigger) => ({
        kind: "trigger" as const,
        authoredId: trigger.authoredId,
        readyAtTick: trigger.readyAtTick,
        consumed: trigger.consumed,
      })),
      ...relays.map((relay) => ({
        kind: "relay" as const,
        authoredId: relay.authoredId,
        fired: relay.fired,
      })),
      ...buttons.map((button) => ({
        kind: "button" as const,
        authoredId: button.authoredId,
        readyAtTick: button.readyAtTick,
      })),
      ...physicsControls.map((control) => ({
        kind: "physics-control" as const,
        authoredId: control.authoredId,
        enabled: control.enabled,
        reversed: control.reversed,
      })),
    ],
    delayedSignals: delayedSignals.map((signal) => ({ ...signal })),
  });

  populate({
    engine,
    bundle,
    restored,
    triggers,
    mechanisms,
    relays,
    buttons,
    physicsControls,
    gravityFields,
    mechanismPhysics: options.mechanisms,
  });
  const players = createGamePlayers({
    ...options.players,
    engine,
    bundle,
    use,
  });
  const beginManipulation: GameSimulation["beginManipulation"] = (
    playerId,
    target,
    claimVersion,
    localAnchor,
  ) => {
    const hostPhysics = options.mechanisms;
    if (!hostPhysics) return "unavailable";
    if (
      manipulations.some(
        (candidate) =>
          sameId(candidate.target, target) ||
          sameId(candidate.playerId, playerId),
      )
    )
      return "busy";
    const body = engine.bodies.resolve(target);
    const entity = body ? bundle.entities[body.entityIndex] : null;
    if (
      !body ||
      entity?.kind !== "physics-prop" ||
      (entity.interaction !== "grab" && entity.interaction !== "manipulate") ||
      entity.body.kind !== "dynamic-brush" ||
      !Object.values(localAnchor).every(Number.isFinite)
    )
      return "unavailable";
    const bodyOrigin = bundle.brushes[entity.body.brushIndices[0]!]!.center;
    const radius = Math.max(
      0,
      ...entity.body.brushIndices.flatMap((brushIndex) =>
        bundle.brushes[brushIndex]!.worldVertices.map((vertex) =>
          magnitude(subtract(vertex, bodyOrigin)),
        ),
      ),
    );
    if (magnitude(localAnchor) > radius + 0.25) return "unavailable";
    const playerPosition = players.position(playerId);
    const bodyState = engine.bodies.state(target);
    if (
      !playerPosition ||
      vectorDistance(playerPosition, bodyState.position) > 4.25
    )
      return "out-of-range";
    const targetPosition = add(
      bodyState.position,
      rotate(bodyState.rotation, localAnchor),
    );
    manipulations.push({
      playerId: { ...playerId },
      target: { ...target },
      claimVersion,
      constraint: hostPhysics.createControl({
        body: target,
        localAnchor,
        targetPosition,
        targetRotation: bodyState.rotation,
      }),
      stateSequence: null,
      lastUpdateTick: engine.tick,
      targetPosition,
      targetRotation: { ...bodyState.rotation },
    });
    return true;
  };
  const updateManipulation: GameSimulation["updateManipulation"] = (
    playerId,
    state,
  ) => {
    const manipulation = manipulations.find(
      (candidate) =>
        sameId(candidate.playerId, playerId) &&
        sameId(candidate.target, state.target) &&
        candidate.claimVersion === state.claimVersion,
    );
    if (
      !manipulation ||
      (manipulation.stateSequence !== null &&
        !isNewerSequence16(state.stateSequence, manipulation.stateSequence))
    )
      return false;
    const playerPosition = players.position(playerId);
    if (
      !playerPosition ||
      vectorDistance(playerChest(playerPosition), state.targetPosition) >
        3.75 ||
      !Object.values(state.targetPosition).every(Number.isFinite) ||
      !Object.values(state.targetRotation).every(Number.isFinite) ||
      Object.values(state.targetPosition).some(
        (value) => Math.abs(value) > 10_000,
      )
    )
      return false;
    manipulation.stateSequence = state.stateSequence;
    manipulation.lastUpdateTick = engine.tick;
    manipulation.targetPosition = { ...state.targetPosition };
    manipulation.targetRotation = { ...state.targetRotation };
    return true;
  };
  const step = (): void => {
    stepMechanisms();
    stepManipulations();
    players.step();
  };
  const reset = (): void => {
    triggers.length = 0;
    mechanisms.length = 0;
    relays.length = 0;
    buttons.length = 0;
    physicsControls.length = 0;
    gravityFields.length = 0;
    manipulations.length = 0;
    timedOutManipulations.length = 0;
    gravityFactors.clear();
    delayedSignals.length = 0;
    populate({
      engine,
      bundle,
      restored: null,
      triggers,
      mechanisms,
      relays,
      buttons,
      physicsControls,
      gravityFields,
      mechanismPhysics: options.mechanisms,
    });
    players.reset();
  };
  return {
    players,
    step,
    processSensorEvents,
    use,
    beginManipulation,
    updateManipulation,
    endManipulation(playerId, target, claimVersion) {
      const manipulation = manipulations.find(
        (candidate) =>
          sameId(candidate.playerId, playerId) &&
          sameId(candidate.target, target) &&
          candidate.claimVersion === claimVersion,
      );
      return manipulation ? finishManipulation(manipulation) : null;
    },
    endManipulationsForPlayer(playerId) {
      return manipulations
        .filter((candidate) => sameId(candidate.playerId, playerId))
        .map(finishManipulation);
    },
    manipulationOwner(target) {
      const owner = manipulations.find((candidate) =>
        sameId(candidate.target, target),
      )?.playerId;
      return owner ? { ...owner } : null;
    },
    takeTimedOutManipulations() {
      return timedOutManipulations.splice(0);
    },
    gravityFactor: (id) => gravityFactors.get(key(id)) ?? 1,
    networkFlags(entityIndex) {
      const control = physicsControls.find(
        (candidate) => candidate.entityIndex === entityIndex,
      );
      return control
        ? (control.enabled ? NETWORK_FLAG_ACTIVE : 0) |
            (control.reversed ? NETWORK_FLAG_REVERSED : 0)
        : 0;
    },
    persistedState,
    reset,
  };
}

type Population = Pick<
  GameSimulationOptions,
  "engine" | "bundle" | "restored"
> & {
  triggers: Trigger[];
  mechanisms: Mechanism[];
  relays: Relay[];
  buttons: Button[];
  physicsControls: PhysicsControl[];
  gravityFields: GravityField[];
  mechanismPhysics?: HostMechanismEngine;
};

function populate(options: Population): void {
  const {
    engine,
    bundle,
    restored,
    triggers,
    mechanisms,
    relays,
    buttons,
    physicsControls,
    gravityFields,
    mechanismPhysics,
  } = options;
  const restoredMechanisms = new Map(
    restored?.entities
      .filter((state) => state.kind === "linear-mover")
      .map((state) => [state.authoredId, state]),
  );
  const restoredControls = new Map(
    restored?.entities
      .filter((state) => state.kind === "physics-control")
      .map((state) => [state.authoredId, state]),
  );
  const restoredSignals = new Map(
    restored?.entities
      .filter(
        (state) =>
          state.kind === "trigger" ||
          state.kind === "relay" ||
          state.kind === "button",
      )
      .map((state) => [state.authoredId, state]),
  );
  for (const [entityIndex, entity] of bundle.entities.entries()) {
    if (entity.kind === "gravity-field") {
      const body = engine.bodies.forEntity(entityIndex);
      if (!body)
        throw new Error(`gravity field body ${entityIndex} is missing`);
      gravityFields.push({
        entityIndex,
        handle: body.id,
        factor: entity.factor,
        priority: entity.priority,
        visitors: new Map(),
      });
      continue;
    }
    if (entity.kind === "surface-motor") {
      if (!mechanismPhysics)
        throw new Error(
          "surface motor requires host mechanism physics capabilities",
        );
      const body = engine.bodies.forEntity(entityIndex);
      if (!body)
        throw new Error(`surface motor body ${entity.authoredId} is missing`);
      const saved = restoredControls.get(entity.authoredId);
      const control: PhysicsControl = {
        kind: "surface",
        entityIndex,
        authoredId: entity.authoredId,
        ...(entity.targetName ? { targetname: entity.targetName } : {}),
        enabled: saved?.enabled ?? entity.startEnabled,
        reversed: saved?.reversed ?? false,
        handle: body.id,
        velocity: entity.velocity,
      };
      physicsControls.push(control);
      applyPhysicsControlState(mechanismPhysics, control);
      continue;
    }
    if (entity.kind === "physics-joint") {
      if (!mechanismPhysics)
        throw new Error(
          "physics joint requires host mechanism physics capabilities",
        );
      const attachmentA = engine.bodies.forEntity(
        entity.attachmentAEntityIndex,
      );
      const attachmentB =
        entity.attachmentBEntityIndex === null
          ? null
          : engine.bodies.forEntity(entity.attachmentBEntityIndex);
      if (
        !attachmentA ||
        (entity.attachmentBEntityIndex !== null && !attachmentB)
      )
        throw new Error(`physics joint body ${entity.authoredId} is missing`);
      const saved = restoredControls.get(entity.authoredId);
      const enabled = saved?.enabled ?? entity.startEnabled;
      const reversed = saved?.reversed ?? false;
      const constraint = createPhysicsJoint(
        mechanismPhysics,
        entity,
        attachmentA.id,
        attachmentB?.id,
        enabled,
        reversed,
      );
      physicsControls.push({
        kind: "joint",
        entityIndex,
        authoredId: entity.authoredId,
        ...(entity.targetName ? { targetname: entity.targetName } : {}),
        enabled,
        reversed,
        entity,
        constraint,
      });
      continue;
    }
    if (entity.kind === "trigger") {
      if (
        !connectionIsGame(entity.outputs.enter, bundle) &&
        (!entity.outputs.exit || !connectionIsGame(entity.outputs.exit, bundle))
      )
        continue;
      const saved = restoredSignals.get(entity.authoredId);
      const body = engine.bodies.forEntity(entityIndex);
      if (!body)
        throw new Error(`trigger body ${entity.authoredId} is missing`);
      triggers.push({
        entityIndex,
        handle: body.id,
        authoredId: entity.authoredId,
        mode: entity.mode,
        outputs: entity.outputs,
        waitTicks: Math.max(1, Math.ceil(entity.waitSeconds / engine.dt)),
        readyAtTick: saved?.kind === "trigger" ? saved.readyAtTick : 0,
        consumed: saved?.kind === "trigger" ? saved.consumed : false,
        activeVisitors: new Map(),
        emittedVisitors: new Set(),
      });
      continue;
    }
    if (entity.kind === "relay") {
      const saved = restoredSignals.get(entity.authoredId);
      relays.push({
        entityIndex,
        authoredId: entity.authoredId,
        targetname: entity.targetName,
        target: entity.target,
        delayTicks: Math.max(0, Math.ceil(entity.delaySeconds / engine.dt)),
        once: entity.once,
        fired: saved?.kind === "relay" ? saved.fired : false,
      });
      continue;
    }
    if (entity.kind === "button") {
      const body = engine.bodies.forEntity(entityIndex);
      if (!body) throw new Error(`button body ${entity.authoredId} is missing`);
      const saved = restoredSignals.get(entity.authoredId);
      buttons.push({
        handle: body.id,
        authoredId: entity.authoredId,
        target: entity.target,
        waitTicks: Math.max(1, Math.ceil(entity.waitSeconds / engine.dt)),
        readyAtTick: saved?.kind === "button" ? saved.readyAtTick : 0,
      });
      continue;
    }
    if (entity.kind !== "linear-mover") continue;
    const body = engine.bodies.forEntity(entityIndex);
    if (!body)
      throw new Error(`mechanism body ${entity.authoredId} is missing`);
    const start = { ...bundle.brushes[entity.body.brushIndices[0]!]!.center };
    const direction = entity.moveDirection;
    const distance = entity.distance;
    const saved = restoredMechanisms.get(entity.authoredId);
    const mechanism: Mechanism = {
      entityIndex,
      handle: body.id,
      authoredId: entity.authoredId,
      mode: entity.mode,
      targetname: entity.targetName,
      start,
      end: {
        x: start.x + direction.x * distance,
        y: start.y + direction.y * distance,
        z: start.z + direction.z * distance,
      },
      speed: entity.speed,
      waitTicks: Math.max(0, Math.ceil(entity.waitSeconds / engine.dt)),
      progress: saved?.progress ?? (entity.startOpen ? 1 : 0),
      direction: saved?.direction ?? 0,
      resumeAtTick: saved?.resumeAtTick ?? 0,
    };
    mechanisms.push(mechanism);
  }
}

function createPhysicsJoint(
  physics: HostMechanismEngine,
  entity: PhysicsJointEntity,
  bodyA: RuntimeId,
  bodyB: RuntimeId | undefined,
  enabled: boolean,
  reversed: boolean,
): ConstraintId {
  const base = {
    bodyA,
    ...(bodyB ? { bodyB } : {}),
    localFrameA: entity.localFrameA,
    localFrameB: entity.localFrameB,
    collideConnected: false,
  };
  const joint = entity.joint;
  if (joint.kind === "revolute")
    return physics.createRevolute({
      ...base,
      ...(joint.limit ? { limit: joint.limit } : {}),
      motor: enabled
        ? reverseRevolute(joint.motor, reversed)
        : { mode: "none" },
    });
  if (joint.kind === "prismatic")
    return physics.createPrismatic({
      ...base,
      ...(joint.limit ? { limit: joint.limit } : {}),
      motor: enabled
        ? reversePrismatic(joint.motor, reversed)
        : { mode: "none" },
    });
  if (joint.kind === "spherical") return physics.createSpherical(base);
  if (joint.kind === "weld") return physics.createWeld(base);
  return physics.createDistance({
    ...base,
    length: joint.length,
    mode: joint.mode,
    hertz: joint.hertz,
    dampingRatio: joint.dampingRatio,
    maxForce: joint.maxForce,
  });
}

function applyPhysicsControlState(
  physics: HostMechanismEngine,
  control: PhysicsControl,
): void {
  if (control.kind === "surface") {
    physics.setSurfaceVelocity(
      control.handle,
      control.enabled
        ? scale(control.velocity, control.reversed ? -1 : 1)
        : { x: 0, y: 0, z: 0 },
    );
    return;
  }
  const joint = control.entity.joint;
  if (joint.kind === "revolute")
    physics.setRevoluteMotor(
      control.constraint,
      control.enabled
        ? reverseRevolute(joint.motor, control.reversed)
        : { mode: "none" },
    );
  else if (joint.kind === "prismatic")
    physics.setPrismaticMotor(
      control.constraint,
      control.enabled
        ? reversePrismatic(joint.motor, control.reversed)
        : { mode: "none" },
    );
}

function reverseRevolute(
  motor: RevoluteMotor,
  reversed: boolean,
): RevoluteMotor {
  if (!reversed) return motor;
  if (motor.mode === "target-angle")
    return { ...motor, targetAngle: -motor.targetAngle };
  if (motor.mode === "target-velocity")
    return { ...motor, targetVelocity: -motor.targetVelocity };
  return motor;
}

function reversePrismatic(
  motor: PrismaticMotor,
  reversed: boolean,
): PrismaticMotor {
  if (!reversed) return motor;
  if (motor.mode === "target-position")
    return { ...motor, targetPosition: -motor.targetPosition };
  if (motor.mode === "target-velocity")
    return { ...motor, targetVelocity: -motor.targetVelocity };
  return motor;
}

function connectionIsGame(
  connection: OutputConnection,
  bundle: WorldBundle,
): boolean {
  const target = bundle.entities[connection.targetEntityIndices[0]!]!;
  return entityInputDomain(target, connection.input) === "game";
}

function key(id: RuntimeId): string {
  return `${id.index}:${id.generation}`;
}
function sameId(a: RuntimeId, b: RuntimeId): boolean {
  return a.index === b.index && a.generation === b.generation;
}
function vectorLength(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}
function vectorDistance(a: Vec3, b: Vec3): number {
  return vectorLength(a, b);
}
function magnitude(value: Vec3): number {
  return Math.hypot(value.x, value.y, value.z);
}
function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function rotate(rotation: Quat, value: Vec3): Vec3 {
  const tx = 2 * (rotation.y * value.z - rotation.z * value.y);
  const ty = 2 * (rotation.z * value.x - rotation.x * value.z);
  const tz = 2 * (rotation.x * value.y - rotation.y * value.x);
  return {
    x: value.x + rotation.w * tx + rotation.y * tz - rotation.z * ty,
    y: value.y + rotation.w * ty + rotation.z * tx - rotation.x * tz,
    z: value.z + rotation.w * tz + rotation.x * ty - rotation.y * tx,
  };
}
function mix(a: Vec3, b: Vec3, amount: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount,
    z: a.z + (b.z - a.z) * amount,
  };
}
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function scale(value: Vec3, amount: number): Vec3 {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount };
}
