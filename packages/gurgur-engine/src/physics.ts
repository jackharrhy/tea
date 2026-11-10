import createBox3D, {
  type b3BodyId,
  type b3CompoundData,
  type b3HeightFieldData,
  type b3JointId,
  type b3JointDef,
  type b3MeshData,
  type b3PrismaticJointDef,
  type b3RevoluteJointDef,
  type b3ShapeId,
  type Box3DModule,
  type BodyMoveEvent,
  type ContactHitEvent,
  type ContactTouchEvent,
  type EventsBuffer,
  type PlaneResultBuffer,
  type SensorTouchEvent,
} from "box3d.js";
import type {
  BodyKind,
  BodySnapshot,
  BodyState,
  ConstraintId,
  JointBodies,
  JointFrame,
  PhysicsDebugDraw,
  PhysicsStepEvents,
  PrismaticMotor,
  Quat,
  RevoluteMotor,
  RuntimeId,
  Vec3,
} from "./types";
import { drawPhysicsDebug } from "./physics-debug";

type BodySlot = {
  generation: number;
  body: b3BodyId | null;
  meshes: b3MeshData[];
  compounds: b3CompoundData[];
  heightFields: b3HeightFieldData[];
  shapes: b3ShapeId[];
  surfaceVelocity: Vec3;
};
type ConstraintSlot = {
  generation: number;
  joint: b3JointId | null;
  bodyA: RuntimeId;
  bodyB: RuntimeId | null;
  helperBody: b3BodyId | null;
};
const DEFAULT_CATEGORY = 1n;
const PLAYER_PROXY_CATEGORY = 1n << 1n;
const TRIGGER_CATEGORY = 1n << 2n;

export class PhysicsWorld {
  readonly #box3d: Box3DModule;
  readonly #gravity: Vec3;
  #world: ReturnType<Box3DModule["b3CreateWorld"]>;
  #groundBody: b3BodyId;
  readonly #slots: BodySlot[] = [];
  readonly #freeSlots: number[] = [];
  readonly #pendingDestroy = new Set<number>();
  readonly #constraintSlots: ConstraintSlot[] = [];
  readonly #freeConstraintSlots: number[] = [];
  readonly #events: EventsBuffer;
  readonly #sensorEvent: SensorTouchEvent;
  readonly #contactTouchEvent: ContactTouchEvent;
  readonly #contactHitEvent: ContactHitEvent;
  readonly #bodyMoveEvent: BodyMoveEvent;
  readonly #stepEvents: PhysicsStepEvents = {
    sensorBegin: [],
    sensorEnd: [],
    contactBegin: [],
    contactEnd: [],
    contactHit: [],
    moved: [],
  };
  #stepping = false;
  #disposed = false;

  private constructor(box3d: Box3DModule, gravity: Vec3) {
    this.#box3d = box3d;
    this.#gravity = { ...gravity };
    const definition = box3d.b3DefaultWorldDef();
    definition.gravity = this.#gravity;
    this.#world = box3d.b3CreateWorld(definition);
    this.#groundBody = box3d.b3CreateBody(
      this.#world,
      box3d.b3DefaultBodyDef(),
    );
    this.#events = box3d.createEventsBuffer();
    this.#sensorEvent = box3d.createSensorTouchEvent();
    this.#contactTouchEvent = box3d.createContactTouchEvent();
    this.#contactHitEvent = box3d.createContactHitEvent();
    this.#bodyMoveEvent = box3d.createBodyMoveEvent();
  }

  static async create(
    options: {
      locateFile?(path: string): string;
      gravity?: Vec3;
    } = {},
  ): Promise<PhysicsWorld> {
    return new PhysicsWorld(
      await createBox3D(
        options.locateFile ? { locateFile: options.locateFile } : undefined,
      ),
      options.gravity ?? { x: 0, y: -10, z: 0 },
    );
  }

  createBox(options: {
    type: BodyKind;
    position: Vec3;
    halfExtents: Vec3;
    rotation?: Quat;
    density?: number;
  }): RuntimeId {
    this.#assertLive();
    const definition = this.#box3d.b3DefaultBodyDef();
    definition.type = this.#bodyType(options.type);
    definition.position = options.position;
    if (options.rotation) {
      definition.rotation = {
        v: {
          x: options.rotation.x,
          y: options.rotation.y,
          z: options.rotation.z,
        },
        s: options.rotation.w,
      };
    }

    const body = this.#box3d.b3CreateBody(this.#world, definition);
    const shape = this.#box3d.b3DefaultShapeDef();
    shape.density = options.density ?? shape.density;
    shape.enableContactEvents = options.type === "dynamic";
    shape.enableHitEvents = options.type === "dynamic";
    const shapeId = this.#box3d.b3CreateBoxShape(
      body,
      shape,
      options.halfExtents.x,
      options.halfExtents.y,
      options.halfExtents.z,
    );

    return this.#track(body, { shapes: [shapeId] });
  }

  createHull(options: {
    type: BodyKind;
    position: Vec3;
    vertices: Vec3[];
    rotation?: Quat;
    density?: number;
    friction?: number;
    restitution?: number;
  }): RuntimeId {
    this.#assertLive();
    if (options.vertices.length < 4)
      throw new Error("a convex hull requires at least four vertices");
    const definition = this.#box3d.b3DefaultBodyDef();
    definition.type = this.#bodyType(options.type);
    definition.position = options.position;
    if (options.rotation) {
      definition.rotation = {
        v: {
          x: options.rotation.x,
          y: options.rotation.y,
          z: options.rotation.z,
        },
        s: options.rotation.w,
      };
    }
    const body = this.#box3d.b3CreateBody(this.#world, definition);
    const hull = this.#box3d.b3CreateHull(
      options.vertices.flatMap((vertex) => [vertex.x, vertex.y, vertex.z]),
    );
    if (!hull) {
      this.#box3d.b3DestroyBody(body);
      throw new Error("Box3D rejected the convex hull");
    }
    try {
      const shape = this.#box3d.b3DefaultShapeDef();
      shape.density = options.density ?? shape.density;
      shape.baseMaterial.friction =
        options.friction ?? shape.baseMaterial.friction;
      shape.baseMaterial.restitution =
        options.restitution ?? shape.baseMaterial.restitution;
      shape.enableContactEvents = options.type === "dynamic";
      shape.enableHitEvents = options.type === "dynamic";
      const shapeId = this.#box3d.b3CreateHullShape(body, shape, hull);
      return this.#track(body, { shapes: [shapeId] });
    } finally {
      this.#box3d.b3DestroyHull(hull);
    }
  }

  createCompoundHulls(options: {
    type: BodyKind;
    position: Vec3;
    rotation?: Quat;
    hulls: Array<{ vertices: Vec3[] }>;
    density?: number;
    friction?: number;
    restitution?: number;
  }): RuntimeId {
    this.#assertLive();
    if (
      options.hulls.length === 0 ||
      options.hulls.some((hull) => hull.vertices.length < 4)
    ) {
      throw new Error("compound hull bodies require one or more convex hulls");
    }
    const definition = this.#box3d.b3DefaultBodyDef();
    definition.type = this.#bodyType(options.type);
    definition.position = options.position;
    if (options.rotation)
      definition.rotation = {
        v: {
          x: options.rotation.x,
          y: options.rotation.y,
          z: options.rotation.z,
        },
        s: options.rotation.w,
      };
    const body = this.#box3d.b3CreateBody(this.#world, definition);
    const shapes: b3ShapeId[] = [];
    try {
      for (const source of options.hulls) {
        const hull = this.#box3d.b3CreateHull(
          source.vertices.flatMap((vertex) => [vertex.x, vertex.y, vertex.z]),
        );
        if (!hull) throw new Error("Box3D rejected a compound convex hull");
        try {
          const shape = this.#box3d.b3DefaultShapeDef();
          shape.density = options.density ?? shape.density;
          shape.baseMaterial.friction =
            options.friction ?? shape.baseMaterial.friction;
          shape.baseMaterial.restitution =
            options.restitution ?? shape.baseMaterial.restitution;
          shape.enableContactEvents = options.type === "dynamic";
          shape.enableHitEvents = options.type === "dynamic";
          shapes.push(this.#box3d.b3CreateHullShape(body, shape, hull));
        } finally {
          this.#box3d.b3DestroyHull(hull);
        }
      }
    } catch (error) {
      this.#box3d.b3DestroyBody(body);
      throw error;
    }
    return this.#track(body, { shapes });
  }

  createPlayerProxy(
    position: Vec3,
    capsule: { radius: number; halfSegment: number },
  ): RuntimeId {
    this.#assertLive();
    const definition = this.#box3d.b3DefaultBodyDef();
    definition.type = this.#bodyType("kinematic");
    definition.position = position;
    const body = this.#box3d.b3CreateBody(this.#world, definition);
    const shape = this.#box3d.b3DefaultShapeDef();
    shape.isSensor = false;
    shape.enableSensorEvents = true;
    shape.filter.categoryBits = PLAYER_PROXY_CATEGORY;
    shape.filter.maskBits = TRIGGER_CATEGORY;
    const shapeId = this.#box3d.b3CreateCapsuleShape(body, shape, {
      center1: { x: 0, y: -capsule.halfSegment, z: 0 },
      center2: { x: 0, y: capsule.halfSegment, z: 0 },
      radius: capsule.radius,
    });
    return this.#track(body, { shapes: [shapeId] });
  }

  createSensorHull(options: {
    position: Vec3;
    vertices: Vec3[];
    rotation?: Quat;
  }): RuntimeId {
    return this.createSensorHulls({
      position: options.position,
      rotation: options.rotation,
      hulls: [{ vertices: options.vertices }],
    });
  }

  createSensorHulls(options: {
    position: Vec3;
    hulls: Array<{ vertices: Vec3[] }>;
    rotation?: Quat;
  }): RuntimeId {
    this.#assertLive();
    if (
      options.hulls.length === 0 ||
      options.hulls.some((hull) => hull.vertices.length < 4)
    )
      throw new Error("sensor hull bodies require one or more convex hulls");
    const definition = this.#box3d.b3DefaultBodyDef();
    definition.type = this.#bodyType("static");
    definition.position = options.position;
    if (options.rotation)
      definition.rotation = {
        v: {
          x: options.rotation.x,
          y: options.rotation.y,
          z: options.rotation.z,
        },
        s: options.rotation.w,
      };
    const body = this.#box3d.b3CreateBody(this.#world, definition);
    const shapes: b3ShapeId[] = [];
    try {
      for (const source of options.hulls) {
        const hull = this.#box3d.b3CreateHull(
          source.vertices.flatMap((vertex) => [vertex.x, vertex.y, vertex.z]),
        );
        if (!hull) throw new Error("Box3D rejected a sensor hull");
        try {
          const shape = this.#box3d.b3DefaultShapeDef();
          shape.isSensor = true;
          shape.enableSensorEvents = true;
          shape.filter.categoryBits = TRIGGER_CATEGORY;
          shape.filter.maskBits = PLAYER_PROXY_CATEGORY | DEFAULT_CATEGORY;
          shapes.push(this.#box3d.b3CreateHullShape(body, shape, hull));
        } finally {
          this.#box3d.b3DestroyHull(hull);
        }
      }
    } catch (error) {
      this.#box3d.b3DestroyBody(body);
      throw error;
    }
    return this.#track(body, { shapes });
  }

  createStaticMesh(options: {
    vertices: Vec3[];
    triangles: Array<[number, number, number]>;
  }): RuntimeId {
    this.#assertLive();
    if (options.vertices.length < 3 || options.triangles.length < 1)
      throw new Error("a static mesh requires vertices and triangles");
    for (const triangle of options.triangles) {
      if (
        triangle.some(
          (index) =>
            !Number.isInteger(index) ||
            index < 0 ||
            index >= options.vertices.length,
        )
      ) {
        throw new Error("static mesh triangle index is out of bounds");
      }
    }
    const definition = this.#box3d.b3DefaultBodyDef();
    definition.type = this.#bodyType("static");
    const body = this.#box3d.b3CreateBody(this.#world, definition);
    const mesh = this.#box3d.b3CreateMesh(
      options.vertices.flatMap((vertex) => [vertex.x, vertex.y, vertex.z]),
      options.triangles.flat(),
    );
    if (!mesh) {
      this.#box3d.b3DestroyBody(body);
      throw new Error("Box3D rejected the static indexed mesh");
    }
    try {
      const shapeId = this.#box3d.b3CreateMeshShape(
        body,
        this.#box3d.b3DefaultShapeDef(),
        mesh,
        {
          x: 1,
          y: 1,
          z: 1,
        },
      );
      return this.#track(body, { meshes: [mesh], shapes: [shapeId] });
    } catch (error) {
      this.#box3d.b3DestroyBody(body);
      this.#box3d.b3DestroyMesh(mesh);
      throw error;
    }
  }

  createStaticCompound(options: {
    boxes: Array<{ position: Vec3; halfExtents: Vec3; rotation?: Quat }>;
  }): RuntimeId {
    this.#assertLive();
    if (options.boxes.length === 0)
      throw new Error("a static compound requires at least one child");
    for (const box of options.boxes) {
      if (
        ![box.halfExtents.x, box.halfExtents.y, box.halfExtents.z].every(
          (value) => Number.isFinite(value) && value > 0,
        )
      ) {
        throw new Error(
          "static compound half extents must be finite and positive",
        );
      }
    }
    const body = this.#box3d.b3CreateBody(
      this.#world,
      this.#box3d.b3DefaultBodyDef(),
    );
    const childHulls = options.boxes.map((box) =>
      this.#box3d.b3CreateHull(
        [-1, 1].flatMap((x) =>
          [-1, 1].flatMap((y) =>
            [-1, 1].flatMap((z) => [
              x * box.halfExtents.x,
              y * box.halfExtents.y,
              z * box.halfExtents.z,
            ]),
          ),
        ),
      ),
    );
    if (childHulls.some((hull) => !hull)) {
      for (const hull of childHulls) if (hull) this.#box3d.b3DestroyHull(hull);
      this.#box3d.b3DestroyBody(body);
      throw new Error("Box3D rejected a static compound child hull");
    }
    const compound = this.#box3d.b3CreateCompound({
      hulls: options.boxes.map((box, index) => ({
        hull: childHulls[index],
        transform: {
          p: box.position,
          q: box.rotation
            ? {
                v: { x: box.rotation.x, y: box.rotation.y, z: box.rotation.z },
                s: box.rotation.w,
              }
            : { v: { x: 0, y: 0, z: 0 }, s: 1 },
        },
      })),
    });
    for (const hull of childHulls) if (hull) this.#box3d.b3DestroyHull(hull);
    if (!compound) {
      this.#box3d.b3DestroyBody(body);
      throw new Error("Box3D rejected the static compound");
    }
    try {
      const shapeId = this.#box3d.b3CreateCompoundShape(
        body,
        this.#box3d.b3DefaultShapeDef(),
        compound,
      );
      return this.#track(body, { compounds: [compound], shapes: [shapeId] });
    } catch (error) {
      this.#box3d.b3DestroyBody(body);
      this.#box3d.b3DestroyCompound(compound);
      throw error;
    }
  }

  createStaticHeightField(options: {
    heights: number[];
    countX: number;
    countZ: number;
    scale: Vec3;
  }): RuntimeId {
    this.#assertLive();
    if (
      !Number.isInteger(options.countX) ||
      !Number.isInteger(options.countZ) ||
      options.countX < 2 ||
      options.countZ < 2
    ) {
      throw new Error(
        "height field dimensions must be integers of at least two",
      );
    }
    if (
      options.heights.length !== options.countX * options.countZ ||
      options.heights.some((value) => !Number.isFinite(value))
    ) {
      throw new Error("height field requires one finite sample per grid point");
    }
    const body = this.#box3d.b3CreateBody(
      this.#world,
      this.#box3d.b3DefaultBodyDef(),
    );
    const heightField = this.#box3d.b3CreateHeightField(
      new Float32Array(options.heights),
      options.countX,
      options.countZ,
      options.scale,
    );
    if (!heightField) {
      this.#box3d.b3DestroyBody(body);
      throw new Error("Box3D rejected the static height field");
    }
    try {
      const shapeId = this.#box3d.b3CreateHeightFieldShape(
        body,
        this.#box3d.b3DefaultShapeDef(),
        heightField,
      );
      return this.#track(body, {
        heightFields: [heightField],
        shapes: [shapeId],
      });
    } catch (error) {
      this.#box3d.b3DestroyBody(body);
      this.#box3d.b3DestroyHeightField(heightField);
      throw error;
    }
  }

  restoreBox(options: {
    position: Vec3;
    rotation: Quat;
    linearVelocity: Vec3;
    angularVelocity: Vec3;
    halfExtents: Vec3;
  }): RuntimeId {
    const id = this.createBox({
      type: "dynamic",
      position: options.position,
      rotation: options.rotation,
      halfExtents: options.halfExtents,
    });
    const body = this.#resolve(id);
    this.#box3d.b3Body_SetLinearVelocity(body, options.linearVelocity);
    this.#box3d.b3Body_SetAngularVelocity(body, options.angularVelocity);
    return id;
  }

  restoreHull(options: {
    type: BodyKind;
    position: Vec3;
    rotation: Quat;
    linearVelocity: Vec3;
    angularVelocity: Vec3;
    vertices: Vec3[];
    density?: number;
    friction?: number;
    restitution?: number;
    awake?: boolean;
  }): RuntimeId {
    const id = this.createHull(options);
    const body = this.#resolve(id);
    this.#box3d.b3Body_SetLinearVelocity(body, options.linearVelocity);
    this.#box3d.b3Body_SetAngularVelocity(body, options.angularVelocity);
    if (options.awake !== undefined)
      this.#box3d.b3Body_SetAwake(body, options.awake);
    return id;
  }

  recreate(): void {
    this.#assertLive();
    if (this.#stepping)
      throw new Error("cannot recreate physics world during a step");
    this.#box3d.b3DestroyWorld(this.#world);
    for (const slot of this.#slots) {
      this.#destroyBackingResources(slot);
      if (!slot) continue;
      slot.body = null;
      slot.meshes = [];
      slot.compounds = [];
      slot.heightFields = [];
      slot.shapes = [];
      slot.surfaceVelocity = { x: 0, y: 0, z: 0 };
      slot.generation += 1;
    }
    for (const slot of this.#constraintSlots) {
      if (!slot) continue;
      slot.joint = null;
      slot.helperBody = null;
      slot.generation += 1;
    }
    this.#freeConstraintSlots.length = 0;
    for (let index = this.#constraintSlots.length - 1; index >= 0; index -= 1)
      this.#freeConstraintSlots.push(index);
    this.#freeSlots.length = 0;
    for (let index = this.#slots.length - 1; index >= 0; index -= 1)
      this.#freeSlots.push(index);
    this.#pendingDestroy.clear();
    const definition = this.#box3d.b3DefaultWorldDef();
    definition.gravity = this.#gravity;
    this.#world = this.#box3d.b3CreateWorld(definition);
    this.#groundBody = this.#box3d.b3CreateBody(
      this.#world,
      this.#box3d.b3DefaultBodyDef(),
    );
  }

  destroy(id: RuntimeId): boolean {
    const slot = this.#slots[id.index];
    if (!slot || slot.generation !== id.generation || slot.body === null)
      return false;
    if (this.#stepping) {
      this.#pendingDestroy.add(id.index);
      return true;
    }
    this.#destroySlot(id.index);
    return true;
  }

  setBodyTransform(id: RuntimeId, position: Vec3, rotation: Quat): void {
    const body = this.#resolve(id);
    this.#box3d.b3Body_SetTransform(body, position, {
      v: { x: rotation.x, y: rotation.y, z: rotation.z },
      s: rotation.w,
    });
  }

  setKinematicTarget(id: RuntimeId, position: Vec3, seconds: number): void {
    this.setKinematicTargetTransform(
      id,
      position,
      this.state(id).rotation,
      seconds,
    );
  }

  setKinematicTargetTransform(
    id: RuntimeId,
    position: Vec3,
    rotation: Quat,
    seconds: number,
  ): void {
    if (!Number.isFinite(seconds) || seconds <= 0)
      throw new Error("kinematic target duration must be positive");
    this.#box3d.b3Body_SetTargetTransform(
      this.#resolve(id),
      {
        p: position,
        q: {
          v: { x: rotation.x, y: rotation.y, z: rotation.z },
          s: rotation.w,
        },
      },
      seconds,
      true,
    );
  }

  setBodyVelocity(
    id: RuntimeId,
    linearVelocity: Vec3,
    angularVelocity: Vec3,
  ): void {
    const body = this.#resolve(id);
    this.#box3d.b3Body_SetLinearVelocity(body, linearVelocity);
    this.#box3d.b3Body_SetAngularVelocity(body, angularVelocity);
  }

  setBodyType(id: RuntimeId, type: BodyKind): void {
    this.#box3d.b3Body_SetType(this.#resolve(id), this.#bodyType(type));
  }

  setBodyAwake(id: RuntimeId, awake: boolean): void {
    this.#box3d.b3Body_SetAwake(this.#resolve(id), awake);
  }

  setBodyEnabled(id: RuntimeId, enabled: boolean): void {
    const body = this.#resolve(id);
    if (enabled) this.#box3d.b3Body_Enable(body);
    else this.#box3d.b3Body_Disable(body);
  }

  setGravityScale(id: RuntimeId, gravityScale: number): void {
    if (!Number.isFinite(gravityScale) || gravityScale < 0)
      throw new Error("gravity scale must be finite and non-negative");
    this.#box3d.b3Body_SetGravityScale(this.#resolve(id), gravityScale);
  }

  setSurfaceVelocity(id: RuntimeId, velocity: Vec3): void {
    if (!Object.values(velocity).every(Number.isFinite))
      throw new Error("surface velocity must be finite");
    const slot = this.#slot(id);
    for (const shape of slot.shapes) {
      const material = this.#box3d.b3Shape_GetSurfaceMaterial(shape);
      material.tangentVelocity = { ...velocity };
      this.#box3d.b3Shape_SetSurfaceMaterial(shape, material);
    }
    slot.surfaceVelocity = { ...velocity };
    if (slot.body) this.#box3d.b3Body_SetAwake(slot.body, true);
  }

  pointVelocity(id: RuntimeId, point: Vec3): Vec3 {
    const body = this.#resolve(id);
    const surface = this.#slot(id).surfaceVelocity;
    const linear = this.#box3d.b3Body_GetLinearVelocity(body);
    const angular = this.#box3d.b3Body_GetAngularVelocity(body);
    const center = this.#box3d.b3Body_GetPosition(body);
    const offset = subtract(point, center);
    return {
      x: linear.x + angular.y * offset.z - angular.z * offset.y + surface.x,
      y: linear.y + angular.z * offset.x - angular.x * offset.z + surface.y,
      z: linear.z + angular.x * offset.y - angular.y * offset.x + surface.z,
    };
  }

  applyLinearImpulse(id: RuntimeId, impulse: Vec3): boolean {
    const body = this.#resolve(id);
    if (
      this.#box3d.b3Body_GetType(body) !== this.#box3d.b3BodyType.b3_dynamicBody
    )
      return false;
    this.#box3d.b3Body_ApplyLinearImpulseToCenter(body, impulse, true);
    return true;
  }

  driveBodyToTarget(
    id: RuntimeId,
    options: {
      targetPosition: Vec3;
      targetRotation: Quat;
      linearGain: number;
      maxLinearSpeed: number;
      maxLinearAcceleration: number;
      angularGain: number;
      maxAngularSpeed: number;
      maxAngularAcceleration: number;
      seconds: number;
    },
  ): boolean {
    const body = this.#resolve(id);
    if (
      this.#box3d.b3Body_GetType(body) !== this.#box3d.b3BodyType.b3_dynamicBody
    )
      return false;
    const limits = [
      options.maxLinearSpeed,
      options.maxLinearAcceleration,
      options.linearGain,
      options.maxAngularSpeed,
      options.maxAngularAcceleration,
      options.angularGain,
      options.seconds,
    ];
    if (limits.some((value) => !Number.isFinite(value) || value <= 0))
      throw new Error("body target drive limits must be finite and positive");
    if (
      !Object.values(options.targetPosition).every(Number.isFinite) ||
      !Object.values(options.targetRotation).every(Number.isFinite)
    )
      throw new Error("body target drive pose must be finite");
    const targetRotationLength = Math.hypot(
      options.targetRotation.x,
      options.targetRotation.y,
      options.targetRotation.z,
      options.targetRotation.w,
    );
    if (targetRotationLength <= Number.EPSILON)
      throw new Error("body target drive rotation must be nonzero");
    const targetRotation = {
      x: options.targetRotation.x / targetRotationLength,
      y: options.targetRotation.y / targetRotationLength,
      z: options.targetRotation.z / targetRotationLength,
      w: options.targetRotation.w / targetRotationLength,
    };

    const positionError = subtract(
      options.targetPosition,
      this.#box3d.b3Body_GetPosition(body),
    );
    const desiredLinear = limitVector(
      multiply(positionError, options.linearGain),
      options.maxLinearSpeed,
    );
    const linearVelocity = this.#box3d.b3Body_GetLinearVelocity(body);
    const linearDelta = limitVector(
      subtract(desiredLinear, linearVelocity),
      options.maxLinearAcceleration * options.seconds,
    );
    const mass = this.#box3d.b3Body_GetMass(body);
    this.#box3d.b3Body_ApplyLinearImpulseToCenter(
      body,
      multiply(linearDelta, mass),
      true,
    );

    const currentRotation = this.#rotation(body);
    const rotationError = shortestRotation(targetRotation, currentRotation);
    const desiredAngular = limitVector(
      multiply(rotationError.axis, rotationError.angle * options.angularGain),
      options.maxAngularSpeed,
    );
    const angularVelocity = this.#box3d.b3Body_GetAngularVelocity(body);
    const nextAngular = add(
      angularVelocity,
      limitVector(
        subtract(desiredAngular, angularVelocity),
        options.maxAngularAcceleration * options.seconds,
      ),
    );
    this.#box3d.b3Body_SetAngularVelocity(body, nextAngular);
    this.#box3d.b3Body_SetAwake(body, true);
    return true;
  }

  createControlConstraint(options: {
    body: RuntimeId;
    localAnchor: Vec3;
    targetPosition: Vec3;
    targetRotation: Quat;
    linearHertz?: number;
    linearDampingRatio?: number;
    angularHertz?: number;
    angularDampingRatio?: number;
    maxForce?: number;
    maxTorque?: number;
  }): ConstraintId {
    const body = this.#resolve(options.body);
    if (
      this.#box3d.b3Body_GetType(body) !== this.#box3d.b3BodyType.b3_dynamicBody
    )
      throw new Error("control constraint requires a dynamic body");
    const mass = this.#box3d.b3Body_GetMass(body);
    const tuning = {
      linearHertz: options.linearHertz ?? 32,
      linearDampingRatio: options.linearDampingRatio ?? 4,
      angularHertz: options.angularHertz ?? 64,
      angularDampingRatio: options.angularDampingRatio ?? 4,
      maxForce: options.maxForce ?? mass * 100,
      maxTorque: options.maxTorque ?? mass * 300,
    };
    if (
      [
        ...Object.values(options.localAnchor),
        ...Object.values(options.targetPosition),
        ...Object.values(options.targetRotation),
        ...Object.values(tuning),
      ].some((value) => !Number.isFinite(value))
    )
      throw new Error("control constraint fields must be finite");
    if (Object.values(tuning).some((value) => value < 0))
      throw new Error("control constraint tuning must be non-negative");

    const targetDefinition = this.#box3d.b3DefaultBodyDef();
    targetDefinition.type = this.#box3d.b3BodyType.b3_kinematicBody;
    targetDefinition.position = { ...options.targetPosition };
    targetDefinition.rotation = boxRotation(options.targetRotation);
    const helperBody = this.#box3d.b3CreateBody(this.#world, targetDefinition);
    const definition = this.#box3d.b3DefaultMotorJointDef();
    definition.base.bodyIdA = helperBody;
    definition.base.bodyIdB = body;
    definition.base.localFrameA = jointTransform({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
    definition.base.localFrameB = jointTransform({
      position: options.localAnchor,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
    definition.base.collideConnected = false;
    definition.linearHertz = tuning.linearHertz;
    definition.linearDampingRatio = tuning.linearDampingRatio;
    definition.angularHertz = tuning.angularHertz;
    definition.angularDampingRatio = tuning.angularDampingRatio;
    definition.maxSpringForce = tuning.maxForce;
    definition.maxSpringTorque = tuning.maxTorque;
    const joint = this.#box3d.b3CreateMotorJoint(this.#world, definition);
    this.#box3d.b3Body_SetAwake(body, true);
    return this.#trackConstraint(joint, options.body, undefined, helperBody);
  }

  setControlTarget(id: ConstraintId, position: Vec3, rotation: Quat): void {
    const slot = this.#constraintSlots[id.index];
    if (
      !slot ||
      slot.generation !== id.generation ||
      slot.joint === null ||
      slot.helperBody === null
    )
      throw new Error(`stale constraint handle ${id.index}:${id.generation}`);
    if (
      !Object.values(position).every(Number.isFinite) ||
      !Object.values(rotation).every(Number.isFinite)
    )
      throw new Error("control target pose must be finite");
    this.#box3d.b3Body_SetTransform(
      slot.helperBody,
      position,
      boxRotation(rotation),
    );
    this.#box3d.b3Body_SetAwake(this.#resolve(slot.bodyA), true);
  }

  createDistanceConstraint(options: {
    bodyA: RuntimeId;
    bodyB: RuntimeId;
    worldAnchorA: Vec3;
    worldAnchorB: Vec3;
    length: number;
    hertz?: number;
    dampingRatio?: number;
    maxForce?: number;
  }): ConstraintId {
    const bodyA = this.#resolve(options.bodyA);
    const bodyB = this.#resolve(options.bodyB);
    const definition = this.#box3d.b3DefaultDistanceJointDef();
    definition.base.bodyIdA = bodyA;
    definition.base.bodyIdB = bodyB;
    definition.base.localFrameA.p = this.#box3d.b3Body_GetLocalPoint(
      bodyA,
      options.worldAnchorA,
    );
    definition.base.localFrameB.p = this.#box3d.b3Body_GetLocalPoint(
      bodyB,
      options.worldAnchorB,
    );
    definition.length = Math.max(0.05, options.length);
    definition.enableSpring = true;
    definition.hertz = options.hertz ?? 8;
    definition.dampingRatio = options.dampingRatio ?? 0.9;
    definition.lowerSpringForce = -(options.maxForce ?? 500);
    definition.upperSpringForce = options.maxForce ?? 500;
    const joint = this.#box3d.b3CreateDistanceJoint(this.#world, definition);
    return this.#trackConstraint(joint, options.bodyA, options.bodyB);
  }

  createRevoluteConstraint(
    options: JointBodies & {
      limit?: { lowerAngle: number; upperAngle: number };
      motor?: RevoluteMotor;
    },
  ): ConstraintId {
    const definition = this.#box3d.b3DefaultRevoluteJointDef();
    this.#configureJointBase(definition.base, options);
    if (options.limit) {
      if (
        !Number.isFinite(options.limit.lowerAngle) ||
        !Number.isFinite(options.limit.upperAngle) ||
        options.limit.lowerAngle > options.limit.upperAngle
      )
        throw new Error("revolute limits must be finite and ordered");
      definition.enableLimit = true;
      definition.lowerAngle = -options.limit.upperAngle;
      definition.upperAngle = -options.limit.lowerAngle;
    }
    this.#applyRevoluteMotorDefinition(
      definition,
      options.motor ?? { mode: "none" },
    );
    const joint = this.#box3d.b3CreateRevoluteJoint(this.#world, definition);
    return this.#trackConstraint(joint, options.bodyA, options.bodyB);
  }

  setRevoluteMotor(id: ConstraintId, motor: RevoluteMotor): void {
    validateRevoluteMotor(motor);
    const joint = this.#resolveConstraint(id);
    this.#box3d.b3RevoluteJoint_EnableSpring(
      joint,
      motor.mode === "target-angle",
    );
    this.#box3d.b3RevoluteJoint_EnableMotor(
      joint,
      motor.mode === "friction" || motor.mode === "target-velocity",
    );
    if (motor.mode === "target-angle") {
      this.#box3d.b3RevoluteJoint_SetTargetAngle(joint, -motor.targetAngle);
      this.#box3d.b3RevoluteJoint_SetSpringHertz(joint, motor.hertz);
      this.#box3d.b3RevoluteJoint_SetSpringDampingRatio(
        joint,
        motor.dampingRatio,
      );
    } else if (motor.mode === "friction") {
      this.#box3d.b3RevoluteJoint_SetMotorSpeed(joint, 0);
      this.#box3d.b3RevoluteJoint_SetMaxMotorTorque(joint, motor.maxTorque);
    } else if (motor.mode === "target-velocity") {
      this.#box3d.b3RevoluteJoint_SetMotorSpeed(joint, -motor.targetVelocity);
      this.#box3d.b3RevoluteJoint_SetMaxMotorTorque(joint, motor.maxTorque);
    }
    this.#box3d.b3Joint_WakeBodies(joint);
  }

  createPrismaticConstraint(
    options: JointBodies & {
      limit?: { lowerTranslation: number; upperTranslation: number };
      motor?: PrismaticMotor;
    },
  ): ConstraintId {
    const definition = this.#box3d.b3DefaultPrismaticJointDef();
    this.#configureJointBase(definition.base, options);
    if (options.limit) {
      if (
        !Number.isFinite(options.limit.lowerTranslation) ||
        !Number.isFinite(options.limit.upperTranslation) ||
        options.limit.lowerTranslation > options.limit.upperTranslation
      )
        throw new Error("prismatic limits must be finite and ordered");
      definition.enableLimit = true;
      definition.lowerTranslation = -options.limit.upperTranslation;
      definition.upperTranslation = -options.limit.lowerTranslation;
    }
    this.#applyPrismaticMotorDefinition(
      definition,
      options.motor ?? { mode: "none" },
    );
    const joint = this.#box3d.b3CreatePrismaticJoint(this.#world, definition);
    return this.#trackConstraint(joint, options.bodyA, options.bodyB);
  }

  setPrismaticMotor(id: ConstraintId, motor: PrismaticMotor): void {
    validatePrismaticMotor(motor);
    const joint = this.#resolveConstraint(id);
    this.#box3d.b3PrismaticJoint_EnableSpring(
      joint,
      motor.mode === "target-position",
    );
    this.#box3d.b3PrismaticJoint_EnableMotor(
      joint,
      motor.mode === "target-velocity",
    );
    if (motor.mode === "target-position") {
      this.#box3d.b3PrismaticJoint_SetTargetTranslation(
        joint,
        -motor.targetPosition,
      );
      this.#box3d.b3PrismaticJoint_SetSpringHertz(joint, motor.hertz);
      this.#box3d.b3PrismaticJoint_SetSpringDampingRatio(
        joint,
        motor.dampingRatio,
      );
    } else if (motor.mode === "target-velocity") {
      this.#box3d.b3PrismaticJoint_SetMotorSpeed(joint, -motor.targetVelocity);
      this.#box3d.b3PrismaticJoint_SetMaxMotorForce(joint, motor.maxForce);
    }
    this.#box3d.b3Joint_WakeBodies(joint);
  }

  createSphericalConstraint(options: JointBodies): ConstraintId {
    const definition = this.#box3d.b3DefaultSphericalJointDef();
    this.#configureJointBase(definition.base, options);
    const joint = this.#box3d.b3CreateSphericalJoint(this.#world, definition);
    return this.#trackConstraint(joint, options.bodyA, options.bodyB);
  }

  createWeldConstraint(
    options: JointBodies & {
      linearHertz?: number;
      angularHertz?: number;
      dampingRatio?: number;
    },
  ): ConstraintId {
    const definition = this.#box3d.b3DefaultWeldJointDef();
    this.#configureJointBase(definition.base, options);
    if (
      [options.linearHertz, options.angularHertz, options.dampingRatio].some(
        (value) =>
          value !== undefined && (!Number.isFinite(value) || value < 0),
      )
    )
      throw new Error("weld tuning must be finite and non-negative");
    if (options.linearHertz !== undefined)
      definition.linearHertz = options.linearHertz;
    if (options.angularHertz !== undefined)
      definition.angularHertz = options.angularHertz;
    if (options.dampingRatio !== undefined) {
      definition.linearDampingRatio = options.dampingRatio;
      definition.angularDampingRatio = options.dampingRatio;
    }
    const joint = this.#box3d.b3CreateWeldJoint(this.#world, definition);
    return this.#trackConstraint(joint, options.bodyA, options.bodyB);
  }

  createConfigurableDistanceConstraint(
    options: JointBodies & {
      length: number;
      mode: "rope" | "rod" | "spring";
      hertz?: number;
      dampingRatio?: number;
      maxForce?: number;
    },
  ): ConstraintId {
    if (!Number.isFinite(options.length) || options.length <= 0)
      throw new Error("distance joint length must be finite and positive");
    if (
      [options.hertz, options.dampingRatio, options.maxForce].some(
        (value) =>
          value !== undefined && (!Number.isFinite(value) || value < 0),
      )
    )
      throw new Error("distance joint tuning must be finite and non-negative");
    const definition = this.#box3d.b3DefaultDistanceJointDef();
    this.#configureJointBase(definition.base, options);
    definition.length = options.length;
    if (options.mode === "rope") {
      definition.enableLimit = true;
      definition.minLength = 0.01;
      definition.maxLength = options.length;
    } else if (options.mode === "rod") {
      definition.enableLimit = true;
      definition.minLength = options.length;
      definition.maxLength = options.length;
    } else {
      definition.enableSpring = true;
      definition.hertz = options.hertz ?? 4;
      definition.dampingRatio = options.dampingRatio ?? 0.7;
      const maxForce = options.maxForce ?? Number.MAX_VALUE;
      definition.lowerSpringForce = -maxForce;
      definition.upperSpringForce = maxForce;
    }
    const joint = this.#box3d.b3CreateDistanceJoint(this.#world, definition);
    return this.#trackConstraint(joint, options.bodyA, options.bodyB);
  }

  destroyConstraint(id: ConstraintId): boolean {
    const slot = this.#constraintSlots[id.index];
    if (!slot || slot.generation !== id.generation || !slot.joint) return false;
    this.#box3d.b3DestroyJoint(slot.joint, true);
    if (slot.helperBody) this.#box3d.b3DestroyBody(slot.helperBody);
    slot.joint = null;
    slot.helperBody = null;
    slot.generation += 1;
    this.#freeConstraintSlots.push(id.index);
    return true;
  }

  step(seconds: number, substeps: number): PhysicsStepEvents {
    this.#assertLive();
    if (this.#stepping) throw new Error("physics step is not reentrant");
    this.#stepping = true;
    try {
      this.#box3d.b3World_Step(this.#world, seconds, substeps);
      this.#box3d.getEvents(this.#events, this.#world);
      for (const events of Object.values(this.#stepEvents)) events.length = 0;
      this.#readSensorEvents(true, this.#stepEvents.sensorBegin);
      this.#readSensorEvents(false, this.#stepEvents.sensorEnd);
      this.#readContactEvents(true, this.#stepEvents.contactBegin);
      this.#readContactEvents(false, this.#stepEvents.contactEnd);
      this.#readContactHits();
      this.#readBodyMoves();
      return this.#stepEvents;
    } finally {
      this.#stepping = false;
      for (const index of this.#pendingDestroy) this.#destroySlot(index);
      this.#pendingDestroy.clear();
    }
  }

  debugDraw(maxPrimitives = 4_096): PhysicsDebugDraw {
    this.#assertLive();
    if (this.#stepping)
      throw new Error("cannot debug draw during a physics step");
    return drawPhysicsDebug(this.#box3d, this.#world, maxPrimitives);
  }

  moveCapsule(
    start: Vec3,
    desired: Vec3,
    capsuleShape: { radius: number; halfSegment: number },
  ): Vec3 {
    this.#assertLive();
    const capsule = {
      center1: { x: 0, y: -capsuleShape.halfSegment, z: 0 },
      center2: { x: 0, y: capsuleShape.halfSegment, z: 0 },
      radius: capsuleShape.radius,
    };
    const filter = this.#queryFilter();
    const planeResult = this.#box3d.createPlaneResult();
    const target = add(start, desired);
    let origin = { ...start };

    for (let iteration = 0; iteration < 5; iteration += 1) {
      const planes: Array<{
        plane: { normal: Vec3; offset: number };
        pushLimit: number;
        push: number;
        clipVelocity: boolean;
      }> = [];
      this.#box3d.b3World_CollideMover(
        this.#world,
        origin,
        capsule,
        filter,
        (_shape: unknown, buffer: PlaneResultBuffer) => {
          for (
            let index = 0;
            index < this.#box3d.getNumPlaneResults(buffer);
            index += 1
          ) {
            this.#box3d.getPlaneResultAt(planeResult, buffer, index);
            planes.push({
              plane: {
                normal: { ...planeResult.plane.normal },
                offset: planeResult.plane.offset,
              },
              pushLimit: 10,
              push: 0,
              clipVelocity: true,
            });
          }
          return true;
        },
      );

      const solved = this.#box3d.b3SolvePlanes(
        subtract(target, origin),
        planes,
      );
      const fraction = this.#box3d.b3World_CastMover(
        this.#world,
        origin,
        capsule,
        solved.delta,
        filter,
        () => true,
      );
      const delta = multiply(solved.delta, fraction);
      origin = add(origin, delta);
      if (Math.hypot(delta.x, delta.y, delta.z) < 0.01) break;
    }

    return origin;
  }

  castCapsule(
    start: Vec3,
    desired: Vec3,
    capsule: { radius: number; halfSegment: number },
  ): Vec3 {
    this.#assertLive();
    const filter = this.#queryFilter();
    const fraction = this.#box3d.b3World_CastMover(
      this.#world,
      start,
      {
        center1: { x: 0, y: -capsule.halfSegment, z: 0 },
        center2: { x: 0, y: capsule.halfSegment, z: 0 },
        radius: capsule.radius,
      },
      desired,
      filter,
      () => true,
    );
    return add(start, multiply(desired, fraction));
  }

  capsuleFits(
    center: Vec3,
    capsule: { radius: number; halfSegment: number },
  ): boolean {
    this.#assertLive();
    const filter = this.#queryFilter();
    let overlaps = false;
    const plane = this.#box3d.createPlaneResult();
    this.#box3d.b3World_CollideMover(
      this.#world,
      center,
      {
        center1: { x: 0, y: -capsule.halfSegment, z: 0 },
        center2: { x: 0, y: capsule.halfSegment, z: 0 },
        radius: capsule.radius,
      },
      filter,
      (_shape: unknown, buffer: PlaneResultBuffer) => {
        for (
          let index = 0;
          index < this.#box3d.getNumPlaneResults(buffer);
          index += 1
        ) {
          this.#box3d.getPlaneResultAt(plane, buffer, index);
          if (plane.plane.normal.y < 0.5) {
            overlaps = true;
            break;
          }
        }
        return !overlaps;
      },
    );
    return !overlaps;
  }

  raycastClosest(
    origin: Vec3,
    translation: Vec3,
    options: {
      includePlayerProxies?: boolean;
      ignoreBodies?: readonly RuntimeId[];
    } = {},
  ): { point: Vec3; normal: Vec3; fraction: number; body: RuntimeId } | null {
    this.#assertLive();
    const filter = this.#queryFilter(options.includePlayerProxies);
    if (options.ignoreBodies?.length) {
      const ignored = new Set(options.ignoreBodies.map(runtimeKey));
      let closest: {
        point: Vec3;
        normal: Vec3;
        fraction: number;
        body: RuntimeId;
      } | null = null;
      this.#box3d.b3World_CastRay(
        this.#world,
        origin,
        translation,
        filter,
        (shape: b3ShapeId, point: Vec3, normal: Vec3, fraction: number) => {
          const body = this.#runtimeIdForBody(
            this.#box3d.b3Shape_GetBody(shape),
          );
          if (
            ignored.has(runtimeKey(body)) ||
            (closest && fraction >= closest.fraction)
          )
            return true;
          closest = {
            point: { ...point },
            normal: { ...normal },
            fraction,
            body,
          };
          return true;
        },
      );
      return closest;
    }
    const result = this.#box3d.b3World_CastRayClosest(
      this.#world,
      origin,
      translation,
      filter,
    );
    return result.hit
      ? {
          point: { ...result.point },
          normal: { ...result.normal },
          fraction: result.fraction,
          body: this.#runtimeIdForBody(
            this.#box3d.b3Shape_GetBody(result.shapeId),
          ),
        }
      : null;
  }

  snapshot(): BodySnapshot[] {
    this.#assertLive();
    const bodies: BodySnapshot[] = [];
    for (let index = 0; index < this.#slots.length; index += 1) {
      const slot = this.#slots[index];
      if (!slot?.body) continue;
      bodies.push({
        id: { index, generation: slot.generation },
        position: { ...this.#box3d.b3Body_GetPosition(slot.body) },
        rotation: this.#rotation(slot.body),
        linearVelocity: { ...this.#box3d.b3Body_GetLinearVelocity(slot.body) },
        angularVelocity: {
          ...this.#box3d.b3Body_GetAngularVelocity(slot.body),
        },
      });
    }
    return bodies;
  }

  state(id: RuntimeId): BodyState {
    const body = this.#resolve(id);
    return {
      id: { ...id },
      position: { ...this.#box3d.b3Body_GetPosition(body) },
      rotation: this.#rotation(body),
      linearVelocity: { ...this.#box3d.b3Body_GetLinearVelocity(body) },
      angularVelocity: { ...this.#box3d.b3Body_GetAngularVelocity(body) },
      awake: this.#box3d.b3Body_IsAwake(body),
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#box3d.destroyEventsBuffer(this.#events);
    this.#box3d.b3DestroyWorld(this.#world);
    for (const slot of this.#slots) this.#destroyBackingResources(slot);
    this.#disposed = true;
    this.#slots.length = 0;
    this.#freeSlots.length = 0;
    this.#pendingDestroy.clear();
    this.#constraintSlots.length = 0;
    this.#freeConstraintSlots.length = 0;
  }

  #resolve(id: RuntimeId): b3BodyId {
    this.#assertLive();
    const slot = this.#slots[id.index];
    if (!slot || slot.generation !== id.generation || slot.body === null) {
      throw new Error(`stale physics handle ${id.index}:${id.generation}`);
    }
    return slot.body;
  }

  #slot(id: RuntimeId): BodySlot {
    this.#resolve(id);
    return this.#slots[id.index]!;
  }

  #resolveConstraint(id: ConstraintId): b3JointId {
    this.#assertLive();
    const slot = this.#constraintSlots[id.index];
    if (!slot || slot.generation !== id.generation || slot.joint === null)
      throw new Error(`stale constraint handle ${id.index}:${id.generation}`);
    return slot.joint;
  }

  #runtimeIdForBody(body: b3BodyId): RuntimeId {
    const tracked = this.#runtimeIdForEventBody(body);
    if (tracked) return tracked;
    throw new Error("Box3D referenced an untracked body");
  }

  #runtimeIdForEventBody(body: b3BodyId): RuntimeId | null {
    for (let index = 0; index < this.#slots.length; index += 1) {
      const slot = this.#slots[index];
      if (
        slot?.body &&
        slot.body.index1 === body.index1 &&
        slot.body.world0 === body.world0 &&
        slot.body.generation === body.generation
      )
        return { index, generation: slot.generation };
    }
    return null;
  }

  #readSensorEvents(
    begin: boolean,
    events: Array<{ sensor: RuntimeId; visitor: RuntimeId }>,
  ): void {
    const count = begin
      ? this.#box3d.getNumSensorBeginEvents(this.#events)
      : this.#box3d.getNumSensorEndEvents(this.#events);
    for (let index = 0; index < count; index += 1) {
      if (begin)
        this.#box3d.getSensorBeginEventAt(
          this.#sensorEvent,
          this.#events,
          index,
        );
      else
        this.#box3d.getSensorEndEventAt(this.#sensorEvent, this.#events, index);
      const sensor = this.#runtimeIdForEventBody(
        this.#box3d.b3Shape_GetBody(this.#sensorEvent.sensorShapeId),
      );
      const visitor = this.#runtimeIdForEventBody(
        this.#box3d.b3Shape_GetBody(this.#sensorEvent.visitorShapeId),
      );
      if (!sensor || !visitor) continue;
      events.push({
        sensor,
        visitor,
      });
    }
  }

  #readContactEvents(
    begin: boolean,
    events: Array<{ a: RuntimeId; b: RuntimeId }>,
  ): void {
    const count = begin
      ? this.#box3d.getNumContactBeginEvents(this.#events)
      : this.#box3d.getNumContactEndEvents(this.#events);
    for (let index = 0; index < count; index += 1) {
      if (begin)
        this.#box3d.getContactBeginEventAt(
          this.#contactTouchEvent,
          this.#events,
          index,
        );
      else
        this.#box3d.getContactEndEventAt(
          this.#contactTouchEvent,
          this.#events,
          index,
        );
      const a = this.#runtimeIdForEventBody(
        this.#box3d.b3Shape_GetBody(this.#contactTouchEvent.shapeIdA),
      );
      const b = this.#runtimeIdForEventBody(
        this.#box3d.b3Shape_GetBody(this.#contactTouchEvent.shapeIdB),
      );
      if (!a || !b) continue;
      events.push({
        a,
        b,
      });
    }
  }

  #readContactHits(): void {
    for (
      let index = 0;
      index < this.#box3d.getNumContactHitEvents(this.#events);
      index += 1
    ) {
      this.#box3d.getContactHitEventAt(
        this.#contactHitEvent,
        this.#events,
        index,
      );
      const a = this.#runtimeIdForEventBody(
        this.#box3d.b3Shape_GetBody(this.#contactHitEvent.shapeIdA),
      );
      const b = this.#runtimeIdForEventBody(
        this.#box3d.b3Shape_GetBody(this.#contactHitEvent.shapeIdB),
      );
      if (!a || !b) continue;
      this.#stepEvents.contactHit.push({
        a,
        b,
        point: { ...this.#contactHitEvent.point },
        normal: { ...this.#contactHitEvent.normal },
        approachSpeed: this.#contactHitEvent.approachSpeed,
      });
    }
  }

  #readBodyMoves(): void {
    for (
      let index = 0;
      index < this.#box3d.getNumBodyMoveEvents(this.#events);
      index += 1
    ) {
      this.#box3d.getBodyMoveEventAt(this.#bodyMoveEvent, this.#events, index);
      const body = this.#runtimeIdForEventBody(this.#bodyMoveEvent.bodyId);
      if (!body) continue;
      this.#stepEvents.moved.push({
        body,
        position: { ...this.#bodyMoveEvent.position },
        rotation: { ...this.#bodyMoveEvent.rotation },
        fellAsleep: this.#bodyMoveEvent.fellAsleep,
      });
    }
  }

  #rotation(body: b3BodyId): Quat {
    const rotation = this.#box3d.b3Body_GetRotation(body);
    return { x: rotation.v.x, y: rotation.v.y, z: rotation.v.z, w: rotation.s };
  }

  #queryFilter(includePlayerProxies = false) {
    const filter = this.#box3d.b3DefaultQueryFilter();
    filter.maskBits &= ~TRIGGER_CATEGORY;
    if (!includePlayerProxies) filter.maskBits &= ~PLAYER_PROXY_CATEGORY;
    return filter;
  }

  #bodyType(type: BodyKind) {
    if (type === "static") return this.#box3d.b3BodyType.b3_staticBody;
    if (type === "kinematic") return this.#box3d.b3BodyType.b3_kinematicBody;
    return this.#box3d.b3BodyType.b3_dynamicBody;
  }

  #configureJointBase(base: b3JointDef, options: JointBodies): void {
    base.bodyIdA = this.#resolve(options.bodyA);
    base.bodyIdB = options.bodyB
      ? this.#resolve(options.bodyB)
      : this.#groundBody;
    base.localFrameA = jointTransform(options.localFrameA);
    base.localFrameB = jointTransform(options.localFrameB);
    base.collideConnected = options.collideConnected ?? false;
  }

  #applyRevoluteMotorDefinition(
    definition: b3RevoluteJointDef,
    motor: RevoluteMotor,
  ): void {
    validateRevoluteMotor(motor);
    if (motor.mode === "target-angle") {
      definition.enableSpring = true;
      definition.targetAngle = -motor.targetAngle;
      definition.hertz = motor.hertz;
      definition.dampingRatio = motor.dampingRatio;
    } else if (motor.mode === "friction") {
      definition.enableMotor = true;
      definition.motorSpeed = 0;
      definition.maxMotorTorque = motor.maxTorque;
    } else if (motor.mode === "target-velocity") {
      definition.enableMotor = true;
      definition.motorSpeed = -motor.targetVelocity;
      definition.maxMotorTorque = motor.maxTorque;
    }
  }

  #applyPrismaticMotorDefinition(
    definition: b3PrismaticJointDef,
    motor: PrismaticMotor,
  ): void {
    validatePrismaticMotor(motor);
    if (motor.mode === "target-position") {
      definition.enableSpring = true;
      definition.targetTranslation = -motor.targetPosition;
      definition.hertz = motor.hertz;
      definition.dampingRatio = motor.dampingRatio;
    } else if (motor.mode === "target-velocity") {
      definition.enableMotor = true;
      definition.motorSpeed = -motor.targetVelocity;
      definition.maxMotorForce = motor.maxForce;
    }
  }

  #trackConstraint(
    joint: b3JointId,
    bodyA: RuntimeId,
    bodyB?: RuntimeId,
    helperBody: b3BodyId | null = null,
  ): ConstraintId {
    const index =
      this.#freeConstraintSlots.pop() ?? this.#constraintSlots.length;
    const generation = this.#constraintSlots[index]?.generation ?? 1;
    this.#constraintSlots[index] = {
      generation,
      joint,
      bodyA: { ...bodyA },
      bodyB: bodyB ? { ...bodyB } : null,
      helperBody,
    };
    return { index, generation };
  }

  #track(
    body: b3BodyId,
    resources: {
      meshes?: b3MeshData[];
      compounds?: b3CompoundData[];
      heightFields?: b3HeightFieldData[];
      shapes?: b3ShapeId[];
    } = {},
  ): RuntimeId {
    const index = this.#freeSlots.pop() ?? this.#slots.length;
    const existing = this.#slots[index];
    const generation = existing?.generation ?? 1;
    this.#slots[index] = {
      generation,
      body,
      meshes: resources.meshes ?? [],
      compounds: resources.compounds ?? [],
      heightFields: resources.heightFields ?? [],
      shapes: resources.shapes ?? [],
      surfaceVelocity: { x: 0, y: 0, z: 0 },
    };
    return { index, generation };
  }

  #destroySlot(index: number): void {
    const slot = this.#slots[index];
    if (!slot?.body) return;
    const id = { index, generation: slot.generation };
    for (
      let constraintIndex = 0;
      constraintIndex < this.#constraintSlots.length;
      constraintIndex += 1
    ) {
      const constraint = this.#constraintSlots[constraintIndex];
      if (!constraint?.joint) continue;
      if (
        sameId(constraint.bodyA, id) ||
        (constraint.bodyB !== null && sameId(constraint.bodyB, id))
      ) {
        this.destroyConstraint({
          index: constraintIndex,
          generation: constraint.generation,
        });
      }
    }
    this.#box3d.b3DestroyBody(slot.body);
    this.#destroyBackingResources(slot);
    slot.body = null;
    slot.meshes = [];
    slot.compounds = [];
    slot.heightFields = [];
    slot.shapes = [];
    slot.surfaceVelocity = { x: 0, y: 0, z: 0 };
    slot.generation += 1;
    this.#freeSlots.push(index);
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error("physics world is disposed");
  }

  #destroyBackingResources(slot: BodySlot | undefined): void {
    if (!slot) return;
    for (const mesh of slot.meshes) this.#box3d.b3DestroyMesh(mesh);
    for (const compound of slot.compounds)
      this.#box3d.b3DestroyCompound(compound);
    for (const heightField of slot.heightFields)
      this.#box3d.b3DestroyHeightField(heightField);
  }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function runtimeKey(id: RuntimeId): string {
  return `${id.index}:${id.generation}`;
}

function limitVector(value: Vec3, maximum: number): Vec3 {
  const length = Math.hypot(value.x, value.y, value.z);
  return length <= maximum || length <= Number.EPSILON
    ? { ...value }
    : multiply(value, maximum / length);
}

function shortestRotation(
  target: Quat,
  current: Quat,
): { axis: Vec3; angle: number } {
  const inverseCurrent = {
    x: -current.x,
    y: -current.y,
    z: -current.z,
    w: current.w,
  };
  let delta = multiplyQuat(target, inverseCurrent);
  if (delta.w < 0)
    delta = { x: -delta.x, y: -delta.y, z: -delta.z, w: -delta.w };
  const vectorLength = Math.hypot(delta.x, delta.y, delta.z);
  if (vectorLength <= Number.EPSILON)
    return { axis: { x: 0, y: 0, z: 0 }, angle: 0 };
  return {
    axis: {
      x: delta.x / vectorLength,
      y: delta.y / vectorLength,
      z: delta.z / vectorLength,
    },
    angle: 2 * Math.atan2(vectorLength, Math.max(-1, Math.min(1, delta.w))),
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

function multiply(value: Vec3, amount: number): Vec3 {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount };
}

function jointTransform(frame: JointFrame) {
  if (!Object.values(frame.position).every(Number.isFinite))
    throw new Error("joint frame position must be finite");
  const rotationLength = Math.hypot(
    frame.rotation.x,
    frame.rotation.y,
    frame.rotation.z,
    frame.rotation.w,
  );
  if (!Number.isFinite(rotationLength) || rotationLength <= Number.EPSILON)
    throw new Error("joint frame rotation must be finite and nonzero");
  return {
    p: { ...frame.position },
    q: {
      v: {
        x: frame.rotation.x / rotationLength,
        y: frame.rotation.y / rotationLength,
        z: frame.rotation.z / rotationLength,
      },
      s: frame.rotation.w / rotationLength,
    },
  };
}

function boxRotation(rotation: Quat) {
  const length = Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w);
  if (!Number.isFinite(length) || length <= Number.EPSILON)
    throw new Error("rotation must be finite and nonzero");
  return {
    v: {
      x: rotation.x / length,
      y: rotation.y / length,
      z: rotation.z / length,
    },
    s: rotation.w / length,
  };
}

function validateRevoluteMotor(motor: RevoluteMotor): void {
  const values =
    motor.mode === "none"
      ? []
      : motor.mode === "friction"
        ? [motor.maxTorque]
        : motor.mode === "target-angle"
          ? [motor.targetAngle, motor.hertz, motor.dampingRatio]
          : [motor.targetVelocity, motor.maxTorque];
  if (values.some((value) => !Number.isFinite(value)))
    throw new Error("revolute motor values must be finite");
  if (
    (motor.mode === "friction" && motor.maxTorque < 0) ||
    (motor.mode === "target-velocity" && motor.maxTorque < 0) ||
    (motor.mode === "target-angle" &&
      (motor.hertz < 0 || motor.dampingRatio < 0))
  )
    throw new Error("revolute motor limits must be non-negative");
}

function validatePrismaticMotor(motor: PrismaticMotor): void {
  const values =
    motor.mode === "none"
      ? []
      : motor.mode === "target-position"
        ? [motor.targetPosition, motor.hertz, motor.dampingRatio]
        : [motor.targetVelocity, motor.maxForce];
  if (values.some((value) => !Number.isFinite(value)))
    throw new Error("prismatic motor values must be finite");
  if (
    (motor.mode === "target-velocity" && motor.maxForce < 0) ||
    (motor.mode === "target-position" &&
      (motor.hertz < 0 || motor.dampingRatio < 0))
  )
    throw new Error("prismatic motor limits must be non-negative");
}

function sameId(a: RuntimeId, b: RuntimeId): boolean {
  return a.index === b.index && a.generation === b.generation;
}
