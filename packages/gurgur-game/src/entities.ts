import type {
  PlayerSpawn,
  Quat,
  ResetMarker,
  Rgb,
  SpriteAssetId,
  Vec3,
  WorldSettings,
} from "@tea/gurgur-engine";
import type {
  CompiledGameEntity,
  EntityInput,
  PhysicsJointEntity,
  TriggerEntity,
} from "./world";

export type PropertySource = {
  sourceName: string;
  classname: string;
  property: string;
  line: number;
};

export type EntityProperty<T> = {
  editor: {
    type:
      | "string"
      | "number"
      | "boolean"
      | "vector"
      | "angles"
      | "choices"
      | "target"
      | "targetname";
    description: string;
    default?: string | number | boolean;
    choices?: readonly { value: string | number; label: string }[];
  };
  parse(raw: string | undefined, source: PropertySource): T;
};

export type InferProperties<S extends Record<string, EntityProperty<unknown>>> =
  {
    [K in keyof S]: S[K] extends EntityProperty<infer T> ? T : never;
  };

export type EntityCompileContext = {
  sourceName: string;
  line: number;
  classname: string;
  authoredId?: string;
  origin?: Vec3;
  brushIndices: number[];
};

export type CompiledAuthoredEntity =
  | { kind: "world-settings"; settings: WorldSettings }
  | { kind: "player-spawn"; spawn: PlayerSpawn }
  | { kind: "reset-marker"; marker: ResetMarker }
  | { kind: "game-entity"; entity: CompiledGameEntity }
  | {
      kind: "connected-trigger";
      entity: Omit<TriggerEntity, "outputs">;
      outputs: {
        enter: AuthoredOutputConnection;
        exit?: AuthoredOutputConnection;
      };
    }
  | {
      kind: "connected-physics-joint";
      entity: Omit<
        PhysicsJointEntity,
        | "attachmentAEntityIndex"
        | "attachmentBEntityIndex"
        | "localFrameA"
        | "localFrameB"
      >;
      attach1: string;
      attach2?: string;
      worldFrame: { position: Vec3; rotation: Quat };
      secondWorldPosition?: Vec3;
    };

export type AuthoredOutputConnection = {
  target: string;
  input: EntityInput;
};

export type EntityDefinition<
  S extends Record<string, EntityProperty<unknown>>,
  O extends CompiledAuthoredEntity,
> = {
  editor: {
    kind: "point" | "solid";
    description: string;
    color: readonly [number, number, number];
    size?: readonly [number, number, number, number, number, number];
    persistent: boolean;
  };
  properties: S;
  compile(context: EntityCompileContext, properties: InferProperties<S>): O;
};

type PropertyOptions<T> = { default?: T; optional?: boolean };

function sourceLabel(source: PropertySource): string {
  return `${source.sourceName}:${source.line}: ${source.classname}.${source.property}`;
}

function requiredRaw(
  raw: string | undefined,
  source: PropertySource,
  fallback: string | number | boolean | undefined,
  optional: boolean,
): string | undefined {
  if (raw !== undefined && raw !== "") return raw;
  if (fallback !== undefined) return String(fallback);
  if (optional) return undefined;
  throw new Error(`${sourceLabel(source)} is required`);
}

export function stringProperty(
  description: string,
  options?: PropertyOptions<string> & { optional?: false },
): EntityProperty<string>;
export function stringProperty(
  description: string,
  options: PropertyOptions<string> & { optional: true },
): EntityProperty<string | undefined>;
export function stringProperty(
  description: string,
  options: PropertyOptions<string> = {},
): EntityProperty<string | undefined> {
  return {
    editor: {
      type: "string",
      description,
      ...(options.default === undefined ? {} : { default: options.default }),
    },
    parse(raw, source) {
      return requiredRaw(
        raw,
        source,
        options.default,
        options.optional ?? false,
      );
    },
  };
}

export function boundedNumberProperty(
  description: string,
  options: PropertyOptions<number> & { min?: number; max?: number } = {},
): EntityProperty<number> {
  return {
    editor: {
      type: "number",
      description,
      ...(options.default === undefined ? {} : { default: options.default }),
    },
    parse(raw, source) {
      const sourceValue = requiredRaw(
        raw,
        source,
        options.default,
        options.optional ?? false,
      );
      if (sourceValue === undefined) return undefined as never;
      const value = Number(sourceValue);
      if (!Number.isFinite(value))
        throw new Error(`${sourceLabel(source)} must be numeric`);
      if (options.min !== undefined && value < options.min)
        throw new Error(
          `${sourceLabel(source)} must be at least ${options.min}`,
        );
      if (options.max !== undefined && value > options.max)
        throw new Error(
          `${sourceLabel(source)} must be at most ${options.max}`,
        );
      return value;
    },
  };
}

export function booleanProperty(
  description: string,
  options: PropertyOptions<boolean> = {},
): EntityProperty<boolean> {
  return {
    editor: {
      type: "boolean",
      description,
      ...(options.default === undefined ? {} : { default: options.default }),
    },
    parse(raw, source) {
      const value = requiredRaw(
        raw,
        source,
        options.default,
        options.optional ?? false,
      );
      if (value === "1" || value === "true") return true;
      if (value === "0" || value === "false") return false;
      throw new Error(`${sourceLabel(source)} must be 0 or 1`);
    },
  };
}

function parseVector(
  raw: string | undefined,
  source: PropertySource,
  fallback?: string,
): Vec3 {
  const value = requiredRaw(raw, source, fallback, false)!;
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || !parts.every(Number.isFinite))
    throw new Error(`${sourceLabel(source)} must be a three-number vector`);
  return { x: parts[0]!, y: parts[1]!, z: parts[2]! };
}

export function vectorProperty(
  description: string,
  options: PropertyOptions<string> = {},
): EntityProperty<Vec3> {
  return {
    editor: {
      type: "vector",
      description,
      ...(options.default === undefined ? {} : { default: options.default }),
    },
    parse: (raw, source) => parseVector(raw, source, options.default),
  };
}

export function colorProperty(
  description: string,
  options: PropertyOptions<string> = {},
): EntityProperty<Rgb> {
  const vector = vectorProperty(description, options);
  return {
    editor: vector.editor,
    parse(raw, source) {
      const { x: r, y: g, z: b } = vector.parse(raw, source);
      if ([r, g, b].some((component) => component < 0 || component > 1))
        throw new Error(
          `${sourceLabel(source)} components must be between 0 and 1`,
        );
      return { r, g, b };
    },
  };
}

export function targetProperty(
  description?: string,
  options?: { optional?: false },
): EntityProperty<string>;
export function targetProperty(
  description: string,
  options: { optional: true },
): EntityProperty<string | undefined>;
export function targetProperty(
  description = "Entity targetname to signal",
  options: { optional?: boolean } = {},
): EntityProperty<string | undefined> {
  const property = options.optional
    ? stringProperty(description, { optional: true })
    : stringProperty(description);
  return { ...property, editor: { ...property.editor, type: "target" } };
}

export function targetNameProperty(
  description?: string,
  options?: { optional?: false },
): EntityProperty<string>;
export function targetNameProperty(
  description: string,
  options: { optional: true },
): EntityProperty<string | undefined>;
export function targetNameProperty(
  description = "Name other entities can target",
  options: { optional?: boolean } = {},
): EntityProperty<string | undefined> {
  const property = options.optional
    ? stringProperty(description, { optional: true })
    : stringProperty(description);
  return { ...property, editor: { ...property.editor, type: "targetname" } };
}

export function choiceProperty<const T extends string>(
  description: string,
  choices: readonly { value: T; label: string }[],
  defaultValue: T,
): EntityProperty<T> {
  const allowed = new Set(choices.map((choice) => choice.value));
  return {
    editor: {
      type: "choices",
      description,
      default: defaultValue,
      choices,
    },
    parse(raw, source) {
      const value = requiredRaw(raw, source, defaultValue, false)!;
      if (!allowed.has(value as T))
        throw new Error(
          `${sourceLabel(source)} must be one of ${[...allowed].join(", ")}`,
        );
      return value as T;
    },
  };
}

export const METRES_PER_MAP_UNIT = 0.0254;
const canonicalZero = (value: number): number => (value === 0 ? 0 : value);

function mapDistanceProperty(
  description: string,
  options: PropertyOptions<number> & { min?: number; max?: number } = {},
): EntityProperty<number> {
  const property = boundedNumberProperty(description, options);
  return {
    editor: property.editor,
    parse: (raw, source) => property.parse(raw, source) * METRES_PER_MAP_UNIT,
  };
}

const mapSpeedProperty = mapDistanceProperty;

export function yawAngleProperty(
  description: string,
  options: PropertyOptions<number> = {},
): EntityProperty<number> {
  const property = boundedNumberProperty(description, options);
  return {
    editor: property.editor,
    parse(raw, source) {
      const radians = (-property.parse(raw, source) * Math.PI) / 180;
      return radians === 0 ? 0 : radians;
    },
  };
}

export function logicalSpriteAssetProperty(
  description: string,
  options: PropertyOptions<string> = {},
): EntityProperty<SpriteAssetId> {
  return logicalAssetProperty(description, options);
}

export function logicalAudioAssetProperty(
  description: string,
  options: PropertyOptions<string> = {},
): EntityProperty<string> {
  return logicalAssetProperty(description, options);
}

function entityInputProperty(
  description: string,
  defaultInput: EntityInput,
): EntityProperty<EntityInput> {
  const choices = [
    "trigger",
    "open",
    "close",
    "play",
    "stop",
    "enable",
    "disable",
    "toggle",
    "reverse",
  ].map((value) => ({ value: value as EntityInput, label: value }));
  const property = choiceProperty(description, choices, defaultInput);
  return {
    editor: property.editor,
    parse(raw, source) {
      const input = property.parse(raw, source);
      return input as EntityInput;
    },
  };
}

function logicalAssetProperty<T extends string>(
  description: string,
  options: PropertyOptions<string>,
): EntityProperty<T> {
  const property = stringProperty(
    description,
    options.default === undefined ? {} : { default: options.default },
  );
  return {
    editor: property.editor,
    parse(raw, source) {
      const value = property.parse(raw, source);
      if (!/^[a-z0-9][a-z0-9/_-]*$/.test(value))
        throw new Error(
          `${sourceLabel(source)} must be an extensionless logical asset ID`,
        );
      return value as T;
    },
  };
}

function mapDirectionProperty(
  description: string,
  fallback: string,
): EntityProperty<Vec3> {
  const property = vectorProperty(description, { default: fallback });
  return {
    editor: property.editor,
    parse(raw, source) {
      const map = property.parse(raw, source);
      const world = {
        x: map.x * METRES_PER_MAP_UNIT,
        y: map.z * METRES_PER_MAP_UNIT,
        z: -map.y * METRES_PER_MAP_UNIT,
      };
      const length = Math.sqrt(
        world.x * world.x + world.y * world.y + world.z * world.z,
      );
      if (length === 0)
        throw new Error(`${sourceLabel(source)} must not be zero`);
      return {
        x: canonicalZero(world.x / length),
        y: canonicalZero(world.y / length),
        z: canonicalZero(world.z / length),
      };
    },
  };
}

function anglesProperty(
  description = "Source-style pitch yaw roll",
): EntityProperty<Quat> {
  const property = vectorProperty(description, { default: "0 0 0" });
  return {
    editor: { ...property.editor, type: "angles" },
    parse(raw, source) {
      const angles = property.parse(raw, source);
      const radians = {
        pitch: (-angles.x * Math.PI) / 180,
        yaw: (-angles.y * Math.PI) / 180,
        roll: (angles.z * Math.PI) / 180,
      };
      const mapRotation = multiplyQuat(
        axisAngle({ x: 0, y: 0, z: 1 }, radians.yaw),
        multiplyQuat(
          axisAngle({ x: 0, y: 1, z: 0 }, radians.pitch),
          axisAngle({ x: 1, y: 0, z: 0 }, radians.roll),
        ),
      );
      const basis = axisAngle({ x: 1, y: 0, z: 0 }, -Math.PI / 2);
      return normalizeQuat(multiplyQuat(basis, mapRotation));
    },
  };
}

function degreesProperty(
  description: string,
  options: PropertyOptions<number> & { min?: number; max?: number } = {},
): EntityProperty<number> {
  const property = boundedNumberProperty(description, options);
  return {
    editor: property.editor,
    parse: (raw, source) => (property.parse(raw, source) * Math.PI) / 180,
  };
}

function coneAngleProperty(
  description: string,
  fallback: number,
): EntityProperty<number> {
  const property = boundedNumberProperty(description, {
    default: fallback,
    min: 0.1,
    max: 90,
  });
  return {
    editor: property.editor,
    parse: (raw, source) => (property.parse(raw, source) * Math.PI) / 180,
  };
}

function defineEntity<
  S extends Record<string, EntityProperty<unknown>>,
  O extends CompiledAuthoredEntity,
>(
  definition: EntityDefinition<S, O>,
): EntityDefinition<S, O> & {
  compileRaw(context: EntityCompileContext, raw: Record<string, string>): O;
} {
  return {
    ...definition,
    compileRaw(context, raw) {
      const properties = Object.fromEntries(
        Object.entries(definition.properties).map(([name, property]) => [
          name,
          property.parse(raw[name], {
            sourceName: context.sourceName,
            line: context.line,
            classname: context.classname,
            property: name,
          }),
        ]),
      ) as InferProperties<S>;
      return definition.compile(context, properties);
    },
  };
}

function authoredId(context: EntityCompileContext): string {
  if (!context.authoredId)
    throw new Error(
      `${context.sourceName}:${context.line}: ${context.classname} requires authoredId`,
    );
  return context.authoredId;
}

function origin(context: EntityCompileContext): Vec3 {
  if (!context.origin)
    throw new Error(
      `${context.sourceName}:${context.line}: ${context.classname} requires origin`,
    );
  return context.origin;
}

const persistent = { persistent: true } as const;
const transient = { persistent: false } as const;

export const entityDefinitions = {
  worldspawn: defineEntity({
    editor: {
      kind: "solid",
      description: "Static world geometry and environment settings",
      color: [92, 112, 101],
      ...transient,
    },
    properties: {
      mapversion: boundedNumberProperty("Valve map format version", {
        default: 220,
      }),
      message: stringProperty("World display name", {
        default: "Gurgur World",
      }),
      gravity: boundedNumberProperty(
        "Downward gravity in metres per second squared",
        {
          default: 10,
          min: 0,
        },
      ),
      skyColor: colorProperty("Linear RGB sky color", {
        default: "0.08 0.11 0.09",
      }),
    },
    compile(_context, properties) {
      return {
        kind: "world-settings",
        settings: {
          title: properties.message,
          gravity: { x: 0, y: -properties.gravity, z: 0 },
          skyColor: properties.skyColor,
        },
      };
    },
  }),
  info_player_start: defineEntity({
    editor: {
      kind: "point",
      description: "Player spawn transform",
      color: [80, 180, 255],
      size: [-16, -16, 0, 16, 16, 72],
      ...transient,
    },
    properties: {
      name: stringProperty("Spawn identifier", { default: "default" }),
      angle: yawAngleProperty("Yaw in map-space degrees", { default: 0 }),
    },
    compile(context, properties) {
      return {
        kind: "player-spawn",
        spawn: {
          name: properties.name,
          position: origin(context),
          yaw: properties.angle,
        },
      };
    },
  }),
  func_physics: defineEntity({
    editor: {
      kind: "solid",
      description: "Dynamic convex physics body",
      color: [235, 174, 73],
      ...persistent,
    },
    properties: {
      targetname: targetNameProperty(
        "Optional name for constraint attachment",
        {
          optional: true,
        },
      ),
      grabbable: booleanProperty("Allow loose centre-of-mass pickup", {
        default: true,
      }),
      manipulable: booleanProperty(
        "Allow a fixed-authority body to be pulled through a host control joint",
        {
          default: true,
        },
      ),
      gravityScale: boundedNumberProperty("Baseline gravity multiplier", {
        default: 1,
        min: 0,
        max: 16,
      }),
      density: boundedNumberProperty("Mass density", {
        default: 1,
        min: 0.001,
      }),
      friction: boundedNumberProperty("Surface friction", {
        default: 0.6,
        min: 0,
      }),
      restitution: boundedNumberProperty("Bounciness", {
        default: 0,
        min: 0,
        max: 1,
      }),
    },
    compile(context, properties) {
      return {
        kind: "game-entity",
        entity: {
          kind: "physics-prop",
          authoredId: authoredId(context),
          ...(properties.targetname
            ? { targetName: properties.targetname }
            : {}),
          body: {
            kind: "dynamic-brush",
            brushIndices: context.brushIndices,
            density: properties.density,
            friction: properties.friction,
            restitution: properties.restitution,
            gravityScale: properties.gravityScale,
          },
          presentation: { kind: "brush", transform: "body" },
          interaction: properties.grabbable
            ? "grab"
            : properties.manipulable
              ? "manipulate"
              : "none",
        },
      };
    },
  }),
  phys_hinge: hingeConstraint(),
  phys_motor: motorConstraint(),
  phys_slideconstraint: slideConstraint(),
  phys_ballsocket: simpleConstraint("spherical", [150, 195, 239]),
  phys_lengthconstraint: distanceConstraint(),
  phys_spring: springConstraint(),
  phys_constraint: simpleConstraint("weld", [173, 173, 230]),
  func_conveyor: conveyor(),
  trigger_gravity: gravityField(),
  func_door: linearMover("door", 96, 2, [105, 190, 155]),
  func_platform: linearMover("platform", 64, 1, [88, 166, 196]),
  trigger_once: trigger("once", 0, [196, 105, 184]),
  trigger_multiple: trigger("multiple", 0.5, [179, 112, 211]),
  logic_relay: defineEntity({
    editor: {
      kind: "point",
      description: "Typed mechanism signal relay",
      color: [234, 116, 116],
      size: [-16, -16, -16, 16, 16, 16],
      ...persistent,
    },
    properties: {
      targetname: targetNameProperty(),
      target: targetProperty(),
      delay: boundedNumberProperty("Seconds before forwarding", {
        default: 0,
        min: 0,
      }),
      once: booleanProperty("Forward only once per epoch", { default: false }),
    },
    compile(context, properties) {
      return {
        kind: "game-entity",
        entity: {
          kind: "relay",
          authoredId: authoredId(context),
          targetName: properties.targetname,
          target: properties.target,
          delaySeconds: properties.delay,
          once: properties.once,
          body: null,
          presentation: { kind: "none" },
          interaction: "none",
        },
      };
    },
  }),
  func_button: defineEntity({
    editor: {
      kind: "solid",
      description: "Use-activated physical signal source",
      color: [232, 112, 79],
      ...persistent,
    },
    properties: {
      target: targetProperty(),
      wait: boundedNumberProperty("Minimum seconds between uses", {
        default: 1,
        min: 0,
      }),
    },
    compile(context, properties) {
      return {
        kind: "game-entity",
        entity: {
          kind: "button",
          authoredId: authoredId(context),
          target: properties.target,
          waitSeconds: properties.wait,
          body: { kind: "kinematic-brush", brushIndices: context.brushIndices },
          presentation: { kind: "brush", transform: "body" },
          interaction: "use",
        },
      };
    },
  }),
  info_world_reset: defineEntity({
    editor: {
      kind: "point",
      description: "Administrative reset marker and safe observer spawn",
      color: [255, 72, 72],
      size: [-24, -24, -24, 24, 24, 24],
      ...transient,
    },
    properties: {
      label: stringProperty("Administrative display label", {
        default: "Reset world",
      }),
    },
    compile(context, properties) {
      return {
        kind: "reset-marker",
        marker: { label: properties.label, position: origin(context) },
      };
    },
  }),
  env_sprite: defineEntity({
    editor: {
      kind: "point",
      description: "Camera-facing decorative sprite",
      color: [119, 218, 172],
      size: [-16, -16, 0, 16, 16, 64],
      ...transient,
    },
    properties: {
      sprite: logicalSpriteAssetProperty("Logical sprite asset ID", {
        default: "fern",
      }),
      scale: mapDistanceProperty("Sprite height in map units", {
        default: 64,
        min: 1,
      }),
      glow: booleanProperty("Render without scene lighting", {
        default: false,
      }),
    },
    compile(context, properties) {
      return {
        kind: "game-entity",
        entity: {
          kind: "sprite",
          origin: origin(context),
          body: null,
          presentation: {
            kind: "sprite",
            asset: properties.sprite,
            height: properties.scale,
            glow: properties.glow,
          },
          interaction: "none",
        },
      };
    },
  }),
  light_ambient: defineEntity({
    editor: {
      kind: "point",
      description: "Scene-wide ambient light and volumetric medium",
      color: [164, 190, 176],
      size: [-12, -12, -12, 12, 12, 12],
      ...transient,
    },
    properties: {
      color: colorProperty("Linear RGB light color", {
        default: "0.45 0.5 0.48",
      }),
      intensity: boundedNumberProperty("Ambient light intensity", {
        default: 0.65,
        min: 0,
        max: 100,
      }),
      volumeDensity: boundedNumberProperty("World volumetric medium density", {
        default: 0.06,
        min: 0,
        max: 3,
      }),
    },
    compile(context, properties) {
      return {
        kind: "game-entity",
        entity: {
          kind: "light",
          origin: origin(context),
          body: null,
          presentation: { kind: "light", mode: "ambient", ...properties },
          interaction: "none",
        },
      };
    },
  }),
  light_directional: defineEntity({
    editor: {
      kind: "point",
      description:
        "Infinite directional scene light centered for shadow coverage",
      color: [255, 224, 154],
      size: [-16, -16, -16, 16, 16, 16],
      ...transient,
    },
    properties: {
      color: colorProperty("Linear RGB light color", {
        default: "1 0.88 0.65",
      }),
      intensity: boundedNumberProperty("Directional light intensity", {
        default: 1,
        min: 0,
        max: 100,
      }),
      direction: mapDirectionProperty(
        "Map-space direction the light travels",
        "0.35 -0.45 -1",
      ),
      castShadow: booleanProperty("Cast a shadow map", { default: true }),
      shadowDistance: mapDistanceProperty(
        "Shadow coverage radius in map units",
        {
          default: 1024,
          min: 1,
        },
      ),
    },
    compile(context, properties) {
      return {
        kind: "game-entity",
        entity: {
          kind: "light",
          origin: origin(context),
          body: null,
          presentation: { kind: "light", mode: "directional", ...properties },
          interaction: "none",
        },
      };
    },
  }),
  light_point: defineEntity({
    editor: {
      kind: "point",
      description: "Finite point light with optional volumetric scattering",
      color: [255, 189, 96],
      size: [-10, -10, -10, 10, 10, 10],
      ...transient,
    },
    properties: {
      color: colorProperty("Linear RGB light color", {
        default: "1 0.72 0.42",
      }),
      intensity: boundedNumberProperty("Point light intensity", {
        default: 60,
        min: 0,
        max: 10_000,
      }),
      range: mapDistanceProperty("Maximum light distance in map units", {
        default: 512,
        min: 1,
      }),
      decay: boundedNumberProperty("Distance decay exponent", {
        default: 2,
        min: 0,
        max: 4,
      }),
      castShadow: booleanProperty("Cast a cube shadow map", { default: true }),
      volumetric: booleanProperty(
        "Scatter through the ambient volumetric medium",
        {
          default: true,
        },
      ),
    },
    compile(context, properties) {
      return {
        kind: "game-entity",
        entity: {
          kind: "light",
          origin: origin(context),
          body: null,
          presentation: { kind: "light", mode: "point", ...properties },
          interaction: "none",
        },
      };
    },
  }),
  light_spot: defineEntity({
    editor: {
      kind: "point",
      description: "Finite cone light with optional volumetric scattering",
      color: [255, 154, 72],
      size: [-12, -12, -12, 12, 12, 12],
      ...transient,
    },
    properties: {
      color: colorProperty("Linear RGB light color", { default: "1 0.62 0.3" }),
      intensity: boundedNumberProperty("Spot light intensity", {
        default: 100,
        min: 0,
        max: 10_000,
      }),
      direction: mapDirectionProperty(
        "Map-space direction the light travels",
        "0 0 -1",
      ),
      range: mapDistanceProperty("Maximum light distance in map units", {
        default: 640,
        min: 1,
      }),
      decay: boundedNumberProperty("Distance decay exponent", {
        default: 2,
        min: 0,
        max: 4,
      }),
      angle: coneAngleProperty("Outer cone angle in degrees", 32),
      penumbra: boundedNumberProperty("Soft cone fraction", {
        default: 0.45,
        min: 0,
        max: 1,
      }),
      castShadow: booleanProperty("Cast a cone shadow map", { default: true }),
      volumetric: booleanProperty(
        "Scatter through the ambient volumetric medium",
        {
          default: true,
        },
      ),
    },
    compile(context, properties) {
      return {
        kind: "game-entity",
        entity: {
          kind: "light",
          origin: origin(context),
          body: null,
          presentation: { kind: "light", mode: "spot", ...properties },
          interaction: "none",
        },
      };
    },
  }),
  ambient_audio: defineEntity({
    editor: {
      kind: "point",
      description: "Per-listener audio controlled by typed trigger outputs",
      color: [104, 205, 245],
      size: [-16, -16, -16, 16, 16, 16],
      ...transient,
    },
    properties: {
      targetname: targetNameProperty(),
      audio: logicalAudioAssetProperty("Logical audio asset ID", {
        default: "dylan",
      }),
      volume: boundedNumberProperty("Playback volume", {
        default: 1,
        min: 0,
        max: 1,
      }),
      fadeIn: boundedNumberProperty("Fade-in duration in seconds", {
        default: 0.75,
        min: 0,
      }),
      fadeOut: boundedNumberProperty("Fade-out duration in seconds", {
        default: 1,
        min: 0,
      }),
      loop: booleanProperty(
        "Loop while the listener remains in a targeting volume",
        {
          default: true,
        },
      ),
      priority: boundedNumberProperty(
        "Winner when different audio volumes overlap",
        {
          default: 0,
          min: -1_000,
          max: 1_000,
        },
      ),
    },
    compile(_context, properties) {
      if (!Number.isSafeInteger(properties.priority))
        throw new Error("ambient_audio.priority must be an integer");
      return {
        kind: "game-entity",
        entity: {
          kind: "ambient-audio",
          asset: properties.audio,
          volume: properties.volume,
          fadeInSeconds: properties.fadeIn,
          fadeOutSeconds: properties.fadeOut,
          loop: properties.loop,
          priority: properties.priority,
          body: null,
          presentation: { kind: "none" },
          interaction: "none",
        },
      };
    },
  }),
} as const;

function hingeConstraint() {
  return defineEntity({
    editor: {
      kind: "point",
      description: "Revolute constraint around authored local Z",
      color: [111, 184, 237],
      size: [-12, -12, -12, 12, 12, 12],
      ...persistent,
    },
    properties: {
      targetname: targetNameProperty("Optional signal target name", {
        optional: true,
      }),
      attach1: targetProperty("Required first body"),
      attach2: targetProperty(
        "Optional second body; omitted attaches to world",
        {
          optional: true,
        },
      ),
      angles: anglesProperty(),
      renderable: booleanProperty("Render an in-world hinge marker", {
        default: true,
      }),
      limitEnabled: booleanProperty(
        "Enable authored-pose-relative angular limits",
        {
          default: false,
        },
      ),
      lowerAngle: degreesProperty("Lower angular limit in degrees", {
        default: -90,
      }),
      upperAngle: degreesProperty("Upper angular limit in degrees", {
        default: 90,
      }),
      motorMode: choiceProperty(
        "Motor behavior",
        [
          { value: "none", label: "None" },
          { value: "friction", label: "Friction brake" },
          { value: "target-angle", label: "Target angle" },
          { value: "target-velocity", label: "Target velocity" },
        ],
        "none",
      ),
      frictionTorque: boundedNumberProperty("Maximum friction torque", {
        default: 0,
        min: 0,
      }),
      targetAngle: degreesProperty("Target angle around the authored pose", {
        default: 0,
      }),
      targetVelocity: degreesProperty(
        "Target angular velocity in degrees per second",
        {
          default: 90,
        },
      ),
      maxTorque: boundedNumberProperty("Maximum motor torque", {
        default: 100,
        min: 0,
      }),
      frequency: boundedNumberProperty("Target-angle spring frequency", {
        default: 4,
        min: 0,
      }),
      damping: boundedNumberProperty("Target-angle damping ratio", {
        default: 0.8,
        min: 0,
      }),
      startOn: booleanProperty("Begin with the configured motor enabled", {
        default: true,
      }),
    },
    compile(context, properties) {
      if (properties.lowerAngle > properties.upperAngle)
        throw new Error(
          `${context.sourceName}:${context.line}: hinge limits are reversed`,
        );
      const motor =
        properties.motorMode === "target-angle"
          ? ({
              mode: "target-angle",
              targetAngle: properties.targetAngle,
              hertz: properties.frequency,
              dampingRatio: properties.damping,
            } as const)
          : properties.motorMode === "target-velocity"
            ? ({
                mode: "target-velocity",
                targetVelocity: properties.targetVelocity,
                maxTorque: properties.maxTorque,
              } as const)
            : properties.motorMode === "friction"
              ? ({
                  mode: "friction",
                  maxTorque: properties.frictionTorque,
                } as const)
              : ({ mode: "none" } as const);
      return connectedJoint(
        context,
        properties.attach1,
        properties.attach2,
        properties.angles,
        {
          authoredId: authoredId(context),
          ...(properties.targetname
            ? { targetName: properties.targetname }
            : {}),
          joint: {
            kind: "revolute",
            limit: properties.limitEnabled
              ? {
                  lowerAngle: properties.lowerAngle,
                  upperAngle: properties.upperAngle,
                }
              : null,
            motor,
          },
          startEnabled: properties.startOn,
        },
        properties.renderable ? "hinge" : null,
      );
    },
  });
}

function motorConstraint() {
  return defineEntity({
    editor: {
      kind: "point",
      description: "World-anchored Source-style velocity hinge",
      color: [88, 168, 235],
      size: [-12, -12, -12, 12, 12, 12],
      ...persistent,
    },
    properties: {
      targetname: targetNameProperty("Optional signal target name", {
        optional: true,
      }),
      attach1: targetProperty("Body driven by the motor"),
      angles: anglesProperty(),
      renderable: booleanProperty("Render an in-world motor marker", {
        default: true,
      }),
      speed: degreesProperty("Angular speed in degrees per second", {
        default: 90,
      }),
      maxTorque: boundedNumberProperty("Maximum motor torque", {
        default: 200,
        min: 0,
      }),
      startOn: booleanProperty("Begin enabled", { default: true }),
    },
    compile(context, properties) {
      return connectedJoint(
        context,
        properties.attach1,
        undefined,
        properties.angles,
        {
          authoredId: authoredId(context),
          ...(properties.targetname
            ? { targetName: properties.targetname }
            : {}),
          joint: {
            kind: "revolute",
            limit: null,
            motor: {
              mode: "target-velocity",
              targetVelocity: properties.speed,
              maxTorque: properties.maxTorque,
            },
          },
          startEnabled: properties.startOn,
        },
        properties.renderable ? "motor" : null,
      );
    },
  });
}

function slideConstraint() {
  return defineEntity({
    editor: {
      kind: "point",
      description: "Prismatic constraint along authored local X",
      color: [115, 217, 191],
      size: [-12, -12, -12, 12, 12, 12],
      ...persistent,
    },
    properties: {
      targetname: targetNameProperty("Optional signal target name", {
        optional: true,
      }),
      attach1: targetProperty("Required first body"),
      attach2: targetProperty(
        "Optional second body; omitted attaches to world",
        {
          optional: true,
        },
      ),
      angles: anglesProperty(),
      renderable: booleanProperty("Render an in-world slider rail", {
        default: true,
      }),
      limitEnabled: booleanProperty(
        "Enable authored-pose-relative travel limits",
        {
          default: false,
        },
      ),
      lowerLimit: mapDistanceProperty("Lower travel limit in map units", {
        default: -64,
      }),
      upperLimit: mapDistanceProperty("Upper travel limit in map units", {
        default: 64,
      }),
      motorMode: choiceProperty(
        "Motor behavior",
        [
          { value: "none", label: "None" },
          { value: "target-position", label: "Target position" },
          { value: "target-velocity", label: "Target velocity" },
        ],
        "none",
      ),
      targetPosition: mapDistanceProperty("Target offset in map units", {
        default: 0,
      }),
      targetVelocity: mapSpeedProperty("Target speed in map units per second", {
        default: 64,
      }),
      maxForce: boundedNumberProperty("Maximum motor force", {
        default: 200,
        min: 0,
      }),
      frequency: boundedNumberProperty("Target-position spring frequency", {
        default: 4,
        min: 0,
      }),
      damping: boundedNumberProperty("Target-position damping ratio", {
        default: 0.8,
        min: 0,
      }),
      startOn: booleanProperty("Begin with the configured motor enabled", {
        default: true,
      }),
    },
    compile(context, properties) {
      if (properties.lowerLimit > properties.upperLimit)
        throw new Error(
          `${context.sourceName}:${context.line}: slider limits are reversed`,
        );
      const motor =
        properties.motorMode === "target-position"
          ? ({
              mode: "target-position",
              targetPosition: properties.targetPosition,
              hertz: properties.frequency,
              dampingRatio: properties.damping,
            } as const)
          : properties.motorMode === "target-velocity"
            ? ({
                mode: "target-velocity",
                targetVelocity: properties.targetVelocity,
                maxForce: properties.maxForce,
              } as const)
            : ({ mode: "none" } as const);
      return connectedJoint(
        context,
        properties.attach1,
        properties.attach2,
        properties.angles,
        {
          authoredId: authoredId(context),
          ...(properties.targetname
            ? { targetName: properties.targetname }
            : {}),
          joint: {
            kind: "prismatic",
            limit: properties.limitEnabled
              ? {
                  lowerTranslation: properties.lowerLimit,
                  upperTranslation: properties.upperLimit,
                }
              : null,
            motor,
          },
          startEnabled: properties.startOn,
        },
        properties.renderable ? "slider" : null,
      );
    },
  });
}

function simpleConstraint(
  kind: "spherical" | "weld",
  color: readonly [number, number, number],
) {
  return defineEntity({
    editor: {
      kind: "point",
      description:
        kind === "spherical"
          ? "Ball-and-socket constraint"
          : "Rigid weld constraint",
      color,
      size: [-12, -12, -12, 12, 12, 12],
      ...persistent,
    },
    properties: {
      targetname: targetNameProperty("Optional signal target name", {
        optional: true,
      }),
      attach1: targetProperty("Required first body"),
      attach2: targetProperty(
        "Optional second body; omitted attaches to world",
        {
          optional: true,
        },
      ),
      angles: anglesProperty(),
      renderable: booleanProperty("Render this constraint in the world", {
        default: true,
      }),
      startOn: booleanProperty("Create this constraint on reset", {
        default: true,
      }),
    },
    compile(context, properties) {
      return connectedJoint(
        context,
        properties.attach1,
        properties.attach2,
        properties.angles,
        {
          authoredId: authoredId(context),
          ...(properties.targetname
            ? { targetName: properties.targetname }
            : {}),
          joint: { kind },
          startEnabled: properties.startOn,
        },
        properties.renderable
          ? kind === "spherical"
            ? "ball-socket"
            : "weld"
          : null,
      );
    },
  });
}

function distanceConstraint() {
  return defineEntity({
    editor: {
      kind: "point",
      description: "Rope or rigid length constraint along local X",
      color: [214, 196, 110],
      size: [-12, -12, -12, 12, 12, 12],
      ...persistent,
    },
    properties: {
      targetname: targetNameProperty("Optional signal target name", {
        optional: true,
      }),
      attach1: targetProperty("Required first body"),
      attach2: targetProperty(
        "Optional second body; omitted attaches to world",
        {
          optional: true,
        },
      ),
      angles: anglesProperty(),
      renderable: booleanProperty(
        "Render the rope or rod between its anchors",
        {
          default: true,
        },
      ),
      length: mapDistanceProperty("Authored endpoint distance in map units", {
        default: 128,
        min: 0.001,
      }),
      constraintMode: choiceProperty(
        "Length behavior",
        [
          { value: "rope", label: "Rope (maximum length)" },
          { value: "rod", label: "Rigid rod" },
        ],
        "rope",
      ),
      startOn: booleanProperty("Create this constraint on reset", {
        default: true,
      }),
    },
    compile(context, properties) {
      const rotation = properties.angles;
      const anchor = origin(context);
      return {
        ...connectedJoint(
          context,
          properties.attach1,
          properties.attach2,
          rotation,
          {
            authoredId: authoredId(context),
            ...(properties.targetname
              ? { targetName: properties.targetname }
              : {}),
            joint: {
              kind: "distance",
              mode: properties.constraintMode,
              length: properties.length,
              hertz: 0,
              dampingRatio: 0,
              maxForce: 0,
            },
            startEnabled: properties.startOn,
          },
          properties.renderable ? properties.constraintMode : null,
        ),
        secondWorldPosition: addVec(
          anchor,
          rotateVector(rotation, { x: properties.length, y: 0, z: 0 }),
        ),
      };
    },
  });
}

function springConstraint() {
  return defineEntity({
    editor: {
      kind: "point",
      description: "Spring-configured distance constraint along local X",
      color: [237, 147, 193],
      size: [-12, -12, -12, 12, 12, 12],
      ...persistent,
    },
    properties: {
      targetname: targetNameProperty("Optional signal target name", {
        optional: true,
      }),
      attach1: targetProperty("Required first body"),
      attach2: targetProperty(
        "Optional second body; omitted attaches to world",
        {
          optional: true,
        },
      ),
      angles: anglesProperty(),
      renderable: booleanProperty(
        "Render a coiled spring between its anchors",
        {
          default: true,
        },
      ),
      length: mapDistanceProperty("Authored endpoint distance in map units", {
        default: 128,
        min: 0.001,
      }),
      frequency: boundedNumberProperty("Spring frequency", {
        default: 4,
        min: 0,
      }),
      damping: boundedNumberProperty("Spring damping ratio", {
        default: 0.7,
        min: 0,
      }),
      maxForce: boundedNumberProperty("Maximum spring force", {
        default: 1000,
        min: 0,
      }),
      startOn: booleanProperty("Create this constraint on reset", {
        default: true,
      }),
    },
    compile(context, properties) {
      const rotation = properties.angles;
      const anchor = origin(context);
      return {
        ...connectedJoint(
          context,
          properties.attach1,
          properties.attach2,
          rotation,
          {
            authoredId: authoredId(context),
            ...(properties.targetname
              ? { targetName: properties.targetname }
              : {}),
            joint: {
              kind: "distance",
              mode: "spring",
              length: properties.length,
              hertz: properties.frequency,
              dampingRatio: properties.damping,
              maxForce: properties.maxForce,
            },
            startEnabled: properties.startOn,
          },
          properties.renderable ? "spring" : null,
        ),
        secondWorldPosition: addVec(
          anchor,
          rotateVector(rotation, { x: properties.length, y: 0, z: 0 }),
        ),
      };
    },
  });
}

function conveyor() {
  return defineEntity({
    editor: {
      kind: "solid",
      description: "Static compound surface motor",
      color: [235, 151, 75],
      ...persistent,
    },
    properties: {
      targetname: targetNameProperty("Optional signal target name", {
        optional: true,
      }),
      direction: mapDirectionProperty("Map-space travel direction", "1 0 0"),
      speed: mapSpeedProperty("Surface speed in map units per second", {
        default: 128,
      }),
      friction: boundedNumberProperty("Surface friction", {
        default: 0.8,
        min: 0,
      }),
      startOn: booleanProperty("Begin enabled", { default: true }),
    },
    compile(context, properties) {
      return {
        kind: "game-entity",
        entity: {
          kind: "surface-motor",
          authoredId: authoredId(context),
          ...(properties.targetname
            ? { targetName: properties.targetname }
            : {}),
          velocity: scaleVec(properties.direction, properties.speed),
          friction: properties.friction,
          startEnabled: properties.startOn,
          body: { kind: "static-brush", brushIndices: context.brushIndices },
          presentation: { kind: "brush", transform: "body" },
          interaction: "none",
        },
      };
    },
  });
}

function gravityField() {
  return defineEntity({
    editor: {
      kind: "solid",
      description: "Compound gravity-factor trigger volume",
      color: [157, 111, 224],
      ...transient,
    },
    properties: {
      gravityFactor: boundedNumberProperty(
        "Multiplier applied to baseline gravity",
        {
          default: 0.5,
          min: 0,
          max: 16,
        },
      ),
      priority: boundedNumberProperty("Highest overlapping priority wins", {
        default: 0,
        min: -1000,
        max: 1000,
      }),
    },
    compile(context, properties) {
      if (!Number.isSafeInteger(properties.priority))
        throw new Error(
          `${context.sourceName}:${context.line}: gravity priority must be an integer`,
        );
      return {
        kind: "game-entity",
        entity: {
          kind: "gravity-field",
          factor: properties.gravityFactor,
          priority: properties.priority,
          body: { kind: "sensor-brush", brushIndices: context.brushIndices },
          presentation: { kind: "none" },
          interaction: "none",
        },
      };
    },
  });
}

function connectedJoint(
  context: EntityCompileContext,
  attach1: string,
  attach2: string | undefined,
  rotation: Quat,
  entity: Omit<
    PhysicsJointEntity,
    | "kind"
    | "body"
    | "presentation"
    | "interaction"
    | "attachmentAEntityIndex"
    | "attachmentBEntityIndex"
    | "localFrameA"
    | "localFrameB"
  >,
  presentationStyle:
    | Exclude<PhysicsJointEntity["presentation"], { kind: "none" }>["style"]
    | null,
): Extract<CompiledAuthoredEntity, { kind: "connected-physics-joint" }> {
  return {
    kind: "connected-physics-joint",
    entity: {
      kind: "physics-joint",
      ...entity,
      body: null,
      presentation: presentationStyle
        ? { kind: "constraint", style: presentationStyle }
        : { kind: "none" },
      interaction: "none",
    },
    attach1,
    ...(attach2 ? { attach2 } : {}),
    worldFrame: { position: origin(context), rotation },
  };
}

function linearMover(
  mode: "door" | "platform",
  defaultSpeed: number,
  defaultWait: number,
  color: readonly [number, number, number],
) {
  return defineEntity({
    editor: {
      kind: "solid",
      description: `Signal-driven kinematic ${mode === "door" ? "sliding door" : "moving platform"}`,
      color,
      ...persistent,
    },
    properties: {
      targetname: targetNameProperty(),
      moveDirection: mapDirectionProperty(
        "Map-space movement direction",
        "0 0 1",
      ),
      distance: mapDistanceProperty("Travel distance in map units", {
        default: 128,
        min: 0,
      }),
      speed: mapSpeedProperty("Travel speed in map units per second", {
        default: defaultSpeed,
        min: 0.001,
      }),
      wait: boundedNumberProperty("Seconds before returning; -1 stays open", {
        default: defaultWait,
        min: -1,
      }),
      startOpen: booleanProperty("Begin at the travelled endpoint", {
        default: false,
      }),
    },
    compile(context, properties) {
      return {
        kind: "game-entity",
        entity: {
          kind: "linear-mover",
          authoredId: authoredId(context),
          mode,
          targetName: properties.targetname,
          moveDirection: properties.moveDirection,
          distance: properties.distance,
          speed: properties.speed,
          waitSeconds: properties.wait,
          startOpen: properties.startOpen,
          body: { kind: "kinematic-brush", brushIndices: context.brushIndices },
          presentation: { kind: "brush", transform: "body" },
          interaction: "none",
        },
      };
    },
  });
}

function trigger(
  mode: "once" | "multiple",
  defaultWait: number,
  color: readonly [number, number, number],
) {
  return defineEntity({
    editor: {
      kind: "solid",
      description:
        mode === "once"
          ? "Sensor that emits its enter output once per world epoch"
          : "Repeatable sensor output source",
      color,
      ...persistent,
    },
    properties: {
      onEnterTarget: targetProperty(
        "Entity targetname to receive the enter input",
      ),
      onEnterInput: entityInputProperty(
        "Typed input sent when a player enters",
        "trigger",
      ),
      onExitTarget: targetProperty(
        "Entity targetname to receive the exit input",
        {
          optional: true,
        },
      ),
      onExitInput: entityInputProperty(
        "Typed input sent when a player exits",
        "trigger",
      ),
      wait: boundedNumberProperty("Minimum seconds between signals", {
        default: defaultWait,
        min: 0,
      }),
    },
    compile(context, properties) {
      return {
        kind: "connected-trigger",
        entity: {
          kind: "trigger",
          authoredId: authoredId(context),
          mode,
          waitSeconds: properties.wait,
          body: { kind: "sensor-brush", brushIndices: context.brushIndices },
          presentation: { kind: "none" },
          interaction: "none",
        },
        outputs: {
          enter: {
            target: properties.onEnterTarget,
            input: properties.onEnterInput,
          },
          ...(properties.onExitTarget
            ? {
                exit: {
                  target: properties.onExitTarget,
                  input: properties.onExitInput,
                },
              }
            : {}),
        },
      };
    },
  });
}

export type EntityClassname = keyof typeof entityDefinitions;
export type PropertyDefinition = EntityProperty<unknown>;

function axisAngle(axis: Vec3, angle: number): Quat {
  const half = angle / 2;
  const sine = Math.sin(half);
  return {
    x: axis.x * sine,
    y: axis.y * sine,
    z: axis.z * sine,
    w: Math.cos(half),
  };
}

function multiplyQuat(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function inverseQuat(value: Quat): Quat {
  return { x: -value.x, y: -value.y, z: -value.z, w: value.w };
}

function normalizeQuat(value: Quat): Quat {
  const length = Math.hypot(value.x, value.y, value.z, value.w);
  return {
    x: value.x / length,
    y: value.y / length,
    z: value.z / length,
    w: value.w / length,
  };
}

function rotateVector(rotation: Quat, value: Vec3): Vec3 {
  const result = multiplyQuat(
    multiplyQuat(rotation, { ...value, w: 0 }),
    inverseQuat(rotation),
  );
  return { x: result.x, y: result.y, z: result.z };
}

function addVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scaleVec(value: Vec3, amount: number): Vec3 {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount };
}
