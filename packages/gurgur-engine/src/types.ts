export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

export type RuntimeId = {
  index: number;
  generation: number;
};

export type BodySnapshot = {
  id: RuntimeId;
  position: Vec3;
  rotation: Quat;
  linearVelocity?: Vec3;
  angularVelocity?: Vec3;
  flags?: number;
};

export type ConstraintId = { index: number; generation: number };
export type BodyKind = "static" | "kinematic" | "dynamic";

export type JointFrame = {
  position: Vec3;
  rotation: Quat;
};

export type JointBodies = {
  bodyA: RuntimeId;
  bodyB?: RuntimeId;
  localFrameA: JointFrame;
  localFrameB: JointFrame;
  collideConnected?: boolean;
};

export type RevoluteMotor =
  | { mode: "none" }
  | { mode: "friction"; maxTorque: number }
  | {
      mode: "target-angle";
      targetAngle: number;
      hertz: number;
      dampingRatio: number;
    }
  | { mode: "target-velocity"; targetVelocity: number; maxTorque: number };

export type PrismaticMotor =
  | { mode: "none" }
  | {
      mode: "target-position";
      targetPosition: number;
      hertz: number;
      dampingRatio: number;
    }
  | { mode: "target-velocity"; targetVelocity: number; maxForce: number };

export type BodyState = BodySnapshot & {
  linearVelocity: Vec3;
  angularVelocity: Vec3;
  awake: boolean;
};

export type PhysicsStepEvents = {
  sensorBegin: Array<{ sensor: RuntimeId; visitor: RuntimeId }>;
  sensorEnd: Array<{ sensor: RuntimeId; visitor: RuntimeId }>;
  contactBegin: Array<{ a: RuntimeId; b: RuntimeId }>;
  contactEnd: Array<{ a: RuntimeId; b: RuntimeId }>;
  contactHit: Array<{
    a: RuntimeId;
    b: RuntimeId;
    point: Vec3;
    normal: Vec3;
    approachSpeed: number;
  }>;
  moved: Array<{
    body: RuntimeId;
    position: Vec3;
    rotation: Quat;
    fellAsleep: boolean;
  }>;
};

export type PhysicsDebugDraw = {
  primitives: PhysicsDebugPrimitive[];
  truncated: boolean;
};

export type Snapshot = {
  worldEpoch: number;
  serverTick: number;
  bodies: BodySnapshot[];
  players: PlayerStateSnapshot[];
};

export type PhysicsDebugPrimitive =
  | { kind: "bounds"; lower: Vec3; upper: Vec3; color: number }
  | { kind: "segment"; from: Vec3; to: Vec3; color: number }
  | { kind: "point"; position: Vec3; size: number; color: number };

export type PhysicsDebugFrame = {
  worldEpoch: number;
  serverTick: number;
  primitives: PhysicsDebugPrimitive[];
  truncated: boolean;
};

export type TransferPolicy = "fixed";

export type NetworkObjectKind = "body" | "player";

export type NetworkBodyState = {
  kind: "body";
  id: RuntimeId;
  authorityVersion: number;
  stateSequence: number;
  sourceTick: number;
  position: Vec3;
  rotation: Quat;
  linearVelocity: Vec3;
  angularVelocity: Vec3;
  flags: number;
};

export type NetworkPlayerState = {
  kind: "player";
  id: RuntimeId;
  authorityVersion: number;
  stateSequence: number;
  sourceTick: number;
  position: Vec3;
  rotation: Quat;
  linearVelocity: Vec3;
  angularVelocity: Vec3;
  flags: number;
  yaw: number;
  verticalVelocity: number;
  grounded: boolean;
  crouched: boolean;
  lastJumpCounter: number;
  stepCooldown: number;
};

export type PredictionHeldBody = {
  claimVersion: number;
  startInputSequence: number | null;
  localAnchor: Vec3;
  body: NetworkBodyState;
  distance: number;
  relativeRotation: Quat;
  targetPosition: Vec3;
  targetRotation: Quat;
  errorSeconds: number;
};

export type PredictionCheckpointPacket = {
  worldEpoch: number;
  serverTick: number;
  lastProcessedInputSequence: number | null;
  player: NetworkPlayerState;
  /**
   * Authoritative states for the bounded loose-body contact island which the
   * owner is allowed to replay. The server remains authoritative for every
   * entry; omission means the browser must represent that body as a proxy.
   */
  nearbyBodies: NetworkBodyState[];
  held: PredictionHeldBody | null;
};

export type NetworkObjectState = NetworkBodyState | NetworkPlayerState;

export type StateDelta = {
  kind: NetworkObjectKind;
  id: RuntimeId;
  authorityVersion: number;
  stateSequence: number;
  sourceTick: number;
  baselineSequence: number | null;
  fieldMask: number;
  position?: Vec3;
  rotation?: Quat;
  linearVelocity?: Vec3;
  angularVelocity?: Vec3;
  flags?: number;
  player?: {
    yaw: number;
    verticalVelocity: number;
    grounded: boolean;
    crouched: boolean;
    lastJumpCounter: number;
    stepCooldown: number;
  };
};

export type StateClusterPacket = {
  worldEpoch: number;
  clusterSequence: number;
  states: StateDelta[];
};

export type StateAckPacket = {
  worldEpoch: number;
  entries: Array<{
    id: RuntimeId;
    authorityVersion: number;
    stateSequence: number;
  }>;
};

export type BootstrapStatePacket = {
  worldEpoch: number;
  states: NetworkObjectState[];
};

export type OwnershipChangedPacket = {
  worldEpoch: number;
  requestId: number | null;
  id: RuntimeId;
  ownerPlayerId: RuntimeId | null;
  authorityVersion: number;
  state: NetworkObjectState;
};

export type PlayerStateSnapshot = {
  id: RuntimeId;
  position: Vec3;
  yaw: number;
  verticalVelocity: number;
  grounded: boolean;
  lastProcessedInputSequence: number;
  lastJumpCounter: number;
  stepCooldown: number;
  crouched: boolean;
};

export type WelcomeMessage = {
  type: "welcome";
  protocolVersion: 7;
  worldEpoch: number;
  playerId: RuntimeId;
  mapRevision: string;
  physicsHz: number;
  stateHz: number;
  sessionToken: string;
  socketGeneration: number;
};

export type HelloMessage = {
  type: "hello";
  protocolVersion: 7;
  mapRevision: string | null;
  worldEpoch: number | null;
  sessionToken: string | null;
  socketGeneration: number;
};

export type PingMessage = {
  type: "ping";
  protocolVersion: 7;
  worldEpoch: number;
  nonce: number;
  sentAtMs: number;
};

export type PongMessage = {
  type: "pong";
  protocolVersion: 7;
  worldEpoch: number;
  nonce: number;
  sentAtMs: number;
  serverTick: number;
};

export type RtcOfferMessage = {
  type: "rtc-offer";
  protocolVersion: 7;
  worldEpoch: number;
  description: { type: "offer"; sdp: string };
  iceServers: Array<{ urls: string; username?: string; credential?: string }>;
};

export type RtcAnswerMessage = {
  type: "rtc-answer";
  protocolVersion: 7;
  worldEpoch: number;
  description: { type: "answer"; sdp: string };
};

export type SpeechVoice = 0 | 1 | 2 | 3 | 4;

export type SpeakMessage = {
  type: "speak";
  protocolVersion: 7;
  worldEpoch: number;
  requestId: number;
  text: string;
};

export type SpeechMessage = {
  type: "speech";
  protocolVersion: 7;
  worldEpoch: number;
  requestId: number;
  speakerId: RuntimeId;
  voice: SpeechVoice;
  text: string;
};

export type SpeechRejectedMessage = {
  type: "speech-rejected";
  protocolVersion: 7;
  worldEpoch: number;
  requestId: number;
  reason: "rate-limited" | "world-changed";
  retryAfterMs: number;
};

export type ManipulationRequestMessage = {
  type: "manipulation-request";
  protocolVersion: 7;
  worldEpoch: number;
  requestId: number;
  target: RuntimeId;
  authorityVersion: number;
  localAnchor: Vec3;
  holdDistance: number;
};

export type ManipulationDropMessage = {
  type: "manipulation-drop";
  protocolVersion: 7;
  worldEpoch: number;
  target: RuntimeId;
  authorityVersion: number;
  claimVersion: number;
};

export type ManipulationChangedMessage = {
  type: "manipulation-changed";
  protocolVersion: 7;
  worldEpoch: number;
  requestId: number | null;
  target: RuntimeId;
  authorityVersion: number;
  claimVersion: number;
  manipulatorPlayerId: RuntimeId | null;
};

export type ManipulationDeniedMessage = {
  type: "manipulation-denied";
  protocolVersion: 7;
  worldEpoch: number;
  requestId: number;
  target: RuntimeId;
  reason: "stale" | "unavailable" | "out-of-range" | "busy";
};

export type ManipulationStatePacket = {
  worldEpoch: number;
  target: RuntimeId;
  authorityVersion: number;
  claimVersion: number;
  stateSequence: number;
  targetPosition: Vec3;
  targetRotation: Quat;
};

export type UseRequestMessage = {
  type: "use-request";
  protocolVersion: 7;
  worldEpoch: number;
  requestId: number;
  target: RuntimeId;
};

export type ClientControlMessage =
  | HelloMessage
  | PingMessage
  | RtcAnswerMessage
  | SpeakMessage
  | ManipulationRequestMessage
  | ManipulationDropMessage
  | UseRequestMessage;
export type ServerControlMessage =
  | WelcomeMessage
  | PongMessage
  | RtcOfferMessage
  | SpeechMessage
  | SpeechRejectedMessage
  | ManipulationChangedMessage
  | ManipulationDeniedMessage;

export type InputCommand = {
  type: "input";
  protocolVersion: 7;
  worldEpoch: number;
  sequence: number;
  clientTick: number;
  moveX: number;
  moveZ: number;
  lookYaw: number;
  lookPitch: number;
  buttons: number;
  jumpCounter: number;
  interactCounter: number;
  interactTarget: RuntimeId | null;
  primaryCounter: number;
};

export type InputBundlePacket = {
  worldEpoch: number;
  commands: InputCommand[];
};

export type ClientPacket = ClientControlMessage | InputCommand;
