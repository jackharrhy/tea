import {
  decodeCompiledEntityCapabilities,
  decodeWorldBundle as decodeEngineWorldBundle,
  encodeWorldBundle as encodeEngineWorldBundle,
  type DynamicBrushBody,
  type JointFrame,
  type KinematicBrushBody,
  type LightPresentation,
  type PrismaticMotor,
  type Quat,
  type RevoluteMotor,
  type SensorBrushBody,
  type StaticBrushBody,
  type SpriteAssetId,
  type Vec3,
  type WorldBundle as EngineWorldBundle,
  type WorldMessage as EngineWorldMessage,
} from "@tea/gurgur-engine";

type EntityBase = {
  authoredId?: string;
  origin?: Vec3;
};

export type EntityInput =
  | "trigger"
  | "open"
  | "close"
  | "play"
  | "stop"
  | "enable"
  | "disable"
  | "toggle"
  | "reverse";

export type OutputConnection = {
  targetEntityIndices: number[];
  input: EntityInput;
};

export type TriggerOutputs = {
  enter: OutputConnection;
  exit?: OutputConnection;
};

export type PhysicsPropEntity = EntityBase & {
  kind: "physics-prop";
  authoredId: string;
  body: DynamicBrushBody;
  presentation: { kind: "brush"; transform: "body" };
  interaction: "grab" | "manipulate" | "none";
  targetName?: string;
};

type PhysicsJointBase = EntityBase & {
  kind: "physics-joint";
  authoredId: string;
  targetName?: string;
  attachmentAEntityIndex: number;
  attachmentBEntityIndex: number | null;
  localFrameA: JointFrame;
  localFrameB: JointFrame;
  startEnabled: boolean;
  body: null;
  presentation:
    | {
        kind: "constraint";
        style:
          | "hinge"
          | "motor"
          | "slider"
          | "ball-socket"
          | "rope"
          | "rod"
          | "spring"
          | "weld";
      }
    | { kind: "none" };
  interaction: "none";
};

export type PhysicsJointEntity = PhysicsJointBase & {
  joint:
    | {
        kind: "revolute";
        limit: { lowerAngle: number; upperAngle: number } | null;
        motor: RevoluteMotor;
      }
    | {
        kind: "prismatic";
        limit: { lowerTranslation: number; upperTranslation: number } | null;
        motor: PrismaticMotor;
      }
    | { kind: "spherical" }
    | { kind: "weld" }
    | {
        kind: "distance";
        mode: "rope" | "rod" | "spring";
        length: number;
        hertz: number;
        dampingRatio: number;
        maxForce: number;
      };
};

export type SurfaceMotorEntity = EntityBase & {
  kind: "surface-motor";
  authoredId: string;
  targetName?: string;
  velocity: Vec3;
  friction: number;
  startEnabled: boolean;
  body: StaticBrushBody;
  presentation: { kind: "brush"; transform: "body" };
  interaction: "none";
};

export type GravityFieldEntity = EntityBase & {
  kind: "gravity-field";
  factor: number;
  priority: number;
  body: SensorBrushBody;
  presentation: { kind: "none" };
  interaction: "none";
};

export type LinearMoverEntity = EntityBase & {
  kind: "linear-mover";
  authoredId: string;
  mode: "door" | "platform";
  targetName: string;
  moveDirection: Vec3;
  distance: number;
  speed: number;
  waitSeconds: number;
  startOpen: boolean;
  body: KinematicBrushBody;
  presentation: { kind: "brush"; transform: "body" };
  interaction: "none";
};

export type TriggerEntity = EntityBase & {
  kind: "trigger";
  authoredId: string;
  mode: "once" | "multiple";
  outputs: TriggerOutputs;
  waitSeconds: number;
  body: SensorBrushBody;
  presentation: { kind: "none" };
  interaction: "none";
};

export type RelayEntity = EntityBase & {
  kind: "relay";
  authoredId: string;
  targetName: string;
  target: string;
  delaySeconds: number;
  once: boolean;
  body: null;
  presentation: { kind: "none" };
  interaction: "none";
};

export type ButtonEntity = EntityBase & {
  kind: "button";
  authoredId: string;
  target: string;
  waitSeconds: number;
  body: KinematicBrushBody;
  presentation: { kind: "brush"; transform: "body" };
  interaction: "use";
};

export type SpriteEntity = EntityBase & {
  kind: "sprite";
  origin: Vec3;
  body: null;
  presentation: {
    kind: "sprite";
    asset: SpriteAssetId;
    height: number;
    glow: boolean;
  };
  interaction: "none";
};

export type AmbientAudioEntity = EntityBase & {
  kind: "ambient-audio";
  asset: string;
  volume: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  loop: boolean;
  priority: number;
  body: null;
  presentation: { kind: "none" };
  interaction: "none";
};

export type LightEntity = EntityBase & {
  kind: "light";
  origin: Vec3;
  body: null;
  presentation: LightPresentation;
  interaction: "none";
};

export type CompiledGameEntity =
  | PhysicsPropEntity
  | PhysicsJointEntity
  | SurfaceMotorEntity
  | GravityFieldEntity
  | LinearMoverEntity
  | TriggerEntity
  | RelayEntity
  | ButtonEntity
  | SpriteEntity
  | AmbientAudioEntity
  | LightEntity;

export type WorldBundle = EngineWorldBundle<CompiledGameEntity>;
export type WorldMessage = EngineWorldMessage<CompiledGameEntity>;

export function encodeWorldBundle(bundle: WorldBundle): Uint8Array {
  decodeCompiledGameEntities(bundle.entities);
  return encodeEngineWorldBundle(bundle);
}

export function decodeWorldBundle(
  input: ArrayBuffer | ArrayBufferView,
): WorldBundle {
  return decodeEngineWorldBundle(input, decodeCompiledGameEntities);
}

export function decodeCompiledGameEntities(
  value: unknown,
): CompiledGameEntity[] {
  const entities = decodeCompiledEntityCapabilities(value);
  for (const entity of entities) {
    const record = entity as Record<string, unknown>;
    switch (entity.kind) {
      case "physics-prop":
        assertAuthoredId(record);
        requireBody(record.body, "dynamic-brush");
        requireBrushPresentation(record, "body");
        if (
          record.interaction !== "grab" &&
          record.interaction !== "manipulate" &&
          record.interaction !== "none"
        )
          throw new Error("world bundle physics prop interaction is invalid");
        if (record.targetName !== undefined)
          assertString(
            record.targetName,
            "world bundle physics prop targetName",
          );
        break;
      case "physics-joint":
        assertAuthoredId(record);
        if (record.body !== null)
          throw new Error("world bundle physics joint cannot have a body");
        if (
          !isRecord(record.presentation) ||
          (record.presentation.kind !== "none" &&
            record.presentation.kind !== "constraint")
        )
          throw new Error("world bundle physics joint presentation is invalid");
        requireInteraction(record, "none");
        assertEntityIndex(
          record.attachmentAEntityIndex,
          "physics joint attachment A",
        );
        if (record.attachmentBEntityIndex !== null)
          assertEntityIndex(
            record.attachmentBEntityIndex,
            "physics joint attachment B",
          );
        assertJointFrame(record.localFrameA, "physics joint local frame A");
        assertJointFrame(record.localFrameB, "physics joint local frame B");
        if (typeof record.startEnabled !== "boolean")
          throw new Error(
            "world bundle physics joint startEnabled must be boolean",
          );
        if (record.targetName !== undefined)
          assertString(
            record.targetName,
            "world bundle physics joint targetName",
          );
        assertPhysicsJoint(record.joint);
        break;
      case "surface-motor":
        assertAuthoredId(record);
        requireBody(record.body, "static-brush");
        requireBrushPresentation(record, "body");
        requireInteraction(record, "none");
        assertVec3(record.velocity, "world bundle surface motor velocity");
        assertFiniteFields(record, ["friction"]);
        if ((record.friction as number) < 0)
          throw new Error(
            "world bundle surface motor friction cannot be negative",
          );
        if (record.targetName !== undefined)
          assertString(
            record.targetName,
            "world bundle surface motor targetName",
          );
        if (typeof record.startEnabled !== "boolean")
          throw new Error(
            "world bundle surface motor startEnabled must be boolean",
          );
        break;
      case "gravity-field":
        requireBody(record.body, "sensor-brush");
        requireNoPresentation(record);
        requireInteraction(record, "none");
        assertFiniteFields(record, ["factor", "priority"]);
        if (
          (record.factor as number) < 0 ||
          !Number.isSafeInteger(record.priority)
        )
          throw new Error(
            "world bundle gravity field factor or priority is invalid",
          );
        break;
      case "linear-mover":
        assertAuthoredId(record);
        requireBody(record.body, "kinematic-brush");
        requireBrushPresentation(record, "body");
        requireInteraction(record, "none");
        if (record.mode !== "door" && record.mode !== "platform")
          throw new Error("world bundle linear mover mode is invalid");
        assertString(record.targetName, "world bundle linear mover targetName");
        assertVec3(record.moveDirection, "world bundle linear mover direction");
        assertFiniteFields(record, ["distance", "speed", "waitSeconds"]);
        if (typeof record.startOpen !== "boolean")
          throw new Error(
            "world bundle linear mover startOpen must be boolean",
          );
        break;
      case "trigger":
        assertAuthoredId(record);
        requireBody(record.body, "sensor-brush");
        requireNoPresentation(record);
        requireInteraction(record, "none");
        if (record.mode !== "once" && record.mode !== "multiple")
          throw new Error("world bundle trigger mode is invalid");
        assertTriggerOutputs(record.outputs);
        assertFiniteFields(record, ["waitSeconds"]);
        break;
      case "relay":
        assertAuthoredId(record);
        if (record.body !== null)
          throw new Error("world bundle relay cannot have a body");
        requireNoPresentation(record);
        requireInteraction(record, "none");
        assertString(record.targetName, "world bundle relay targetName");
        assertString(record.target, "world bundle relay target");
        assertFiniteFields(record, ["delaySeconds"]);
        if (typeof record.once !== "boolean")
          throw new Error("world bundle relay once must be boolean");
        break;
      case "button":
        assertAuthoredId(record);
        requireBody(record.body, "kinematic-brush");
        requireBrushPresentation(record, "body");
        requireInteraction(record, "use");
        assertString(record.target, "world bundle button target");
        assertFiniteFields(record, ["waitSeconds"]);
        break;
      case "sprite":
        if (record.body !== null)
          throw new Error("world bundle sprite cannot have a body");
        requireInteraction(record, "none");
        assertVec3(record.origin, "world bundle sprite origin");
        if (
          !isRecord(record.presentation) ||
          record.presentation.kind !== "sprite"
        )
          throw new Error("world bundle sprite presentation must be sprite");
        break;
      case "ambient-audio":
        if (record.body !== null)
          throw new Error("world bundle ambient audio cannot have a body");
        requireNoPresentation(record);
        requireInteraction(record, "none");
        assertLogicalAssetId(record.asset, "world bundle ambient audio asset");
        assertFiniteFields(record, [
          "volume",
          "fadeInSeconds",
          "fadeOutSeconds",
          "priority",
        ]);
        if ((record.volume as number) < 0 || (record.volume as number) > 1)
          throw new Error(
            "world bundle ambient audio volume must be between zero and one",
          );
        if (
          (record.fadeInSeconds as number) < 0 ||
          (record.fadeOutSeconds as number) < 0
        )
          throw new Error(
            "world bundle ambient audio fades must not be negative",
          );
        if (!Number.isSafeInteger(record.priority))
          throw new Error(
            "world bundle ambient audio priority must be an integer",
          );
        if (typeof record.loop !== "boolean")
          throw new Error("world bundle ambient audio loop must be boolean");
        break;
      case "light":
        if (record.body !== null)
          throw new Error("world bundle light cannot have a body");
        requireInteraction(record, "none");
        assertVec3(record.origin, "world bundle light origin");
        if (
          !isRecord(record.presentation) ||
          record.presentation.kind !== "light"
        )
          throw new Error("world bundle light presentation must be light");
        break;
      default:
        throw new Error(`world bundle entity kind ${entity.kind} is invalid`);
    }
  }
  const compiledEntities = entities as CompiledGameEntity[];
  for (const entity of compiledEntities) {
    if (entity.kind === "physics-joint") {
      const attachmentA = compiledEntities[entity.attachmentAEntityIndex];
      const attachmentB =
        entity.attachmentBEntityIndex === null
          ? null
          : compiledEntities[entity.attachmentBEntityIndex];
      if (
        !attachmentA?.body ||
        attachmentA.body.kind === "sensor-brush" ||
        (entity.attachmentBEntityIndex !== null &&
          (!attachmentB?.body || attachmentB.body.kind === "sensor-brush"))
      )
        throw new Error("world bundle physics joint attachment is invalid");
      if (
        attachmentA.body.kind !== "dynamic-brush" &&
        attachmentB?.body?.kind !== "dynamic-brush"
      )
        throw new Error(
          "world bundle physics joint requires a dynamic attachment",
        );
      for (const attachment of [attachmentA, attachmentB]) {
        if (
          attachment?.body?.kind === "dynamic-brush" &&
          attachment.interaction === "grab"
        )
          throw new Error("world bundle jointed body cannot be grabbable");
      }
      continue;
    }
    if (entity.kind !== "trigger") continue;
    for (const connection of [entity.outputs.enter, entity.outputs.exit]) {
      if (!connection) continue;
      for (const targetEntityIndex of connection.targetEntityIndices) {
        const target = compiledEntities[targetEntityIndex];
        if (!target)
          throw new Error(
            "world bundle trigger output target index is out of bounds",
          );
        if (!entityInputDomain(target, connection.input))
          throw new Error(
            `world bundle ${target.kind} does not support input ${connection.input}`,
          );
      }
    }
    assertListenerOutputPair(entity.outputs, compiledEntities);
  }
  return compiledEntities;
}

export function entityInputDomain(
  entity: CompiledGameEntity,
  input: EntityInput,
): "game" | "listener" | null {
  if (entity.kind === "ambient-audio")
    return input === "play" || input === "stop" ? "listener" : null;
  if (entity.kind === "linear-mover")
    return input === "trigger" || input === "open" || input === "close"
      ? "game"
      : null;
  if (entity.kind === "relay") return input === "trigger" ? "game" : null;
  if (entity.kind === "surface-motor" || entity.kind === "physics-joint")
    return ["trigger", "enable", "disable", "toggle", "reverse"].includes(input)
      ? "game"
      : null;
  return null;
}

function assertTriggerOutputs(value: unknown): asserts value is TriggerOutputs {
  if (!isRecord(value))
    throw new Error("world bundle trigger outputs must be an object");
  const fields = Object.keys(value);
  if (
    fields.some((field) => field !== "enter" && field !== "exit") ||
    !("enter" in value)
  )
    throw new Error("world bundle trigger outputs are invalid");
  assertOutputConnection(value.enter);
  if (value.exit !== undefined) assertOutputConnection(value.exit);
}

function assertOutputConnection(
  value: unknown,
): asserts value is OutputConnection {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (field) => !["input", "targetEntityIndices"].includes(field),
    )
  )
    throw new Error("world bundle output connection is invalid");
  if (!entityInput(value.input))
    throw new Error("world bundle output connection input is invalid");
  if (
    !Array.isArray(value.targetEntityIndices) ||
    value.targetEntityIndices.length === 0 ||
    value.targetEntityIndices.length > 1_024 ||
    value.targetEntityIndices.some(
      (index) => !Number.isSafeInteger(index) || index < 0,
    ) ||
    new Set(value.targetEntityIndices).size !== value.targetEntityIndices.length
  ) {
    throw new Error("world bundle output connection targets are invalid");
  }
}

function assertListenerOutputPair(
  outputs: TriggerOutputs,
  entities: CompiledGameEntity[],
): void {
  const enterDomain = connectionDomain(outputs.enter, entities);
  const exitDomain = outputs.exit
    ? connectionDomain(outputs.exit, entities)
    : null;
  if (enterDomain !== "listener" && exitDomain !== "listener") return;
  if (
    outputs.enter.input !== "play" ||
    outputs.exit?.input !== "stop" ||
    outputs.enter.targetEntityIndices.length !==
      outputs.exit.targetEntityIndices.length ||
    outputs.enter.targetEntityIndices.some(
      (target, index) => outputs.exit!.targetEntityIndices[index] !== target,
    )
  ) {
    throw new Error(
      "world bundle listener trigger outputs must pair play on enter with stop on exit",
    );
  }
}

function connectionDomain(
  connection: OutputConnection,
  entities: CompiledGameEntity[],
): "game" | "listener" | null {
  return entityInputDomain(
    entities[connection.targetEntityIndices[0]!]!,
    connection.input,
  );
}

function entityInput(value: unknown): value is EntityInput {
  return [
    "trigger",
    "open",
    "close",
    "play",
    "stop",
    "enable",
    "disable",
    "toggle",
    "reverse",
  ].includes(String(value));
}

function assertEntityIndex(
  value: unknown,
  label: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error(`${label} is invalid`);
}

function assertJointFrame(
  value: unknown,
  label: string,
): asserts value is JointFrame {
  if (!isRecord(value)) throw new Error(`${label} is invalid`);
  assertVec3(value.position, `${label} position`);
  assertQuat(value.rotation, `${label} rotation`);
}

function assertQuat(value: unknown, label: string): asserts value is Quat {
  if (
    !isRecord(value) ||
    !["x", "y", "z", "w"].every(
      (field) =>
        typeof value[field] === "number" && Number.isFinite(value[field]),
    )
  )
    throw new Error(`${label} must contain finite x, y, z, and w`);
}

function assertPhysicsJoint(value: unknown): void {
  if (!isRecord(value) || typeof value.kind !== "string")
    throw new Error("world bundle physics joint definition is invalid");
  if (value.kind === "revolute") {
    if (value.limit !== null) {
      if (!isRecord(value.limit))
        throw new Error("world bundle revolute joint limit is invalid");
      assertFiniteFields(value.limit, ["lowerAngle", "upperAngle"]);
      if (
        (value.limit.lowerAngle as number) > (value.limit.upperAngle as number)
      )
        throw new Error("world bundle revolute joint limits are reversed");
    }
    assertRevoluteMotor(value.motor);
    return;
  }
  if (value.kind === "prismatic") {
    if (value.limit !== null) {
      if (!isRecord(value.limit))
        throw new Error("world bundle prismatic joint limit is invalid");
      assertFiniteFields(value.limit, ["lowerTranslation", "upperTranslation"]);
      if (
        (value.limit.lowerTranslation as number) >
        (value.limit.upperTranslation as number)
      )
        throw new Error("world bundle prismatic joint limits are reversed");
    }
    assertPrismaticMotor(value.motor);
    return;
  }
  if (value.kind === "distance") {
    if (!["rope", "rod", "spring"].includes(String(value.mode)))
      throw new Error("world bundle distance joint mode is invalid");
    assertFiniteFields(value, ["length", "hertz", "dampingRatio", "maxForce"]);
    if (
      (value.length as number) <= 0 ||
      (value.hertz as number) < 0 ||
      (value.dampingRatio as number) < 0 ||
      (value.maxForce as number) < 0
    )
      throw new Error("world bundle distance joint parameters are invalid");
    return;
  }
  if (value.kind !== "spherical" && value.kind !== "weld")
    throw new Error("world bundle physics joint kind is invalid");
}

function assertRevoluteMotor(value: unknown): void {
  if (!isRecord(value) || typeof value.mode !== "string")
    throw new Error("world bundle revolute motor is invalid");
  if (value.mode === "none") return;
  if (value.mode === "friction") {
    assertFiniteFields(value, ["maxTorque"]);
    if ((value.maxTorque as number) < 0)
      throw new Error("world bundle revolute friction torque is invalid");
    return;
  }
  if (value.mode === "target-angle") {
    assertFiniteFields(value, ["targetAngle", "hertz", "dampingRatio"]);
    if ((value.hertz as number) < 0 || (value.dampingRatio as number) < 0)
      throw new Error("world bundle revolute spring tuning is invalid");
    return;
  }
  if (value.mode === "target-velocity") {
    assertFiniteFields(value, ["targetVelocity", "maxTorque"]);
    if ((value.maxTorque as number) < 0)
      throw new Error("world bundle revolute motor torque is invalid");
    return;
  }
  throw new Error("world bundle revolute motor mode is invalid");
}

function assertPrismaticMotor(value: unknown): void {
  if (!isRecord(value) || typeof value.mode !== "string")
    throw new Error("world bundle prismatic motor is invalid");
  if (value.mode === "none") return;
  if (value.mode === "target-position") {
    assertFiniteFields(value, ["targetPosition", "hertz", "dampingRatio"]);
    if ((value.hertz as number) < 0 || (value.dampingRatio as number) < 0)
      throw new Error("world bundle prismatic spring tuning is invalid");
    return;
  }
  if (value.mode === "target-velocity") {
    assertFiniteFields(value, ["targetVelocity", "maxForce"]);
    if ((value.maxForce as number) < 0)
      throw new Error("world bundle prismatic motor force is invalid");
    return;
  }
  throw new Error("world bundle prismatic motor mode is invalid");
}

function requireBody(value: unknown, kind: string): void {
  if (!isRecord(value) || value.kind !== kind)
    throw new Error(`world bundle body must be ${kind}`);
}

function requireBrushPresentation(
  entity: Record<string, unknown>,
  transform: string,
): void {
  if (
    !isRecord(entity.presentation) ||
    entity.presentation.kind !== "brush" ||
    entity.presentation.transform !== transform
  )
    throw new Error(
      `world bundle brush presentation must use ${transform} transforms`,
    );
}

function requireNoPresentation(entity: Record<string, unknown>): void {
  if (!isRecord(entity.presentation) || entity.presentation.kind !== "none")
    throw new Error("world bundle entity presentation must be none");
}

function requireInteraction(
  entity: Record<string, unknown>,
  interaction: string,
): void {
  if (entity.interaction !== interaction)
    throw new Error(
      `world bundle ${String(entity.kind)} interaction must be ${interaction}`,
    );
}

function assertAuthoredId(entity: Record<string, unknown>): void {
  assertString(entity.authoredId, "world bundle entity authoredId");
}

function assertFiniteFields(
  value: Record<string, unknown>,
  fields: string[],
): void {
  for (const field of fields)
    if (typeof value[field] !== "number" || !Number.isFinite(value[field]))
      throw new Error(`world bundle ${field} must be finite`);
}

function assertVec3(value: unknown, label: string): asserts value is Vec3 {
  if (
    !isRecord(value) ||
    typeof value.x !== "number" ||
    !Number.isFinite(value.x) ||
    typeof value.y !== "number" ||
    !Number.isFinite(value.y) ||
    typeof value.z !== "number" ||
    !Number.isFinite(value.z)
  )
    throw new Error(`${label} must contain finite x, y, and z`);
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${label} must be a string`);
}

function assertLogicalAssetId(
  value: unknown,
  label: string,
): asserts value is string {
  assertString(value, label);
  if (!/^[a-z0-9][a-z0-9/_-]*$/.test(value))
    throw new Error(`${label} must be an extensionless logical asset ID`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
