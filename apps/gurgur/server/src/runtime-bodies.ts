import type {
  BodyKind,
  PhysicsWorld,
  Quat,
  RuntimeEntityRef,
  RuntimeId,
  TransferPolicy,
  Vec3,
} from "@harrhy/gurgur-engine";
import type { WorldBundle } from "@harrhy/gurgur-game";
import type { PersistedWorld } from "./store";

export type RuntimeBody = {
  handle: RuntimeId;
  id: RuntimeId;
  entityIndex: number;
  authoredId: string;
  ownerPlayerId: RuntimeId | null;
  authorityVersion: number;
  stateSequence: number;
  transferPolicy: TransferPolicy;
};

export function runtimeBodyRef(body: RuntimeBody): RuntimeEntityRef {
  return {
    id: body.id,
    kind: "world-entity",
    entityIndex: body.entityIndex,
    ownerPlayerId: body.ownerPlayerId ? { ...body.ownerPlayerId } : null,
    authorityVersion: body.authorityVersion,
    transferPolicy: body.transferPolicy,
  };
}

export function createRuntimeBodies(
  physics: PhysicsWorld,
  bundle: WorldBundle,
  restored: PersistedWorld | null,
  extraDynamicBodyCount = 0,
): RuntimeBody[] {
  const bodies = createAuthoredBodies(physics, bundle, restored);
  bodies.push(
    ...createStressBodies(physics, bundle, restored, extraDynamicBodyCount),
  );
  return bodies;
}

export function createRuntimeProp(
  physics: PhysicsWorld,
  bundle: WorldBundle,
  entityIndex: number,
  position: Vec3,
  rotation: Quat,
  authoredId: string,
): RuntimeBody {
  const entity = bundle.entities[entityIndex];
  if (!entity || entity.kind !== "physics-prop")
    throw new Error(`world entity ${entityIndex} is not a physics prop`);
  const brushIndex = entity.body.brushIndices[0];
  const firstBrush =
    brushIndex === undefined ? null : bundle.brushes[brushIndex];
  if (!firstBrush)
    throw new Error(`physics prop ${entityIndex} has no source brush`);
  const material = {
    density: entity.body.density,
    friction: entity.body.friction,
    restitution: entity.body.restitution,
  };
  const handle =
    entity.body.brushIndices.length === 1
      ? physics.createHull({
          type: "dynamic",
          position,
          rotation,
          vertices: firstBrush.localVertices,
          ...material,
        })
      : physics.createCompoundHulls({
          type: "dynamic",
          position,
          rotation,
          hulls: entity.body.brushIndices.map((index) => ({
            vertices: bundle.brushes[index]!.worldVertices.map((vertex) => ({
              x: vertex.x - firstBrush.center.x,
              y: vertex.y - firstBrush.center.y,
              z: vertex.z - firstBrush.center.z,
            })),
          })),
          ...material,
        });
  physics.setGravityScale(handle, entity.body.gravityScale);
  return networkBody(handle, entityIndex, authoredId, "fixed");
}

function createAuthoredBodies(
  physics: PhysicsWorld,
  bundle: WorldBundle,
  restored: PersistedWorld | null,
): RuntimeBody[] {
  const bodies: RuntimeBody[] = [];
  const restoredById = new Map(
    restored?.bodies.map((body) => [body.authoredId, body]),
  );
  for (const [entityIndex, entity] of bundle.entities.entries()) {
    const spec = entity.body;
    if (!spec) continue;
    if (spec.brushIndices.length === 0)
      throw new Error(
        `world entity ${entityIndex} must have at least one brush`,
      );
    const authoredId = entity.authoredId ?? `transient.entity.${entityIndex}`;
    const firstBrush = bundle.brushes[spec.brushIndices[0]!]!;
    const saved = restoredById.get(authoredId);
    const authoredPosition =
      entity.kind === "linear-mover" && entity.startOpen
        ? {
            x: firstBrush.center.x + entity.moveDirection.x * entity.distance,
            y: firstBrush.center.y + entity.moveDirection.y * entity.distance,
            z: firstBrush.center.z + entity.moveDirection.z * entity.distance,
          }
        : firstBrush.center;
    if (spec.kind === "sensor-brush") {
      const handle = physics.createSensorHulls({
        position: { x: 0, y: 0, z: 0 },
        hulls: spec.brushIndices.map((index) => ({
          vertices: bundle.brushes[index]!.worldVertices,
        })),
      });
      bodies.push(networkBody(handle, entityIndex, authoredId, "fixed"));
      continue;
    }
    const type: BodyKind =
      spec.kind === "dynamic-brush"
        ? "dynamic"
        : spec.kind === "kinematic-brush"
          ? "kinematic"
          : "static";
    const material =
      spec.kind === "dynamic-brush"
        ? {
            density: spec.density,
            friction: spec.friction,
            restitution: spec.restitution,
          }
        : entity.kind === "surface-motor"
          ? { friction: entity.friction }
          : {};
    const hulls = spec.brushIndices.map((index) => ({
      vertices: bundle.brushes[index]!.worldVertices.map((vertex) => ({
        x: vertex.x - firstBrush.center.x,
        y: vertex.y - firstBrush.center.y,
        z: vertex.z - firstBrush.center.z,
      })),
    }));
    const handle =
      spec.brushIndices.length === 1
        ? saved
          ? physics.restoreHull({
              type,
              vertices: firstBrush.localVertices,
              ...material,
              ...saved,
            })
          : physics.createHull({
              type,
              position: authoredPosition,
              vertices: firstBrush.localVertices,
              ...material,
            })
        : physics.createCompoundHulls({
            type,
            position: saved?.position ?? authoredPosition,
            rotation: saved?.rotation,
            hulls,
            ...material,
          });
    if (saved && spec.brushIndices.length > 1) {
      physics.setBodyVelocity(
        handle,
        saved.linearVelocity,
        saved.angularVelocity,
      );
      physics.setBodyAwake(handle, saved.awake);
    }
    if (spec.kind === "dynamic-brush")
      physics.setGravityScale(handle, spec.gravityScale);
    bodies.push(networkBody(handle, entityIndex, authoredId, "fixed"));
  }
  return bodies;
}

function createStressBodies(
  physics: PhysicsWorld,
  bundle: WorldBundle,
  restored: PersistedWorld | null,
  count: number,
): RuntimeBody[] {
  if (!Number.isInteger(count) || count < 0 || count > 512)
    throw new Error("extra dynamic body count must be between 0 and 512");
  if (count === 0) return [];
  const entityIndex = bundle.entities.findIndex(
    (entity) => entity.kind === "physics-prop",
  );
  const templateEntity = bundle.entities[entityIndex];
  if (!templateEntity || templateEntity.kind !== "physics-prop")
    throw new Error("dynamic stress-body template is missing");
  const brushIndex = templateEntity.body.brushIndices[0];
  const brush = brushIndex === undefined ? null : bundle.brushes[brushIndex];
  if (!brush) throw new Error("dynamic stress-body template brush is missing");
  const restoredById = new Map(
    restored?.bodies.map((body) => [body.authoredId, body]),
  );
  return Array.from({ length: count }, (_, index) => {
    const authoredId = `stress.dynamic.${index.toString().padStart(3, "0")}`;
    const saved = restoredById.get(authoredId);
    const position = {
      x: 2 + (index % 8) * 3,
      y: 1 + Math.floor(index / 32) * 1.3,
      z: -18 + (Math.floor(index / 8) % 4) * 3,
    };
    const handle = saved
      ? physics.restoreHull({
          type: "dynamic",
          vertices: brush.localVertices,
          density: templateEntity.body.density,
          friction: templateEntity.body.friction,
          restitution: templateEntity.body.restitution,
          ...saved,
        })
      : physics.createHull({
          type: "dynamic",
          position,
          vertices: brush.localVertices,
          density: templateEntity.body.density,
          friction: templateEntity.body.friction,
          restitution: templateEntity.body.restitution,
        });
    physics.setGravityScale(handle, templateEntity.body.gravityScale);
    return networkBody(handle, entityIndex, authoredId, "fixed");
  });
}

function networkBody(
  handle: RuntimeId,
  entityIndex: number,
  authoredId: string,
  transferPolicy: TransferPolicy,
): RuntimeBody {
  return {
    id: handle,
    handle,
    entityIndex,
    authoredId,
    ownerPlayerId: null,
    authorityVersion: 1,
    stateSequence: 0,
    transferPolicy,
  };
}
