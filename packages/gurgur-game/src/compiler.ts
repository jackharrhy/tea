import { createHash, randomUUID } from "node:crypto";
import {
  entityDefinitions,
  type AuthoredOutputConnection,
  type EntityClassname,
} from "./entities";
import { SKIP_MATERIAL } from "./materials";
import {
  parseValve220,
  type MapBrush,
  type ValveMap,
} from "@tea/gurgur-engine";
import {
  deriveWorldBuffers,
  type CompiledBrush,
  type PlayerSpawn,
  type ResetMarker,
  type Vec2,
  type Vec3,
  type WorldSettings,
} from "@tea/gurgur-engine";
import {
  encodeWorldBundle,
  entityInputDomain,
  type CompiledGameEntity,
  type OutputConnection,
  type PhysicsJointEntity,
  type TriggerEntity,
  type WorldBundle,
} from "./world";

export const METRES_PER_MAP_UNIT = 0.0254;
const EPSILON = 1e-5;

export type AddedAuthoredId = {
  classname: EntityClassname;
  authoredId: string;
  line: number;
};

export function addMissingAuthoredIds(
  source: string,
  sourceName = "<map>",
  createId: (classname: EntityClassname) => string = (classname) =>
    `auto.${classname}.${randomUUID()}`,
): { source: string; added: AddedAuthoredId[] } {
  const map = parseValve220(source, sourceName);
  const knownIds = new Set(
    map.entities.flatMap((entity) =>
      entity.properties.authoredId ? [entity.properties.authoredId] : [],
    ),
  );
  const added: AddedAuthoredId[] = [];
  for (const entity of map.entities) {
    const classname = entity.properties.classname as EntityClassname;
    const definition = entityDefinitions[classname];
    if (
      !definition ||
      !definition.editor.persistent ||
      entity.properties.authoredId
    )
      continue;
    let authoredId = createId(classname);
    while (!authoredId || knownIds.has(authoredId))
      authoredId = createId(classname);
    knownIds.add(authoredId);
    added.push({ classname, authoredId, line: entity.line });
  }
  if (added.length === 0) return { source, added };

  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = source.endsWith("\n");
  const lines = source.split(/\r?\n/);
  if (trailingNewline) lines.pop();
  for (const addition of added.toSorted(
    (left, right) => right.line - left.line,
  )) {
    const entityStart = addition.line - 1;
    const classnameLine = lines.findIndex(
      (line, index) =>
        index > entityStart &&
        /^\s*"classname"\s+"(?:\\.|[^"\\])*"\s*(?:\/\/.*)?$/.test(line),
    );
    if (classnameLine < 0) {
      throw new Error(
        `${sourceName}:${addition.line}: cannot locate classname property`,
      );
    }
    const indentation = lines[classnameLine]!.match(/^\s*/)?.[0] ?? "";
    lines.splice(
      classnameLine + 1,
      0,
      `${indentation}"authoredId" "${addition.authoredId}"`,
    );
  }
  return {
    source: `${lines.join(newline)}${trailingNewline ? newline : ""}`,
    added,
  };
}

type Plane = { normal: Vec3; distance: number; sourceFace: number };
const add = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});
const subtract = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const scale = (v: Vec3, amount: number): Vec3 => ({
  x: v.x * amount,
  y: v.y * amount,
  z: v.z * amount,
});
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const length = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
const normalize = (v: Vec3): Vec3 => scale(v, 1 / length(v));

export function mapToWorld({ x, y, z }: Vec3): Vec3 {
  return {
    x: canonicalZero(x * METRES_PER_MAP_UNIT),
    y: canonicalZero(z * METRES_PER_MAP_UNIT),
    z: canonicalZero(-y * METRES_PER_MAP_UNIT),
  };
}

function canonicalZero(value: number): number {
  return value === 0 ? 0 : value;
}

function intersect(a: Plane, b: Plane, c: Plane): Vec3 | null {
  const bCrossC = cross(b.normal, c.normal);
  const determinant = dot(a.normal, bCrossC);
  if (Math.abs(determinant) < 1e-9) return null;
  return scale(
    add(
      add(
        scale(bCrossC, a.distance),
        scale(cross(c.normal, a.normal), b.distance),
      ),
      scale(cross(a.normal, b.normal), c.distance),
    ),
    1 / determinant,
  );
}

function uniqueVertices(vertices: Vec3[]): Vec3[] {
  const unique: Vec3[] = [];
  for (const vertex of vertices) {
    if (!unique.some((other) => length(subtract(vertex, other)) < EPSILON))
      unique.push(vertex);
  }
  return unique.toSorted((a, b) => a.x - b.x || a.y - b.y || a.z - b.z);
}

function compileBrush(
  brush: MapBrush,
  entityIndex: number,
  diagnosticEntityIndex: number,
  sourceBrushIndex: number,
): CompiledBrush {
  const authoredPlanes = brush.faces.map((face, sourceFace): Plane => {
    const [a, b, c] = face.points;
    const edgeCross = cross(subtract(b, a), subtract(c, a));
    if (length(edgeCross) < 1e-9)
      throw new Error(
        geometryDiagnostic(
          face.line,
          face.column,
          diagnosticEntityIndex,
          sourceBrushIndex,
          "degenerate plane",
          face.faceIndex,
        ),
      );
    const normal = normalize(edgeCross);
    const distance = dot(normal, a);
    return { normal, distance, sourceFace };
  });
  const orientations = [
    authoredPlanes,
    authoredPlanes.map((plane) => ({
      ...plane,
      normal: scale(plane.normal, -1),
      distance: -plane.distance,
    })),
  ];
  let selected: { planes: Plane[]; mapVertices: Vec3[] } | null = null;
  let incomplete: { planes: Plane[]; mapVertices: Vec3[] } | null = null;
  for (const planes of orientations) {
    const candidates: Vec3[] = [];
    for (let a = 0; a < planes.length - 2; a += 1) {
      for (let b = a + 1; b < planes.length - 1; b += 1) {
        for (let c = b + 1; c < planes.length; c += 1) {
          const point = intersect(planes[a]!, planes[b]!, planes[c]!);
          if (
            point &&
            planes.every(
              (plane) => dot(plane.normal, point) <= plane.distance + EPSILON,
            )
          ) {
            candidates.push(point);
          }
        }
      }
    }
    const mapVertices = uniqueVertices(candidates);
    if (mapVertices.length < 4) continue;
    const complete = planes.every(
      (plane) =>
        mapVertices.filter(
          (vertex) =>
            Math.abs(dot(plane.normal, vertex) - plane.distance) < EPSILON,
        ).length >= 3,
    );
    if (complete) {
      selected = { planes, mapVertices };
      break;
    }
    incomplete ??= { planes, mapVertices };
  }
  if (!selected && !incomplete)
    throw new Error(
      geometryDiagnostic(
        brush.line,
        brush.column,
        diagnosticEntityIndex,
        sourceBrushIndex,
        "no finite convex volume",
      ),
    );
  const { planes, mapVertices } = selected ?? incomplete!;
  const collisionOnlyFaceIndices = brush.faces
    .filter((face) => face.material === SKIP_MATERIAL)
    .map((face) => face.faceIndex);
  const triangles: Array<[number, number, number]> = [];
  const triangleMaterials: string[] = [];
  const triangleSourceFaces: number[] = [];
  const triangleNormals: Vec3[] = [];
  const triangleUvs: Array<[Vec2, Vec2, Vec2]> = [];
  for (const plane of planes) {
    const indices = mapVertices
      .map((vertex, index) => ({ vertex, index }))
      .filter(
        ({ vertex }) =>
          Math.abs(dot(plane.normal, vertex) - plane.distance) < EPSILON,
      );
    if (indices.length < 3)
      throw new Error(
        geometryDiagnostic(
          brush.line,
          brush.column,
          diagnosticEntityIndex,
          sourceBrushIndex,
          "invalid face",
          plane.sourceFace,
        ),
      );
    const center = scale(
      indices.reduce((sum, item) => add(sum, item.vertex), {
        x: 0,
        y: 0,
        z: 0,
      }),
      1 / indices.length,
    );
    const reference: Vec3 =
      Math.abs(plane.normal.y) < 0.9
        ? { x: 0, y: 1, z: 0 }
        : { x: 1, y: 0, z: 0 };
    const u = normalize(cross(reference, plane.normal));
    const v = cross(plane.normal, u);
    indices.sort((left, right) => {
      const lp = subtract(left.vertex, center);
      const rp = subtract(right.vertex, center);
      return (
        Math.atan2(dot(lp, v), dot(lp, u)) - Math.atan2(dot(rp, v), dot(rp, u))
      );
    });
    for (let index = 1; index < indices.length - 1; index += 1) {
      const triangle: [number, number, number] = [
        indices[0]!.index,
        indices[index]!.index,
        indices[index + 1]!.index,
      ];
      triangles.push(triangle);
      const face = brush.faces[plane.sourceFace]!;
      triangleMaterials.push(face.material);
      triangleSourceFaces.push(face.faceIndex);
      triangleUvs.push(
        triangle.map((vertexIndex) =>
          valveUv(mapVertices[vertexIndex]!, face),
        ) as [Vec2, Vec2, Vec2],
      );
    }
  }
  const worldVertices = mapVertices.map(mapToWorld);
  for (const triangle of triangles) {
    const [a, b, c] = triangle.map((index) => worldVertices[index]!) as [
      Vec3,
      Vec3,
      Vec3,
    ];
    triangleNormals.push(normalize(cross(subtract(b, a), subtract(c, a))));
  }
  const center = scale(
    worldVertices.reduce(add, { x: 0, y: 0, z: 0 }),
    1 / worldVertices.length,
  );
  return {
    entityIndex,
    sourceBrushIndex,
    center,
    collisionOnlyFaceIndices,
    worldVertices,
    localVertices: worldVertices.map((vertex) => subtract(vertex, center)),
    triangles,
    triangleMaterials,
    triangleSourceFaces,
    triangleNormals,
    triangleUvs,
  };
}

function valveUv(point: Vec3, face: MapBrush["faces"][number]): Vec2 {
  const uScale = face.scale[0];
  const vScale = face.scale[1];
  if (Math.abs(uScale) < 1e-12 || Math.abs(vScale) < 1e-12) {
    throw new Error(
      `face at line ${face.line}, column ${face.column} has zero texture scale`,
    );
  }
  return {
    x:
      (point.x * face.uAxis[0] +
        point.y * face.uAxis[1] +
        point.z * face.uAxis[2]) /
        uScale +
      face.uAxis[3],
    y:
      (point.x * face.vAxis[0] +
        point.y * face.vAxis[1] +
        point.z * face.vAxis[2]) /
        vScale +
      face.vAxis[3],
  };
}

function validateMap(map: ValveMap): void {
  if (map.entities[0]?.properties.classname !== "worldspawn")
    throw new Error(`${map.sourceName}: first entity must be worldspawn`);
  if (map.entities[0].properties.mapversion !== "220")
    throw new Error(`${map.sourceName}: mapversion must be 220`);
  const ids = new Set<string>();
  const targets = new Set<string>();
  for (const entity of map.entities)
    if (entity.properties.targetname) targets.add(entity.properties.targetname);
  for (const entity of map.entities) {
    const classname = entity.properties.classname as EntityClassname;
    const definition = entityDefinitions[classname];
    if (!definition)
      throw new Error(
        `${map.sourceName}:${entity.line}: unknown classname ${classname}`,
      );
    if (definition.editor.kind === "point" && entity.brushes.length !== 0)
      throw new Error(`line ${entity.line}: point entity has brushes`);
    if (definition.editor.kind === "solid" && entity.brushes.length === 0)
      throw new Error(`line ${entity.line}: solid entity has no brushes`);
    const allowed = new Set([
      "classname",
      "origin",
      ...(definition.editor.persistent ? ["authoredId"] : []),
      ...Object.keys(definition.properties),
    ]);
    for (const name of Object.keys(entity.properties)) {
      if (!allowed.has(name))
        throw new Error(
          `line ${entity.line}: unknown ${classname} property ${name}`,
        );
    }
    if (definition.editor.persistent) {
      const id = entity.properties.authoredId;
      if (!id)
        throw new Error(
          `line ${entity.line}: ${classname} requires authoredId`,
        );
      if (ids.has(id))
        throw new Error(`line ${entity.line}: duplicate authoredId ${id}`);
      ids.add(id);
    }
    for (const [propertyName, property] of Object.entries(
      definition.properties,
    )) {
      if (property.editor.type !== "target") continue;
      const target = entity.properties[propertyName];
      if (target && !targets.has(target))
        throw new Error(`line ${entity.line}: unresolved target ${target}`);
    }
  }
}

function geometryDiagnostic(
  line: number,
  column: number,
  entityIndex: number,
  brushIndex: number,
  message: string,
  faceIndex?: number,
): string {
  const face = faceIndex === undefined ? "" : `, face ${faceIndex}`;
  const location = `line ${line}, column ${column}, entity ${entityIndex}, brush ${brushIndex}`;
  return `${location}${face}: ${message}`;
}

function parseOrigin(value: string | undefined): Vec3 | undefined {
  if (!value) return undefined;
  const [x, y, z] = value.split(/\s+/).map(Number);
  if (![x, y, z].every(Number.isFinite))
    throw new Error(`invalid entity origin ${value}`);
  return mapToWorld({ x: x!, y: y!, z: z! });
}

export function compileWorld(source: string, sourceName: string): WorldBundle {
  const map = parseValve220(source, sourceName);
  validateMap(map);
  const brushes: CompiledBrush[] = [];
  const entities: CompiledGameEntity[] = [];
  const playerSpawns: PlayerSpawn[] = [];
  const resetMarkers: ResetMarker[] = [];
  const targetEntityIndices = new Map<string, number[]>();
  const pendingTriggerOutputs: Array<{
    entityIndex: number;
    line: number;
    enter: AuthoredOutputConnection;
    exit?: AuthoredOutputConnection;
  }> = [];
  const pendingPhysicsJoints: Array<{
    entityIndex: number;
    line: number;
    attach1: string;
    attach2?: string;
    worldFrame: {
      position: Vec3;
      rotation: { x: number; y: number; z: number; w: number };
    };
    secondWorldPosition?: Vec3;
  }> = [];
  let settings: WorldSettings | undefined;
  let worldspawnCount = 0;
  for (const [sourceEntityIndex, entity] of map.entities.entries()) {
    const classname = entity.properties.classname as EntityClassname;
    const definition = entityDefinitions[classname];
    const outputEntityIndex = classname === "worldspawn" ? -1 : entities.length;
    const brushIndices = entity.brushes.map((brush, sourceBrushIndex) => {
      const index = brushes.length;
      brushes.push(
        compileBrush(
          brush,
          outputEntityIndex,
          sourceEntityIndex,
          sourceBrushIndex,
        ),
      );
      return index;
    });
    const origin = parseOrigin(entity.properties.origin);
    const context = {
      sourceName,
      line: entity.line,
      classname,
      authoredId: entity.properties.authoredId,
      brushIndices,
      ...(origin ? { origin } : {}),
    };
    const compiled = definition.compileRaw(context, entity.properties);
    if (compiled.kind === "world-settings") {
      worldspawnCount += 1;
      settings = compiled.settings;
    } else if (compiled.kind === "player-spawn") {
      playerSpawns.push(compiled.spawn);
    } else if (compiled.kind === "reset-marker") {
      resetMarkers.push(compiled.marker);
    } else if (compiled.kind === "connected-trigger") {
      const entityIndex = entities.length;
      entities.push({
        ...compiled.entity,
        outputs: {
          enter: {
            targetEntityIndices: [],
            input: compiled.outputs.enter.input,
          },
        },
      });
      pendingTriggerOutputs.push({
        entityIndex,
        line: entity.line,
        ...compiled.outputs,
      });
      addTargetEntityIndex(
        targetEntityIndices,
        entity.properties.targetname,
        entityIndex,
      );
    } else if (compiled.kind === "connected-physics-joint") {
      const entityIndex = entities.length;
      entities.push({
        ...compiled.entity,
        attachmentAEntityIndex: -1,
        attachmentBEntityIndex: null,
        localFrameA: compiled.worldFrame,
        localFrameB: {
          position:
            compiled.secondWorldPosition ?? compiled.worldFrame.position,
          rotation: compiled.worldFrame.rotation,
        },
      } as PhysicsJointEntity);
      pendingPhysicsJoints.push({
        entityIndex,
        line: entity.line,
        attach1: compiled.attach1,
        ...(compiled.attach2 ? { attach2: compiled.attach2 } : {}),
        worldFrame: compiled.worldFrame,
        ...(compiled.secondWorldPosition
          ? { secondWorldPosition: compiled.secondWorldPosition }
          : {}),
      });
      addTargetEntityIndex(
        targetEntityIndices,
        entity.properties.targetname,
        entityIndex,
      );
    } else {
      const entityIndex = entities.length;
      entities.push(compiled.entity);
      addTargetEntityIndex(
        targetEntityIndices,
        entity.properties.targetname,
        entityIndex,
      );
    }
  }
  if (worldspawnCount !== 1)
    throw new Error(
      `${sourceName}: expected exactly one worldspawn, found ${worldspawnCount}`,
    );
  if (!settings)
    throw new Error(`${sourceName}: worldspawn settings are missing`);
  if (playerSpawns.length === 0)
    throw new Error(`${sourceName}: requires at least one player spawn`);
  const spawnNames = new Set<string>();
  for (const spawn of playerSpawns) {
    if (spawnNames.has(spawn.name))
      throw new Error(
        `${sourceName}: duplicate player spawn name ${spawn.name}`,
      );
    spawnNames.add(spawn.name);
  }
  if (playerSpawns.filter((spawn) => spawn.name === "default").length !== 1)
    throw new Error(
      `${sourceName}: expected exactly one player spawn named default`,
    );
  for (const pending of pendingTriggerOutputs) {
    const trigger = entities[pending.entityIndex] as TriggerEntity;
    trigger.outputs = {
      enter: resolveOutputConnection(
        sourceName,
        pending.line,
        pending.enter,
        entities,
        targetEntityIndices,
      ),
      ...(pending.exit
        ? {
            exit: resolveOutputConnection(
              sourceName,
              pending.line,
              pending.exit,
              entities,
              targetEntityIndices,
            ),
          }
        : {}),
    };
    validateListenerOutputPair(sourceName, pending.line, trigger, entities);
  }
  for (const pending of pendingPhysicsJoints) {
    const joint = entities[pending.entityIndex] as PhysicsJointEntity;
    const attachmentAEntityIndex = resolveJointAttachment(
      sourceName,
      pending.line,
      pending.attach1,
      entities,
      targetEntityIndices,
    );
    const attachmentBEntityIndex = pending.attach2
      ? resolveJointAttachment(
          sourceName,
          pending.line,
          pending.attach2,
          entities,
          targetEntityIndices,
        )
      : null;
    if (attachmentAEntityIndex === attachmentBEntityIndex)
      throw new Error(
        `${sourceName}:${pending.line}: constraint cannot attach a body to itself`,
      );
    const attachmentA = entities[attachmentAEntityIndex]!;
    const attachmentB =
      attachmentBEntityIndex === null
        ? null
        : entities[attachmentBEntityIndex]!;
    if (
      attachmentA.body?.kind !== "dynamic-brush" &&
      attachmentB?.body?.kind !== "dynamic-brush"
    )
      throw new Error(
        `${sourceName}:${pending.line}: constraint graph must include a dynamic body`,
      );
    for (const attachment of [attachmentA, attachmentB]) {
      if (
        attachment?.body?.kind === "dynamic-brush" &&
        attachment.interaction === "grab"
      )
        throw new Error(
          `${sourceName}:${pending.line}: jointed func_physics ${attachment.authoredId} must explicitly set grabbable 0`,
        );
    }
    joint.attachmentAEntityIndex = attachmentAEntityIndex;
    joint.attachmentBEntityIndex = attachmentBEntityIndex;
    joint.localFrameA = localJointFrame(
      bundleBodyOrigin(attachmentA, brushes),
      pending.worldFrame,
    );
    joint.localFrameB =
      attachmentB === null
        ? {
            position:
              pending.secondWorldPosition ?? pending.worldFrame.position,
            rotation: pending.worldFrame.rotation,
          }
        : localJointFrame(bundleBodyOrigin(attachmentB, brushes), {
            position:
              pending.secondWorldPosition ?? pending.worldFrame.position,
            rotation: pending.worldFrame.rotation,
          });
  }
  const derived = deriveWorldBuffers(brushes, entities);
  const bundle: WorldBundle = {
    bundleVersion: 1,
    mapRevision: "0".repeat(64),
    sourceName,
    settings,
    playerSpawns,
    resetMarkers,
    entities,
    brushes,
    ...derived,
  };
  bundle.mapRevision = createHash("sha256")
    .update(encodeWorldBundle(bundle))
    .digest("hex");
  return bundle;
}

function resolveJointAttachment(
  sourceName: string,
  line: number,
  targetName: string,
  entities: CompiledGameEntity[],
  targetEntityIndices: Map<string, number[]>,
): number {
  const indices = targetEntityIndices.get(targetName) ?? [];
  if (indices.length !== 1)
    throw new Error(
      `${sourceName}:${line}: constraint attachment ${targetName} must resolve to exactly one entity`,
    );
  const index = indices[0]!;
  const entity = entities[index]!;
  if (!entity.body || entity.body.kind === "sensor-brush")
    throw new Error(
      `${sourceName}:${line}: constraint attachment ${targetName} must be a non-sensor body`,
    );
  return index;
}

function bundleBodyOrigin(
  entity: CompiledGameEntity,
  brushes: CompiledBrush[],
): Vec3 {
  if (!entity.body || entity.body.brushIndices.length === 0)
    throw new Error("constraint body has no compiled brushes");
  const brush = brushes[entity.body.brushIndices[0]!];
  if (!brush) throw new Error("constraint body brush is missing");
  if (entity.kind === "linear-mover" && entity.startOpen)
    return {
      x: brush.center.x + entity.moveDirection.x * entity.distance,
      y: brush.center.y + entity.moveDirection.y * entity.distance,
      z: brush.center.z + entity.moveDirection.z * entity.distance,
    };
  return brush.center;
}

function localJointFrame(
  bodyPosition: Vec3,
  frame: {
    position: Vec3;
    rotation: { x: number; y: number; z: number; w: number };
  },
) {
  return {
    position: subtract(frame.position, bodyPosition),
    rotation: { ...frame.rotation },
  };
}

function addTargetEntityIndex(
  targetEntityIndices: Map<string, number[]>,
  targetName: string | undefined,
  entityIndex: number,
): void {
  if (!targetName) return;
  const indices = targetEntityIndices.get(targetName) ?? [];
  indices.push(entityIndex);
  targetEntityIndices.set(targetName, indices);
}

function resolveOutputConnection(
  sourceName: string,
  line: number,
  authored: AuthoredOutputConnection,
  entities: CompiledGameEntity[],
  targetEntityIndices: Map<string, number[]>,
): OutputConnection {
  const indices = targetEntityIndices.get(authored.target);
  if (!indices?.length)
    throw new Error(
      `${sourceName}:${line}: unresolved target ${authored.target}`,
    );
  for (const index of indices) {
    const target = entities[index]!;
    if (!entityInputDomain(target, authored.input))
      throw new Error(
        `${sourceName}:${line}: ${target.kind} target ${authored.target} does not support input ${authored.input}`,
      );
  }
  return { targetEntityIndices: [...indices], input: authored.input };
}

function validateListenerOutputPair(
  sourceName: string,
  line: number,
  trigger: TriggerEntity,
  entities: CompiledGameEntity[],
): void {
  const enterDomain = connectionDomain(trigger.outputs.enter, entities);
  const exitDomain = trigger.outputs.exit
    ? connectionDomain(trigger.outputs.exit, entities)
    : null;
  if (enterDomain !== "listener" && exitDomain !== "listener") return;
  if (
    trigger.outputs.enter.input !== "play" ||
    trigger.outputs.exit?.input !== "stop" ||
    trigger.outputs.enter.targetEntityIndices.length !==
      trigger.outputs.exit.targetEntityIndices.length ||
    trigger.outputs.enter.targetEntityIndices.some(
      (target, index) =>
        trigger.outputs.exit!.targetEntityIndices[index] !== target,
    )
  ) {
    throw new Error(
      `${sourceName}:${line}: listener outputs must pair play on enter with stop on exit for the same targets`,
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
