import { cross, normalize } from "./math.js";
import type {
  BrushId,
  EntityId,
  IdFactory,
  MapBrush,
  MapDocument,
  MapEntity,
  MapFace,
  TextureProjection,
  Vec3,
} from "./types.js";
import { createSequentialIdFactory } from "./types.js";
import { translateBrush } from "./brush-transforms.js";
import { mapTriple } from "./document-helpers.js";

export interface BrushInsertion {
  readonly entityId: EntityId;
  readonly insertionIndex: number;
  readonly brush: MapBrush;
}

export interface BrushSequenceReplacement {
  readonly entityId: EntityId;
  readonly insertionIndex: number;
  readonly expectedBrushIds: readonly BrushId[];
  readonly replacements: readonly MapBrush[];
}

export function insertEntity(
  document: MapDocument,
  entity: MapEntity,
  index?: number,
): MapDocument {
  if (document.entities.some((candidate) => candidate.id === entity.id)) {
    throw new Error(`Entity ${entity.id} already exists`);
  }
  const insertionIndex = index ?? document.entities.length;
  if (
    !Number.isInteger(insertionIndex) ||
    insertionIndex < 1 ||
    insertionIndex > document.entities.length
  ) {
    throw new Error(`Invalid entity insertion index ${insertionIndex}`);
  }
  return {
    ...document,
    revision: document.revision + 1,
    entities: [
      ...document.entities.slice(0, insertionIndex),
      entity,
      ...document.entities.slice(insertionIndex),
    ],
  };
}

export function replaceEntities(
  document: MapDocument,
  replacements: readonly MapEntity[],
): MapDocument {
  if (replacements.length === 0) return document;
  const byId = new Map(
    replacements.map((entity) => [entity.id, entity] as const),
  );
  if (byId.size !== replacements.length)
    throw new Error("Entity replacements must be unique");
  const found = new Set<EntityId>();
  const entities = document.entities.map((entity) => {
    const replacement = byId.get(entity.id);
    if (!replacement) return entity;
    found.add(entity.id);
    return replacement;
  });
  for (const entityId of byId.keys()) {
    if (!found.has(entityId)) throw new Error(`Unknown entity ${entityId}`);
  }
  return { ...document, revision: document.revision + 1, entities };
}

export function removeEntities(
  document: MapDocument,
  entityIds: readonly EntityId[],
): MapDocument {
  const ids = new Set(entityIds);
  if (ids.size === 0) return document;
  if (ids.size !== entityIds.length)
    throw new Error("Entity ids must be unique");
  const worldspawn = document.entities[0];
  if (worldspawn && ids.has(worldspawn.id))
    throw new Error("Worldspawn cannot be removed");
  for (const entityId of ids) {
    if (!document.entities.some((entity) => entity.id === entityId)) {
      throw new Error(`Unknown entity ${entityId}`);
    }
  }
  return {
    ...document,
    revision: document.revision + 1,
    entities: document.entities.filter((entity) => !ids.has(entity.id)),
  };
}

export function moveBrushesToEntity(
  document: MapDocument,
  brushIds: readonly BrushId[],
  targetEntityId: EntityId,
  clearContents = false,
): MapDocument {
  const selected = new Set(brushIds);
  if (selected.size === 0) return document;
  if (selected.size !== brushIds.length)
    throw new Error("Brush ids must be unique");
  const target = document.entities.find(
    (entity) => entity.id === targetEntityId,
  );
  if (!target) throw new Error(`Unknown entity ${targetEntityId}`);
  const moved = document.entities.flatMap((entity) =>
    entity.primitives.filter(
      (primitive): primitive is MapBrush =>
        primitive.kind === "brush" && selected.has(primitive.id),
    ),
  );
  if (moved.length !== selected.size)
    throw new Error("The brush selection contains an unknown brush");
  const normalizedMoved = clearContents
    ? moved.map<MapBrush>((brush) => ({
        ...brush,
        revision: brush.revision + 1,
        faces: brush.faces.map((face) => {
          const surface = { ...face.surface };
          delete surface.contents;
          return { ...face, surface };
        }),
      }))
    : moved;
  const entities = document.entities
    .map<MapEntity>((entity) => ({
      ...entity,
      primitives: [
        ...entity.primitives.filter(
          (primitive) =>
            primitive.kind !== "brush" || !selected.has(primitive.id),
        ),
        ...(entity.id === targetEntityId ? normalizedMoved : []),
      ],
    }))
    .filter(
      (entity, index) =>
        index === 0 ||
        entity.primitives.length > 0 ||
        "origin" in entity.properties,
    );
  return { ...document, revision: document.revision + 1, entities };
}

export function createBrushEntity(
  document: MapDocument,
  brushIds: readonly BrushId[],
  entity: MapEntity,
): MapDocument {
  if (entity.primitives.length > 0)
    throw new Error("A new brush entity must not contain brushes yet");
  if (!entity.properties.classname?.trim())
    throw new Error("A brush entity requires a classname");
  const inserted = insertEntity(document, entity);
  return {
    ...moveBrushesToEntity(inserted, brushIds, entity.id),
    revision: document.revision + 1,
  };
}

function facePoints(
  point: Vec3,
  normal: Vec3,
  size: number,
): readonly [Vec3, Vec3, Vec3] {
  const helper: Vec3 = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const firstAxis = normalize(cross(helper, normal)) ?? [1, 0, 0];
  const secondAxis = cross(firstAxis, normal);
  return [
    point,
    [
      point[0] + firstAxis[0] * size,
      point[1] + firstAxis[1] * size,
      point[2] + firstAxis[2] * size,
    ],
    [
      point[0] + secondAxis[0] * size,
      point[1] + secondAxis[1] * size,
      point[2] + secondAxis[2] * size,
    ],
  ];
}

export function defaultTextureProjection(normal: Vec3): TextureProjection {
  const axisEpsilon = 1e-6;
  const absolute: Vec3 = [
    Math.abs(normal[0]),
    Math.abs(normal[1]),
    Math.abs(normal[2]),
  ];
  if (absolute[2] + axisEpsilon >= Math.max(absolute[0], absolute[1])) {
    return {
      kind: "valve-220",
      uAxis: [1, 0, 0],
      vAxis: [0, -1, 0],
      offset: [0, 0],
      rotationDegrees: 0,
      scale: [1, 1],
    };
  }
  if (absolute[0] + axisEpsilon >= absolute[1]) {
    return {
      kind: "valve-220",
      uAxis: [0, 1, 0],
      vAxis: [0, 0, -1],
      offset: [0, 0],
      rotationDegrees: 0,
      scale: [1, 1],
    };
  }
  return {
    kind: "valve-220",
    uAxis: [1, 0, 0],
    vAxis: [0, 0, -1],
    offset: [0, 0],
    rotationDegrees: 0,
    scale: [1, 1],
  };
}

export function createBoxBrush(
  minimum: Vec3,
  maximum: Vec3,
  material = "DEV/GRID",
  ids: IdFactory = createSequentialIdFactory("box"),
): MapBrush {
  const size = Math.max(
    maximum[0] - minimum[0],
    maximum[1] - minimum[1],
    maximum[2] - minimum[2],
    1,
  );
  const definitions: readonly { point: Vec3; normal: Vec3 }[] = [
    { point: [maximum[0], minimum[1], minimum[2]], normal: [1, 0, 0] },
    { point: [minimum[0], minimum[1], minimum[2]], normal: [-1, 0, 0] },
    { point: [minimum[0], maximum[1], minimum[2]], normal: [0, 1, 0] },
    { point: [minimum[0], minimum[1], minimum[2]], normal: [0, -1, 0] },
    { point: [minimum[0], minimum[1], maximum[2]], normal: [0, 0, 1] },
    { point: [minimum[0], minimum[1], minimum[2]], normal: [0, 0, -1] },
  ];
  return {
    kind: "brush",
    id: ids.brush(),
    revision: 0,
    faces: definitions.map<MapFace>(({ point, normal }) => ({
      id: ids.face(),
      planePoints: facePoints(point, normal, size),
      material,
      projection: defaultTextureProjection(normal),
      surface: {},
    })),
  };
}

export function cloneBrush(
  source: MapBrush,
  ids: IdFactory,
  delta: Vec3 = [0, 0, 0],
  textureLock = true,
): MapBrush {
  const clone: MapBrush = {
    ...source,
    id: ids.brush(),
    revision: 0,
    faces: source.faces.map((face) => ({
      ...face,
      id: ids.face(),
      planePoints: mapTriple(face.planePoints, (point) => [
        point[0],
        point[1],
        point[2],
      ]),
      projection: {
        ...face.projection,
        uAxis: [...face.projection.uAxis] as Vec3,
        vAxis: [...face.projection.vAxis] as Vec3,
        offset: [...face.projection.offset] as readonly [number, number],
        scale: [...face.projection.scale] as readonly [number, number],
      },
      surface: { ...face.surface },
    })),
  };
  if (delta.every((component) => Math.abs(component) <= Number.EPSILON))
    return clone;
  return { ...translateBrush(clone, delta, textureLock), revision: 0 };
}

export function createStarterDocument(): MapDocument {
  const ids = createSequentialIdFactory("starter");
  const worldspawn: MapEntity = {
    id: ids.entity(),
    properties: {
      classname: "worldspawn",
      message: "Worldview editor starter",
      light: "96",
    },
    primitives: [
      createBoxBrush([-128, -128, -32], [128, 128, 0], "DEV_FLOOR", ids),
      createBoxBrush([-96, -32, 0], [-32, 32, 96], "DEV_PILLAR", ids),
      createBoxBrush([32, -32, 0], [96, 32, 160], "DEV_PILLAR", ids),
    ],
  };
  const playerStart: MapEntity = {
    id: ids.entity(),
    properties: {
      classname: "info_player_start",
      origin: "0 -96 24",
      angle: "90",
    },
    primitives: [],
  };
  const light: MapEntity = {
    id: ids.entity(),
    properties: {
      classname: "light",
      origin: "0 -48 144",
      light: "400",
    },
    primitives: [],
  };
  return {
    id: ids.document(),
    revision: 0,
    format: "quake-map",
    faceSyntax: "valve-220",
    entities: [worldspawn, playerStart, light],
  };
}

export function createEmptyDocument(): MapDocument {
  const ids = createSequentialIdFactory("empty");
  return {
    id: ids.document(),
    revision: 0,
    format: "quake-map",
    faceSyntax: "valve-220",
    entities: [
      {
        id: ids.entity(),
        properties: { classname: "worldspawn" },
        primitives: [],
      },
    ],
  };
}

export function replaceBrush(
  document: MapDocument,
  replacement: MapBrush,
): MapDocument {
  let found = false;
  const entities = document.entities.map((entity) => {
    if (!entity.primitives.some((brush) => brush.id === replacement.id))
      return entity;
    found = true;
    return {
      ...entity,
      primitives: entity.primitives.map((brush) =>
        brush.id === replacement.id ? replacement : brush,
      ),
    };
  });
  if (!found) throw new Error(`Unknown brush ${replacement.id}`);
  return { ...document, revision: document.revision + 1, entities };
}

export function replaceBrushes(
  document: MapDocument,
  replacements: readonly MapBrush[],
): MapDocument {
  if (replacements.length === 0) return document;
  const byId = new Map(replacements.map((brush) => [brush.id, brush] as const));
  const found = new Set<BrushId>();
  const entities = document.entities.map((entity) => ({
    ...entity,
    primitives: entity.primitives.map((brush) => {
      const replacement = byId.get(brush.id);
      if (!replacement) return brush;
      found.add(brush.id);
      return replacement;
    }),
  }));
  for (const brushId of byId.keys()) {
    if (!found.has(brushId)) throw new Error(`Unknown brush ${brushId}`);
  }
  return { ...document, revision: document.revision + 1, entities };
}

export function replaceBrushSequence(
  document: MapDocument,
  entityId: EntityId,
  insertionIndex: number,
  expectedBrushIds: readonly BrushId[],
  replacements: readonly MapBrush[],
): MapDocument {
  return replaceBrushSequences(document, [
    { entityId, insertionIndex, expectedBrushIds, replacements },
  ]);
}

export function replaceBrushSequences(
  document: MapDocument,
  sequences: readonly BrushSequenceReplacement[],
): MapDocument {
  if (sequences.length === 0) return document;
  const byEntity = new Map<EntityId, BrushSequenceReplacement[]>();
  const removedIds = new Set<BrushId>();
  for (const sequence of sequences) {
    const entity = document.entities.find(
      (candidate) => candidate.id === sequence.entityId,
    );
    if (!entity) throw new Error(`Unknown entity ${sequence.entityId}`);
    if (
      !Number.isInteger(sequence.insertionIndex) ||
      sequence.insertionIndex < 0
    ) {
      throw new Error(
        `Invalid brush insertion index ${sequence.insertionIndex}`,
      );
    }
    const actual = entity.primitives
      .slice(
        sequence.insertionIndex,
        sequence.insertionIndex + sequence.expectedBrushIds.length,
      )
      .map((brush) => brush.id);
    if (
      actual.length !== sequence.expectedBrushIds.length ||
      actual.some(
        (brushId, index) => brushId !== sequence.expectedBrushIds[index],
      )
    ) {
      throw new Error("The brush sequence changed before it could be replaced");
    }
    for (const brushId of sequence.expectedBrushIds) {
      if (removedIds.has(brushId))
        throw new Error(`Brush ${brushId} is replaced more than once`);
      removedIds.add(brushId);
    }
    const entitySequences = byEntity.get(sequence.entityId) ?? [];
    entitySequences.push(sequence);
    byEntity.set(sequence.entityId, entitySequences);
  }
  for (const entitySequences of byEntity.values()) {
    const ordered = entitySequences.toSorted(
      (left, right) => left.insertionIndex - right.insertionIndex,
    );
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      if (
        current.insertionIndex <
        previous.insertionIndex + previous.expectedBrushIds.length
      ) {
        throw new Error("Brush replacement sequences cannot overlap");
      }
    }
  }
  const retainedIds = new Set(
    document.entities.flatMap((entity) =>
      entity.primitives
        .filter((brush) => !removedIds.has(brush.id))
        .map((brush) => brush.id),
    ),
  );
  const replacementIds = new Set<BrushId>();
  for (const replacement of sequences.flatMap(
    (sequence) => sequence.replacements,
  )) {
    if (retainedIds.has(replacement.id) || replacementIds.has(replacement.id)) {
      throw new Error(`Brush ${replacement.id} already exists`);
    }
    replacementIds.add(replacement.id);
  }
  return {
    ...document,
    revision: document.revision + 1,
    entities: document.entities.map((entity) => {
      const entitySequences = byEntity.get(entity.id);
      if (!entitySequences) return entity;
      const brushes = [...entity.primitives];
      for (const sequence of entitySequences.toSorted(
        (left, right) => right.insertionIndex - left.insertionIndex,
      )) {
        brushes.splice(
          sequence.insertionIndex,
          sequence.expectedBrushIds.length,
          ...sequence.replacements,
        );
      }
      return { ...entity, primitives: brushes };
    }),
  };
}

export function insertBrush(
  document: MapDocument,
  entityId: EntityId,
  brush: MapBrush,
  index?: number,
): MapDocument {
  if (
    document.entities.some((entity) =>
      entity.primitives.some((entry) => entry.id === brush.id),
    )
  ) {
    throw new Error(`Brush ${brush.id} already exists`);
  }
  const target = document.entities.find((entity) => entity.id === entityId);
  if (!target) throw new Error(`Unknown entity ${entityId}`);
  const insertionIndex = index ?? target.primitives.length;
  if (
    !Number.isInteger(insertionIndex) ||
    insertionIndex < 0 ||
    insertionIndex > target.primitives.length
  ) {
    throw new Error(`Invalid brush insertion index ${insertionIndex}`);
  }
  return {
    ...document,
    revision: document.revision + 1,
    entities: document.entities.map((entity) =>
      entity.id === entityId
        ? {
            ...entity,
            primitives: [
              ...entity.primitives.slice(0, insertionIndex),
              brush,
              ...entity.primitives.slice(insertionIndex),
            ],
          }
        : entity,
    ),
  };
}

export function insertBrushes(
  document: MapDocument,
  insertions: readonly BrushInsertion[],
): MapDocument {
  if (insertions.length === 0) return document;
  const existingIds = new Set(
    document.entities.flatMap((entity) =>
      entity.primitives.map((brush) => brush.id),
    ),
  );
  const insertedIds = new Set<BrushId>();
  const byEntity = new Map<EntityId, BrushInsertion[]>();
  for (const insertion of insertions) {
    if (
      existingIds.has(insertion.brush.id) ||
      insertedIds.has(insertion.brush.id)
    ) {
      throw new Error(`Brush ${insertion.brush.id} already exists`);
    }
    if (
      !Number.isInteger(insertion.insertionIndex) ||
      insertion.insertionIndex < 0
    ) {
      throw new Error(
        `Invalid brush insertion index ${insertion.insertionIndex}`,
      );
    }
    if (!document.entities.some((entity) => entity.id === insertion.entityId)) {
      throw new Error(`Unknown entity ${insertion.entityId}`);
    }
    insertedIds.add(insertion.brush.id);
    const entityInsertions = byEntity.get(insertion.entityId) ?? [];
    entityInsertions.push(insertion);
    byEntity.set(insertion.entityId, entityInsertions);
  }
  return {
    ...document,
    revision: document.revision + 1,
    entities: document.entities.map((entity) => {
      const entityInsertions = byEntity.get(entity.id);
      if (!entityInsertions) return entity;
      const brushes = [...entity.primitives];
      for (const insertion of entityInsertions.toSorted(
        (left, right) => left.insertionIndex - right.insertionIndex,
      )) {
        if (insertion.insertionIndex > brushes.length) {
          throw new Error(
            `Invalid brush insertion index ${insertion.insertionIndex}`,
          );
        }
        brushes.splice(insertion.insertionIndex, 0, insertion.brush);
      }
      return { ...entity, primitives: brushes };
    }),
  };
}

export function removeBrush(
  document: MapDocument,
  brushId: BrushId,
): MapDocument {
  if (
    !document.entities.some((entity) =>
      entity.primitives.some((brush) => brush.id === brushId),
    )
  ) {
    throw new Error(`Unknown brush ${brushId}`);
  }
  return {
    ...document,
    revision: document.revision + 1,
    entities: document.entities.map((entity) => ({
      ...entity,
      primitives: entity.primitives.filter((brush) => brush.id !== brushId),
    })),
  };
}

export function removeBrushes(
  document: MapDocument,
  brushIds: readonly BrushId[],
): MapDocument {
  if (brushIds.length === 0) return document;
  const uniqueIds = new Set(brushIds);
  if (uniqueIds.size !== brushIds.length)
    throw new Error("Brush ids must be unique");
  const existingIds = new Set(
    document.entities.flatMap((entity) =>
      entity.primitives.map((brush) => brush.id),
    ),
  );
  for (const brushId of uniqueIds) {
    if (!existingIds.has(brushId)) throw new Error(`Unknown brush ${brushId}`);
  }
  return {
    ...document,
    revision: document.revision + 1,
    entities: document.entities.map((entity) => ({
      ...entity,
      primitives: entity.primitives.filter((brush) => !uniqueIds.has(brush.id)),
    })),
  };
}

export function replaceEntityProperties(
  document: MapDocument,
  entityId: EntityId,
  properties: Readonly<Record<string, string>>,
): MapDocument {
  if (!document.entities.some((entity) => entity.id === entityId)) {
    throw new Error(`Unknown entity ${entityId}`);
  }
  return {
    ...document,
    revision: document.revision + 1,
    entities: document.entities.map((entity) =>
      entity.id === entityId
        ? { ...entity, properties: { ...properties } }
        : entity,
    ),
  };
}
