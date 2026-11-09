import Box3D from "box3d.js/inline";
import type {
  b3BodyId,
  b3ShapeId,
  b3WorldId,
  b3Vec3,
  b3MeshData,
} from "box3d.js";
import {
  BALL_RADIUS,
  TABLE_HALF_WIDTH,
  TABLE_HALF_LENGTH,
  createRack,
  canPlaceCue,
  shotSpeed,
} from "./physics";
import type { Ball, PhysicalBall, ShotResult, PoolSound } from "./physics";
import {
  type StaticBox,
  FELT_Y,
  FELT_GEOMETRY,
  FELT_LIP_DROP,
  FELT_LIP_WIDTH,
  CUSHIONS,
  RETURNS,
  MESH_REST_OFFSET,
  isInReturnTray,
  storedBallPosition,
  isOverPocket,
  TRAY_FLOOR_Y,
  TABLE_BOUNDS,
} from "./physical-table";
export type { PhysicalBall } from "./physics";

type Vector3 = readonly [number, number, number];
type PhysicsEventContext = {
  readonly ballId: number;
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly angularVelocity: Vector3;
  readonly stage: PhysicalBall["stage"];
  readonly wasPocketed: boolean;
};
export type PhysicsEvent = PhysicsEventContext &
  (
    | { readonly type: "pocket"; readonly reason: "below-pocket-mouth" }
    | {
        readonly type: "recovery";
        readonly reason:
          | "non-finite"
          | "outside-cabinet"
          | "below-world"
          | "above-world"
          | "below-bed";
        readonly from: Vector3;
        readonly to: Vector3;
      }
    | { readonly type: "settle"; readonly reason: "resting-on-cloth" }
    | {
        readonly type: "below-bed";
        readonly reason: "outside-pocket-mouth" | "no-pocket-crossing";
      }
  );

function eventContext(ball: PhysicalBall): PhysicsEventContext {
  return {
    ballId: ball.id,
    position: [ball.x, ball.y, ball.z],
    velocity: [ball.vx, ball.vy, ball.vz],
    angularVelocity: [...ball.w],
    stage: ball.stage,
    wasPocketed: ball.pocketed,
  };
}

const b3 = await Box3D();
// Box3D scales rolling resistance by the sphere radius.
const CLOTH_ROLLING_RESISTANCE = 0.014;
const RETURN_ROLLING_RESISTANCE = 0.00015;
// Grams keep small-ball rolling impulses above the native solver tolerance.
const BALL_MASS_GRAMS = 165;
const key = (id: b3ShapeId) => `${id.index1}:${id.generation}`;
type Collider =
  | { ball: PhysicalBall }
  | { surface: "cushion" | "return" | "felt" };

export class PoolPhysics {
  readonly balls: PhysicalBall[] = [];
  private world!: b3WorldId;
  private gravityVector: b3Vec3 = [0, -9.81, 0];
  private feltMesh: b3MeshData | null = null;
  private bodies = new Map<number, b3BodyId>();
  private shapes = new Map<number, b3ShapeId>();
  private recoveries = 0;
  private recovery: {
    ballId: number;
    from: [number, number, number];
    to: [number, number, number];
  } | null = null;

  get recoveryCount(): number {
    return this.recoveries;
  }
  get lastRecovery() {
    return this.recovery;
  }
  private colliders = new Map<string, Collider>();
  private nativeEvents = b3.createEventsBuffer();
  private stepEvents: PhysicsEvent[] = [];
  private stepSounds: PoolSound[] = [];
  private pendingCue: PoolSound | null = null;
  private soundTime = 0;
  private soundCooldowns = new Map<string, number>();

  get sounds(): readonly PoolSound[] {
    return this.stepSounds;
  }

  private clearSounds(): void {
    this.stepSounds = [];
    this.pendingCue = null;
    this.soundCooldowns.clear();
  }

  private addSound(sound: PoolSound): void {
    if (!Number.isFinite(sound.speed) || sound.speed < 0.04) return;
    this.stepSounds.push(sound);
    if (this.stepSounds.length > 32) {
      this.stepSounds.sort((a, b) => b.speed - a.speed);
      this.stepSounds.length = 32;
    }
  }

  private restingTime = new Map<number, number>();

  /** Events from the latest step; consume before calling step again. */
  get events(): readonly PhysicsEvent[] {
    return this.stepEvents;
  }
  private hit = b3.createContactHitEvent();
  private disposed = false;
  private position: b3Vec3 = [0, 0, 0];
  private velocity: b3Vec3 = [0, 0, 0];
  private revision = 0;

  constructor(initial: (Ball | PhysicalBall)[] = createRack()) {
    this.reset(initial);
  }

  get gravity(): Vector3 {
    return [...this.gravityVector];
  }

  setGravity(gravity: Vector3): void {
    this.assertAlive();
    if (
      !Array.isArray(gravity) ||
      gravity.length !== 3 ||
      ![gravity[0], gravity[1], gravity[2]].every(
        (component) => Number.isFinite(component) && Math.abs(component) <= 15,
      )
    )
      throw new RangeError(
        "Gravity must have three finite components in [-15, 15]",
      );
    if (gravity.every((component, i) => component === this.gravityVector[i]))
      return;
    this.gravityVector = [gravity[0], gravity[1], gravity[2]];
    b3.b3World_SetGravity(this.world, this.gravityVector);
    this.restingTime.clear();
    for (const body of this.bodies.values()) b3.b3Body_SetAwake(body, true);
  }

  reset(initial: (Ball | PhysicalBall)[] = createRack()): void {
    this.assertAlive();
    if (this.world) b3.b3DestroyWorld(this.world);
    if (this.feltMesh) b3.b3DestroyMesh(this.feltMesh);
    this.bodies.clear();
    this.shapes.clear();
    this.colliders.clear();
    this.balls.length = 0;
    this.clearSounds();
    this.stepEvents.length = 0;
    this.restingTime.clear();
    const wd = b3.b3DefaultWorldDef();
    wd.gravity = [...this.gravityVector];
    wd.hitEventThreshold = 0.001;
    wd.restitutionThreshold = 0.15;
    this.world = b3.b3CreateWorld(wd);
    // The 50 mm default reuses stale contact planes across an almost ball-sized distance.
    b3.b3World_SetContactRecycleDistance(this.world, 0.001);
    const feltBodyDef = b3.b3DefaultBodyDef();
    feltBodyDef.position = [0, -MESH_REST_OFFSET, 0];
    const feltBody = b3.b3CreateBody(this.world, feltBodyDef);
    const feltDef = b3.b3DefaultShapeDef();
    // Geometric mixing with the balls' 0.05 gives 0.20 sliding friction on cloth.
    feltDef.baseMaterial.friction = 0.8;
    feltDef.baseMaterial.rollingResistance = CLOTH_ROLLING_RESISTANCE;
    const mesh = b3.b3CreateMesh(
      new Float32Array(FELT_GEOMETRY.positions),
      new Uint32Array(FELT_GEOMETRY.indices),
    );
    if (!mesh) throw new Error("Failed to create felt mesh");
    this.feltMesh = mesh;
    const feltShape = b3.b3CreateMeshShape(feltBody, feltDef, mesh, [1, 1, 1]);
    this.colliders.set(key(feltShape), { surface: "felt" });

    const lipShapes = new Set<string>();
    const jaws = new Map<string, StaticBox>();
    b3.b3World_SetPreSolveCallback(this.world, (a: b3ShapeId, c: b3ShapeId) => {
      const jaw = jaws.get(key(a)) ?? jaws.get(key(c));
      if (jaw) {
        // Speculative corner normals deflect balls that still clear the diagonal jaw.
        const other = jaws.has(key(a)) ? c : a;
        const pos = b3.b3Body_GetPosition(
          this.position,
          b3.b3Shape_GetBody(other),
        );
        const dx = pos[0] - jaw.center[0],
          dz = pos[2] - jaw.center[2];
        const cosine = 1 - 2 * jaw.rotation[1] ** 2;
        const sine = 2 * jaw.rotation[1] * jaw.rotation[3];
        const x = Math.max(
          0,
          Math.abs(cosine * dx - sine * dz) - jaw.size[0] / 2,
        );
        const y = Math.max(
          0,
          Math.abs(pos[1] - jaw.center[1]) - jaw.size[1] / 2,
        );
        const z = Math.max(
          0,
          Math.abs(sine * dx + cosine * dz) - jaw.size[2] / 2,
        );
        return x * x + y * y + z * z <= BALL_RADIUS ** 2;
      }
      const other = lipShapes.has(key(a))
        ? c
        : lipShapes.has(key(c))
          ? a
          : null;
      if (!other) return true;
      const body = b3.b3Shape_GetBody(other);
      const position = b3.b3Body_GetPosition(this.position, body);
      // A speculative side contact must not launch a sphere that clears the liner top.
      return position[1] - BALL_RADIUS <= FELT_Y - FELT_LIP_DROP;
    });
    for (const part of [...CUSHIONS, ...RETURNS]) {
      const bd = b3.b3DefaultBodyDef();
      bd.position = [...part.center];
      bd.rotation = [...part.rotation];
      const body = b3.b3CreateBody(this.world, bd);
      const sd = b3.b3DefaultShapeDef();
      sd.baseMaterial.friction = 0.15;
      sd.baseMaterial.rollingResistance = RETURN_ROLLING_RESISTANCE;
      sd.baseMaterial.restitution = part.kind === "cushion" ? 0.8 : 0;
      sd.enableHitEvents = true;
      const lip =
        part.kind === "pocket" && part.center[1] + part.size[1] / 2 < FELT_Y;
      const jaw = part.kind === "cushion" && part.rotation[1] !== 0;
      sd.enablePreSolveEvents = lip || jaw;
      const shape = b3.b3CreateBoxShape(
        body,
        sd,
        part.size[0] / 2,
        part.size[1] / 2,
        part.size[2] / 2,
      );
      if (lip) lipShapes.add(key(shape));
      if (jaw) jaws.set(key(shape), part);
      this.colliders.set(key(shape), {
        surface: CUSHIONS.includes(part) ? "cushion" : "return",
      });
    }
    for (const source of initial) {
      const ball: PhysicalBall = {
        ...source,
        y: FELT_Y + BALL_RADIUS,
        vy: 0,
        q: [0, 0, 0, 1],
        w: [0, 0, 0],
        stage: "table",
        revision: ++this.revision,
      };
      if (source.pocketed)
        Object.assign(ball, {
          x: storedBallPosition(source.id)[0],
          y: TRAY_FLOOR_Y + BALL_RADIUS,
          z: storedBallPosition(source.id)[2],
          vx: 0,
          vz: 0,
          stage: "stored",
        });
      if ("y" in source) {
        Object.assign(ball, source, { q: [...source.q], w: [...source.w] });
        this.revision = Math.max(this.revision, source.revision);
      }
      const bd = b3.b3DefaultBodyDef();
      bd.rotation = [...ball.q];
      bd.type = b3.b3BodyType.b3_dynamicBody;
      bd.position = [ball.x, ball.y, ball.z];
      bd.linearVelocity = [ball.vx, ball.vy, ball.vz];
      bd.angularVelocity = [...ball.w];
      bd.isBullet = true;
      bd.sleepThreshold = 0.025;
      const body = b3.b3CreateBody(this.world, bd);
      const sd = b3.b3DefaultShapeDef();
      sd.density = BALL_MASS_GRAMS / ((4 / 3) * Math.PI * BALL_RADIUS ** 3);
      sd.baseMaterial.friction = 0.05;
      sd.baseMaterial.restitution = 0.94;
      sd.baseMaterial.rollingResistance = CLOTH_ROLLING_RESISTANCE;
      sd.enableContactEvents = true;
      sd.enableHitEvents = true;
      const shape = b3.b3CreateSphereShape(body, sd, {
        center: [0, 0, 0],
        radius: BALL_RADIUS,
      });
      this.bodies.set(ball.id, body);
      this.shapes.set(ball.id, shape);
      if (ball.pocketed || ball.stage === "falling") {
        this.setBallMaterial(ball.id, true);
        b3.b3Body_EnableSleep(body, ball.stage === "stored");
      }
      this.colliders.set(key(shape), { ball });
      this.balls.push(ball);
    }
  }

  /** Restore physical snapshot state without recreating the native world. */
  restore(snapshot: PhysicalBall[]): void {
    this.assertAlive();
    this.clearSounds();
    this.restingTime.clear();
    for (const source of snapshot) {
      const ball = this.balls.find((b) => b.id === source.id);
      const body = this.bodies.get(source.id);
      if (!ball || !body)
        throw new Error("Snapshot ball set differs from world");
      Object.assign(ball, source, { q: [...source.q], w: [...source.w] });
      this.revision = Math.max(this.revision, source.revision);
      b3.b3Body_SetTransform(body, [ball.x, ball.y, ball.z], ball.q);
      b3.b3Body_SetLinearVelocity(body, [ball.vx, ball.vy, ball.vz]);
      b3.b3Body_SetAngularVelocity(body, ball.w);
      this.setBallMaterial(ball.id, ball.pocketed || ball.stage === "falling");
      b3.b3Body_SetAwake(body, true);
    }
  }

  strike(angle: number, power: number): void {
    this.assertAlive();
    this.stepSounds = [];
    this.pendingCue = null;
    const cue = this.balls.find((ball) => ball.id === 0);
    if (
      !cue ||
      cue.pocketed ||
      cue.stage !== "table" ||
      !Number.isFinite(angle) ||
      !Number.isFinite(power)
    )
      return;
    this.restingTime.delete(cue.id);
    const speed = shotSpeed(power);
    this.pendingCue = {
      kind: "cue",
      ballId: cue.id,
      x: cue.x,
      y: cue.y,
      z: cue.z,
      speed,
    };
    const body = this.bodies.get(0)!;
    b3.b3Body_SetLinearVelocity(body, [
      Math.cos(angle) * speed,
      0,
      Math.sin(angle) * speed,
    ]);
    b3.b3Body_SetAwake(body, true);
    this.readBall(cue, body);
  }

  placeCue(x: number, z: number): boolean {
    this.assertAlive();
    const cue = this.balls.find((ball) => ball.id === 0);
    if (!cue || !canPlaceCue(this.balls, x, z)) return false;
    const body = this.bodies.get(0)!;
    b3.b3Body_SetTransform(body, [x, FELT_Y + BALL_RADIUS, z], [0, 0, 0, 1]);
    b3.b3Body_SetLinearVelocity(body, [0, 0, 0]);
    b3.b3Body_SetAngularVelocity(body, [0, 0, 0]);
    b3.b3Body_SetAwake(body, true);
    this.setBallMaterial(0, false);
    this.restingTime.delete(0);
    Object.assign(cue, {
      pocketed: false,
      stage: "table",
      revision: ++this.revision,
    });
    this.readBall(cue, body);
    return true;
  }

  step(dt: number, result: ShotResult): boolean {
    this.assertAlive();
    this.stepEvents.length = 0;
    this.stepSounds = [];
    if (!Number.isFinite(dt) || dt < 0)
      throw new RangeError("dt must be finite and nonnegative");
    if (dt > 0 && this.pendingCue) {
      this.addSound(this.pendingCue);
      this.pendingCue = null;
    }
    let remaining = dt;
    while (remaining > 1e-10) {
      const speed = this.balls.reduce(
        (v, ball) => Math.max(v, Math.hypot(ball.vx, ball.vy, ball.vz)),
        0,
      );
      // Bullet-vs-bullet CCD is unsupported. Bound relative travel before each broadphase update.
      const h = Math.min(
        remaining,
        1 / 240,
        BALL_RADIUS / (4 * Math.max(1, speed)),
      );
      this.soundTime += h;
      for (const [pair, until] of this.soundCooldowns)
        if (until <= this.soundTime) this.soundCooldowns.delete(pair);
      b3.b3World_Step(this.world, h, 2);
      b3.getEvents(this.nativeEvents, this.world);
      for (let i = 0; i < b3.getNumContactHitEvents(this.nativeEvents); i++) {
        b3.getContactHitEventAt(this.hit, this.nativeEvents, i);
        const a = this.colliders.get(key(this.hit.shapeIdA));
        const c = this.colliders.get(key(this.hit.shapeIdB));
        if (!a || !c) continue;
        const ball = "ball" in a ? a.ball : "ball" in c ? c.ball : undefined;
        const other = "ball" in a && "ball" in c ? c.ball : undefined;
        const surface =
          "surface" in a ? a.surface : "surface" in c ? c.surface : undefined;
        const currentSpeed = this.hit.approachSpeed;
        const pair = [key(this.hit.shapeIdA), key(this.hit.shapeIdB)]
          .toSorted()
          .join("/");
        if (
          ball &&
          currentSpeed >= (surface === "felt" ? 0.12 : 0.04) &&
          !this.soundCooldowns.has(pair)
        ) {
          this.soundCooldowns.set(pair, this.soundTime + 0.05);
          this.addSound({
            kind:
              ball.pocketed || other?.pocketed || surface === "return"
                ? "return"
                : other
                  ? "ball"
                  : "cushion",
            ballId: other ? Math.min(ball.id, other.id) : ball.id,
            ...(other ? { otherBallId: Math.max(ball.id, other.id) } : {}),
            x: this.hit.point[0],
            y: this.hit.point[1],
            z: this.hit.point[2],
            speed: currentSpeed,
          });
        }
        if ("ball" in a && "ball" in c) {
          if (
            !a.ball.pocketed &&
            !c.ball.pocketed &&
            a.ball.stage === "table" &&
            c.ball.stage === "table" &&
            result.firstContact === null &&
            (a.ball.id === 0 || c.ball.id === 0)
          )
            result.firstContact = a.ball.id === 0 ? c.ball.id : a.ball.id;
        } else {
          const candidateBall =
            "ball" in a ? a.ball : "ball" in c ? c.ball : undefined;
          if (
            candidateBall &&
            surface === "cushion" &&
            !candidateBall.pocketed &&
            candidateBall.stage === "table" &&
            result.firstContact !== null
          )
            result.railAfterContact = true;
        }
      }
      for (const ball of this.balls) {
        const body = this.bodies.get(ball.id)!;
        const previousX = ball.x,
          previousY = ball.y,
          previousZ = ball.z;
        this.readBall(ball, body);
        if (
          !ball.pocketed &&
          ball.stage === "falling" &&
          ball.y >= FELT_Y + BALL_RADIUS - 0.005 &&
          !isOverPocket(ball.x, ball.z)
        ) {
          ball.stage = "table";
          this.setBallMaterial(ball.id, false);
        }
        if (
          !ball.pocketed &&
          ball.stage !== "falling" &&
          isOverPocket(ball.x, ball.z) &&
          ball.y <= FELT_Y + BALL_RADIUS + 0.002
        ) {
          ball.stage = "falling";
          this.setBallMaterial(ball.id, true);
        }
        if (!ball.pocketed && ball.y < FELT_Y - BALL_RADIUS) {
          // Check the mouth where the whole sphere crossed below the cloth.
          const crossedBed = previousY >= FELT_Y - BALL_RADIUS;
          const fraction = crossedBed
            ? (previousY - (FELT_Y - BALL_RADIUS)) / (previousY - ball.y)
            : 1;
          const crossedMouth =
            crossedBed &&
            isOverPocket(
              previousX + (ball.x - previousX) * fraction,
              previousZ + (ball.z - previousZ) * fraction,
            );
          if (crossedMouth) {
            this.stepEvents.push({
              ...eventContext(ball),
              type: "pocket",
              reason: "below-pocket-mouth",
            });
            this.addSound({
              kind: "pocket",
              ballId: ball.id,
              x: ball.x,
              y: ball.y,
              z: ball.z,
              speed: Math.hypot(ball.vx, ball.vy, ball.vz),
            });
            ball.pocketed = true;
            ball.stage = "return";
            this.setBallMaterial(ball.id, true);
            if (!result.potted.includes(ball.id)) result.potted.push(ball.id);
          } else {
            this.stepEvents.push({
              ...eventContext(ball),
              type: "below-bed",
              reason:
                crossedBed || !isOverPocket(ball.x, ball.z)
                  ? "outside-pocket-mouth"
                  : "no-pocket-crossing",
            });
            this.recoverIfOutside(ball, body, "below-bed");
          }
        }
        this.recoverIfOutside(ball, body);
        this.settleOnCloth(ball, body, h);
        if (ball.pocketed) {
          const stage = isInReturnTray(ball.x, ball.y, ball.z)
            ? "stored"
            : "return";
          if (ball.stage !== stage)
            b3.b3Body_EnableSleep(body, stage === "stored");
          ball.stage = stage;
        }
      }
      remaining -= h;
    }
    return this.balls.some(
      (ball) =>
        !ball.pocketed &&
        (ball.stage === "falling" ||
          b3.b3Body_IsAwake(this.bodies.get(ball.id)!)),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    b3.b3DestroyWorld(this.world);
    if (this.feltMesh) b3.b3DestroyMesh(this.feltMesh);
    this.feltMesh = null;
    b3.destroyEventsBuffer(this.nativeEvents);
    this.bodies.clear();
    this.shapes.clear();
    this.colliders.clear();
    this.disposed = true;
  }

  private readBall(ball: PhysicalBall, body: b3BodyId): void {
    [ball.x, ball.y, ball.z] = b3.b3Body_GetPosition(this.position, body);
    [ball.vx, ball.vy, ball.vz] = b3.b3Body_GetLinearVelocity(
      this.velocity,
      body,
    );
    b3.b3Body_GetRotation(ball.q, body);
    b3.b3Body_GetAngularVelocity(ball.w, body);
  }
  private setBallMaterial(id: number, returning: boolean): void {
    const shape = this.shapes.get(id)!;
    const material = b3.b3Shape_GetSurfaceMaterial(shape);
    material.restitution = returning ? 0.05 : 0.94;
    material.rollingResistance = returning
      ? RETURN_ROLLING_RESISTANCE
      : CLOTH_ROLLING_RESISTANCE;
    b3.b3Shape_SetSurfaceMaterial(shape, material);
    b3.b3Body_EnableSleep(this.bodies.get(id)!, !returning);
  }

  private settleOnCloth(ball: PhysicalBall, body: b3BodyId, dt: number): void {
    // Under normal gravity, assist only persistent sub-2 mm/s motion on the
    // flat bed. Native sleep handles other stops; pocket lips and hops stay active.
    const resting =
      this.gravityVector[0] === 0 &&
      this.gravityVector[1] === -9.81 &&
      this.gravityVector[2] === 0 &&
      !ball.pocketed &&
      ball.stage === "table" &&
      b3.b3Body_IsAwake(body) &&
      Math.abs(ball.y - FELT_Y - BALL_RADIUS) < 0.001 &&
      Math.abs(ball.x) < TABLE_HALF_WIDTH - BALL_RADIUS &&
      Math.abs(ball.z) < TABLE_HALF_LENGTH - BALL_RADIUS &&
      !isOverPocket(ball.x, ball.z, FELT_LIP_WIDTH + BALL_RADIUS) &&
      Math.hypot(ball.vx, ball.vy, ball.vz) < 0.002 &&
      BALL_RADIUS * Math.hypot(...ball.w) < 0.025;
    if (!resting) {
      this.restingTime.delete(ball.id);
      return;
    }
    const time = (this.restingTime.get(ball.id) ?? 0) + dt;
    this.restingTime.set(ball.id, time);
    if (time < 0.5) return;
    this.stepEvents.push({
      ...eventContext(ball),
      type: "settle",
      reason: "resting-on-cloth",
    });
    b3.b3Body_SetAwake(body, false);
    this.restingTime.delete(ball.id);
    this.readBall(ball, body);
  }

  // Last-resort recovery is observable, and is never used to transport normal pocket returns.
  private recoverIfOutside(
    ball: PhysicalBall,
    body: b3BodyId,
    reason?: Extract<PhysicsEvent, { type: "recovery" }>["reason"],
  ): void {
    if (
      !reason &&
      Number.isFinite(ball.x) &&
      Number.isFinite(ball.y) &&
      Number.isFinite(ball.z) &&
      Math.abs(ball.x) + BALL_RADIUS <= TABLE_BOUNDS.x &&
      Math.abs(ball.z) + BALL_RADIUS <= TABLE_BOUNDS.z &&
      ball.y >= 0.05 &&
      ball.y <= 3
    )
      return;
    reason ??= ![ball.x, ball.y, ball.z].every(Number.isFinite)
      ? "non-finite"
      : ball.y < 0.05
        ? "below-world"
        : ball.y > 3
          ? "above-world"
          : "outside-cabinet";
    const context = eventContext(ball);
    const from: [number, number, number] = [ball.x, ball.y, ball.z];
    let to: [number, number, number] | undefined;
    for (let row = 0; row < (ball.pocketed ? 6 : 3) && !to; row++) {
      for (let column = 0; column < (ball.pocketed ? 3 : 12); column++) {
        const candidate: [number, number, number] = ball.pocketed
          ? storedBallPosition(row * 3 + column)
          : [
              (column - 5.5) * (2 * BALL_RADIUS + 0.008),
              FELT_Y + BALL_RADIUS,
              -TABLE_HALF_LENGTH * 0.65 + row * (2 * BALL_RADIUS + 0.015),
            ];
        if (
          this.balls.every(
            (other) =>
              other.id === ball.id ||
              Math.hypot(
                other.x - candidate[0],
                other.y - candidate[1],
                other.z - candidate[2],
              ) >
                2 * BALL_RADIUS + 0.004,
          )
        ) {
          to = candidate;
          break;
        }
      }
    }
    if (!to) throw new Error("No free position for escaped pool ball");
    b3.b3Body_SetTransform(body, to, [0, 0, 0, 1]);
    b3.b3Body_SetLinearVelocity(body, [0, 0, 0]);
    b3.b3Body_SetAngularVelocity(body, [0, 0, 0]);
    b3.b3Body_SetAwake(body, true);
    ball.stage = ball.pocketed ? "stored" : "table";
    this.setBallMaterial(ball.id, ball.pocketed);
    b3.b3Body_EnableSleep(body, true);
    this.restingTime.delete(ball.id);
    ball.revision = ++this.revision;
    this.recoveries++;
    this.recovery = { ballId: ball.id, from, to };
    this.stepEvents.push({
      ...context,
      type: "recovery",
      reason,
      from,
      to: [...to],
    });
    this.readBall(ball, body);
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error("PoolPhysics has been disposed");
  }
}
