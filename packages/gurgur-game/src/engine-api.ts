import type {
  BodyState,
  ConstraintId,
  JointBodies,
  PrismaticMotor,
  Quat,
  RevoluteMotor,
  RuntimeId,
  Vec3,
} from "@harrhy/gurgur-engine";

export type CapsuleShape = { radius: number; halfSegment: number };
export type RuntimeBodyRef = { id: RuntimeId; entityIndex: number };
export type RayHit = {
  point: Vec3;
  normal: Vec3;
  fraction: number;
  body: RuntimeId;
};
export type BodyTargetOptions = {
  targetPosition: Vec3;
  targetRotation: Quat;
  linearGain: number;
  maxLinearSpeed: number;
  maxLinearAcceleration: number;
  angularGain: number;
  maxAngularSpeed: number;
  maxAngularAcceleration: number;
};

export type GameEngine = {
  readonly tick: number;
  readonly dt: number;
  readonly bodies: {
    forEntity(entityIndex: number): RuntimeBodyRef | null;
    resolve(id: RuntimeId): RuntimeBodyRef | null;
    state(id: RuntimeId): BodyState;
  };

  setKinematicTarget(id: RuntimeId, position: Vec3): void;
  setBodyAwake(id: RuntimeId, awake: boolean): void;
  raycast(
    origin: Vec3,
    displacement: Vec3,
    options?: { ignoreBodies?: readonly RuntimeId[] },
  ): RayHit | null;

  createPlayerProxy(position: Vec3, shape: CapsuleShape): RuntimeId;
  updatePlayerProxy(id: RuntimeId, position: Vec3, yaw: number): void;
  destroyBody(id: RuntimeId): void;

  driveBodyToTarget(id: RuntimeId, options: BodyTargetOptions): boolean;
  requestSave(): void;
};

export type HostMechanismEngine = {
  createControl(options: {
    body: RuntimeId;
    localAnchor: Vec3;
    targetPosition: Vec3;
    targetRotation: Quat;
  }): ConstraintId;
  setControlTarget(id: ConstraintId, position: Vec3, rotation: Quat): void;
  destroyConstraint(id: ConstraintId): boolean;
  createRevolute(
    options: JointBodies & {
      limit?: { lowerAngle: number; upperAngle: number };
      motor?: RevoluteMotor;
    },
  ): ConstraintId;
  setRevoluteMotor(id: ConstraintId, motor: RevoluteMotor): void;
  createPrismatic(
    options: JointBodies & {
      limit?: { lowerTranslation: number; upperTranslation: number };
      motor?: PrismaticMotor;
    },
  ): ConstraintId;
  setPrismaticMotor(id: ConstraintId, motor: PrismaticMotor): void;
  createSpherical(options: JointBodies): ConstraintId;
  createWeld(options: JointBodies): ConstraintId;
  createDistance(
    options: JointBodies & {
      length: number;
      mode: "rope" | "rod" | "spring";
      hertz?: number;
      dampingRatio?: number;
      maxForce?: number;
    },
  ): ConstraintId;
  setSurfaceVelocity(id: RuntimeId, velocity: Vec3): void;
  setGravityScale(id: RuntimeId, scale: number): void;
};
