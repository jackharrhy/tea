import type { RuntimeId, TransferPolicy, Vec3 } from "./types";

export type Vec2 = { x: number; y: number };
export type Rgb = { r: number; g: number; b: number };
export type SpriteAssetId = string;
export type TriangleSource = {
  entityIndex: number;
  brushIndex: number;
  faceIndex: number;
};

export type CompiledIndexedMesh = {
  vertices: Vec3[];
  triangles: Array<[number, number, number]>;
  triangleSources: TriangleSource[];
};

export type CompiledRenderBatch = {
  material: string;
  sensor: boolean;
  positions: Vec3[];
  normals: Vec3[];
  uvs: Vec2[];
  indices: number[];
  triangleSources: TriangleSource[];
};

export type CompiledBrush = {
  entityIndex: number;
  sourceBrushIndex: number;
  center: Vec3;
  collisionOnlyFaceIndices: number[];
  worldVertices: Vec3[];
  localVertices: Vec3[];
  triangles: Array<[number, number, number]>;
  triangleMaterials: string[];
  triangleSourceFaces: number[];
  triangleNormals: Vec3[];
  triangleUvs: Array<[Vec2, Vec2, Vec2]>;
};

type BrushBody = { brushIndices: number[] };

export type DynamicBrushBody = BrushBody & {
  kind: "dynamic-brush";
  density: number;
  friction: number;
  restitution: number;
  gravityScale: number;
};

export type KinematicBrushBody = BrushBody & { kind: "kinematic-brush" };
export type StaticBrushBody = BrushBody & { kind: "static-brush" };
export type SensorBrushBody = BrushBody & { kind: "sensor-brush" };

export type BodySpec =
  | DynamicBrushBody
  | KinematicBrushBody
  | StaticBrushBody
  | SensorBrushBody;

export type InteractionSpec = "none" | "use" | "grab" | "manipulate";

export type AmbientLightPresentation = {
  kind: "light";
  mode: "ambient";
  color: Rgb;
  intensity: number;
  volumeDensity: number;
};

export type DirectionalLightPresentation = {
  kind: "light";
  mode: "directional";
  color: Rgb;
  intensity: number;
  direction: Vec3;
  castShadow: boolean;
  shadowDistance: number;
};

export type PointLightPresentation = {
  kind: "light";
  mode: "point";
  color: Rgb;
  intensity: number;
  range: number;
  decay: number;
  castShadow: boolean;
  volumetric: boolean;
};

export type SpotLightPresentation = {
  kind: "light";
  mode: "spot";
  color: Rgb;
  intensity: number;
  direction: Vec3;
  range: number;
  decay: number;
  angle: number;
  penumbra: number;
  castShadow: boolean;
  volumetric: boolean;
};

export type LightPresentation =
  | AmbientLightPresentation
  | DirectionalLightPresentation
  | PointLightPresentation
  | SpotLightPresentation;

export type ConstraintPresentation = {
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
};

export type PresentationSpec =
  | { kind: "brush"; transform: "world" | "body" }
  | { kind: "sprite"; asset: SpriteAssetId; height: number; glow: boolean }
  | LightPresentation
  | ConstraintPresentation
  | { kind: "none" };

export type CompiledEntityCapabilities = {
  kind: string;
  authoredId?: string;
  origin?: Vec3;
  body: BodySpec | null;
  presentation: PresentationSpec;
  interaction: InteractionSpec;
};

export type WorldSettings = {
  title: string;
  gravity: Vec3;
  skyColor: Rgb;
};

export type PlayerSpawn = { name: string; position: Vec3; yaw: number };
export type ResetMarker = { label: string; position: Vec3 };

export type WorldBundle<
  TEntity extends CompiledEntityCapabilities = CompiledEntityCapabilities,
> = {
  bundleVersion: 1;
  mapRevision: string;
  sourceName: string;
  settings: WorldSettings;
  playerSpawns: PlayerSpawn[];
  resetMarkers: ResetMarker[];
  entities: TEntity[];
  brushes: CompiledBrush[];
  staticCollision: CompiledIndexedMesh;
  renderBatches: CompiledRenderBatch[];
};

type AuthorityDescriptor = {
  ownerPlayerId: RuntimeId | null;
  authorityVersion: number;
  transferPolicy: TransferPolicy;
};

export type RuntimeEntityRef =
  | ({
      id: RuntimeId;
      kind: "world-entity";
      entityIndex: number;
    } & AuthorityDescriptor)
  | ({ id: RuntimeId; kind: "player" } & AuthorityDescriptor);

export type WorldMessage<
  TEntity extends CompiledEntityCapabilities = CompiledEntityCapabilities,
> = {
  type: "world";
  protocolVersion: 7;
  worldEpoch: number;
  bundle: WorldBundle<TEntity>;
  runtimeEntities: RuntimeEntityRef[];
};

export type WorldManifestMessage = {
  type: "world";
  protocolVersion: 7;
  worldEpoch: number;
  mapRevision: string;
  bundleUrl: string;
  runtimeEntities: RuntimeEntityRef[];
};

export type LifecycleMessage = {
  type: "lifecycle";
  protocolVersion: 7;
  worldEpoch: number;
  created: RuntimeEntityRef[];
  removed: RuntimeId[];
};
