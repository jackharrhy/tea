import {
  cloneBrush,
  transformBrush,
  translateBrush,
  type TransformAxis,
} from "./document.js";
import {
  deriveEditorGroups,
  isEditorGroupEntity,
  selectionForEditorGroup,
  type EditorGroup,
  type GroupDocumentResult,
} from "./groups.js";
import {
  formatEntityOrigin,
  parseEntityOrigin,
  transformPointEntityAffine,
} from "./point-entities.js";
import type {
  EditorSelection,
  EntityId,
  IdFactory,
  MapBrush,
  MapDocument,
  MapEntity,
  MapPrimitive,
  Vec3,
} from "./types.js";

export const TRENCHBROOM_LINKED_GROUP_ID = "_tb_linked_group_id";
export const TRENCHBROOM_GROUP_TRANSFORMATION = "_tb_transformation";
export const TRENCHBROOM_PROTECTED_PROPERTIES = "_tb_protected_properties";

const GROUP_ID = "_tb_id";
const GROUP_PARENT = "_tb_group";

export type AffineMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export const IDENTITY_AFFINE_MATRIX: AffineMatrix = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];

export interface LinkedGroupSet {
  readonly id: string;
  readonly groupIds: readonly string[];
}

function finiteMatrix(values: readonly number[]): values is AffineMatrix {
  return values.length === 16 && values.every(Number.isFinite);
}

export function parseGroupTransformation(
  value: string | null | undefined,
): AffineMatrix {
  if (!value?.trim()) return IDENTITY_AFFINE_MATRIX;
  const values = value.trim().split(/\s+/).map(Number);
  if (!finiteMatrix(values)) return IDENTITY_AFFINE_MATRIX;
  if (
    Math.abs(values[12]!) > 1e-8 ||
    Math.abs(values[13]!) > 1e-8 ||
    Math.abs(values[14]!) > 1e-8 ||
    Math.abs(values[15]! - 1) > 1e-8
  ) {
    return IDENTITY_AFFINE_MATRIX;
  }
  return values;
}

function cleanNumber(value: number): string {
  const normalized = Math.abs(value) < 1e-10 ? 0 : value;
  return String(Number(normalized.toFixed(10)));
}

export function formatGroupTransformation(matrix: AffineMatrix): string {
  return matrix.map(cleanNumber).join(" ");
}

export function multiplyAffineMatrices(
  left: AffineMatrix,
  right: AffineMatrix,
): AffineMatrix {
  const result = Array.from({ length: 16 }, () => 0);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      for (let inner = 0; inner < 4; inner += 1) {
        result[row * 4 + column]! +=
          left[row * 4 + inner]! * right[inner * 4 + column]!;
      }
    }
  }
  return [
    result[0]!,
    result[1]!,
    result[2]!,
    result[3]!,
    result[4]!,
    result[5]!,
    result[6]!,
    result[7]!,
    result[8]!,
    result[9]!,
    result[10]!,
    result[11]!,
    result[12]!,
    result[13]!,
    result[14]!,
    result[15]!,
  ];
}

export function invertAffineMatrix(matrix: AffineMatrix): AffineMatrix {
  const a = matrix[0],
    b = matrix[1],
    c = matrix[2];
  const d = matrix[4],
    e = matrix[5],
    f = matrix[6];
  const g = matrix[8],
    h = matrix[9],
    i = matrix[10];
  const determinant =
    a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(determinant) <= 1e-10)
    throw new Error("Linked group transformation is singular");
  const inverseLinear = [
    (e * i - f * h) / determinant,
    (c * h - b * i) / determinant,
    (b * f - c * e) / determinant,
    (f * g - d * i) / determinant,
    (a * i - c * g) / determinant,
    (c * d - a * f) / determinant,
    (d * h - e * g) / determinant,
    (b * g - a * h) / determinant,
    (a * e - b * d) / determinant,
  ] as const;
  const translation: Vec3 = [matrix[3], matrix[7], matrix[11]];
  const inverseTranslation: Vec3 = [
    -(
      inverseLinear[0] * translation[0] +
      inverseLinear[1] * translation[1] +
      inverseLinear[2] * translation[2]
    ),
    -(
      inverseLinear[3] * translation[0] +
      inverseLinear[4] * translation[1] +
      inverseLinear[5] * translation[2]
    ),
    -(
      inverseLinear[6] * translation[0] +
      inverseLinear[7] * translation[1] +
      inverseLinear[8] * translation[2]
    ),
  ];
  return [
    inverseLinear[0],
    inverseLinear[1],
    inverseLinear[2],
    inverseTranslation[0],
    inverseLinear[3],
    inverseLinear[4],
    inverseLinear[5],
    inverseTranslation[1],
    inverseLinear[6],
    inverseLinear[7],
    inverseLinear[8],
    inverseTranslation[2],
    0,
    0,
    0,
    1,
  ];
}

export function transformAffinePoint(matrix: AffineMatrix, point: Vec3): Vec3 {
  return [
    matrix[0] * point[0] +
      matrix[1] * point[1] +
      matrix[2] * point[2] +
      matrix[3],
    matrix[4] * point[0] +
      matrix[5] * point[1] +
      matrix[6] * point[2] +
      matrix[7],
    matrix[8] * point[0] +
      matrix[9] * point[1] +
      matrix[10] * point[2] +
      matrix[11],
  ];
}

export function translationAffineMatrix(delta: Vec3): AffineMatrix {
  return [1, 0, 0, delta[0], 0, 1, 0, delta[1], 0, 0, 1, delta[2], 0, 0, 0, 1];
}

function aroundPivot(linear: readonly number[], pivot: Vec3): AffineMatrix {
  const translation: Vec3 = [
    pivot[0] -
      (linear[0]! * pivot[0] + linear[1]! * pivot[1] + linear[2]! * pivot[2]),
    pivot[1] -
      (linear[3]! * pivot[0] + linear[4]! * pivot[1] + linear[5]! * pivot[2]),
    pivot[2] -
      (linear[6]! * pivot[0] + linear[7]! * pivot[1] + linear[8]! * pivot[2]),
  ];
  return [
    linear[0]!,
    linear[1]!,
    linear[2]!,
    translation[0],
    linear[3]!,
    linear[4]!,
    linear[5]!,
    translation[1],
    linear[6]!,
    linear[7]!,
    linear[8]!,
    translation[2],
    0,
    0,
    0,
    1,
  ];
}

export function rotationAffineMatrix(
  pivot: Vec3,
  axis: TransformAxis,
  degrees: number,
): AffineMatrix {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const linear =
    axis === 0
      ? [1, 0, 0, 0, cosine, -sine, 0, sine, cosine]
      : axis === 1
        ? [cosine, 0, sine, 0, 1, 0, -sine, 0, cosine]
        : [cosine, -sine, 0, sine, cosine, 0, 0, 0, 1];
  return aroundPivot(linear, pivot);
}

export function scaleAffineMatrix(pivot: Vec3, factors: Vec3): AffineMatrix {
  return aroundPivot(
    [factors[0], 0, 0, 0, factors[1], 0, 0, 0, factors[2]],
    pivot,
  );
}

export function shearAffineMatrix(
  pivot: Vec3,
  sourceAxis: TransformAxis,
  targetAxis: TransformAxis,
  factor: number,
): AffineMatrix {
  if (sourceAxis === targetAxis)
    throw new Error("Shear axes must be different");
  const linear = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  linear[targetAxis * 3 + sourceAxis] = factor;
  return aroundPivot(linear, pivot);
}

export function flipAffineMatrix(
  pivot: Vec3,
  axis: TransformAxis,
): AffineMatrix {
  const factors: [number, number, number] = [1, 1, 1];
  factors[axis] = -1;
  return scaleAffineMatrix(pivot, factors);
}

function groupEntity(document: MapDocument, groupId: string): MapEntity | null {
  return (
    document.entities.find(
      (entity) =>
        isEditorGroupEntity(entity) && entity.properties[GROUP_ID] === groupId,
    ) ?? null
  );
}

export function deriveLinkedGroupSets(
  document: MapDocument,
): readonly LinkedGroupSet[] {
  const sets = new Map<string, string[]>();
  for (const group of deriveEditorGroups(document)) {
    if (!group.linkedGroupId) continue;
    const members = sets.get(group.linkedGroupId) ?? [];
    members.push(group.id);
    sets.set(group.linkedGroupId, members);
  }
  return [...sets].map(([id, groupIds]) => ({ id, groupIds }));
}

export function linkedGroupSiblings(
  document: MapDocument,
  groupId: string,
): readonly EditorGroup[] {
  const groups = deriveEditorGroups(document);
  const source = groups.find((group) => group.id === groupId);
  return source?.linkedGroupId
    ? groups.filter((group) => group.linkedGroupId === source.linkedGroupId)
    : [];
}

export function transformEditorGroupMetadata(
  document: MapDocument,
  groupId: string | undefined,
  operation: AffineMatrix,
): MapDocument {
  if (!groupId) return document;
  const entity = groupEntity(document, groupId);
  if (!entity?.properties[TRENCHBROOM_LINKED_GROUP_ID]) return document;
  const current = parseGroupTransformation(
    entity.properties[TRENCHBROOM_GROUP_TRANSFORMATION],
  );
  const properties = {
    ...entity.properties,
    [TRENCHBROOM_GROUP_TRANSFORMATION]: formatGroupTransformation(
      multiplyAffineMatrices(operation, current),
    ),
  };
  return {
    ...document,
    entities: document.entities.map((candidate) =>
      candidate.id === entity.id ? { ...candidate, properties } : candidate,
    ),
  };
}

/** Updates linked transform metadata on a transformed group and every nested linked group. */
export function transformEditorGroupSubtreeMetadata(
  document: MapDocument,
  groupId: string | undefined,
  operation: AffineMatrix,
): MapDocument {
  if (!groupId) return document;
  const groups = deriveEditorGroups(document);
  if (!groups.some((group) => group.id === groupId)) return document;
  const descendantIds = subtreeGroupIds(groups, groupId);
  let transformed = document;
  for (const descendantId of descendantIds) {
    transformed = transformEditorGroupMetadata(
      transformed,
      descendantId,
      operation,
    );
  }
  return transformed;
}

function subtreeGroupIds(
  groups: readonly EditorGroup[],
  rootId: string,
): Set<string> {
  const result = new Set<string>();
  const visit = (id: string) => {
    if (result.has(id)) return;
    result.add(id);
    const group = groups.find((candidate) => candidate.id === id);
    for (const childId of group?.childGroupIds ?? []) visit(childId);
  };
  visit(rootId);
  return result;
}

function nextPersistentGroupIds(
  document: MapDocument,
  count: number,
): string[] {
  const numeric = deriveEditorGroups(document)
    .map((group) => Number.parseInt(group.id, 10))
    .filter(Number.isFinite);
  const start = (numeric.length > 0 ? Math.max(...numeric) : 0) + 1;
  return Array.from({ length: count }, (_, index) => String(start + index));
}

function cloneTransformedBrush(
  brush: MapBrush,
  matrix: AffineMatrix,
  ids: IdFactory,
): MapBrush {
  const linear = [
    [matrix[0], matrix[1], matrix[2]],
    [matrix[4], matrix[5], matrix[6]],
    [matrix[8], matrix[9], matrix[10]],
  ] as const;
  const transformed = transformBrush(
    cloneBrush(brush, ids),
    linear,
    [0, 0, 0],
    true,
  );
  return translateBrush(transformed, [matrix[3], matrix[7], matrix[11]], true);
}

function cloneTransformedPrimitive(
  primitive: MapPrimitive,
  matrix: AffineMatrix,
  ids: IdFactory,
): MapPrimitive {
  switch (primitive.kind) {
    case "brush":
      return cloneTransformedBrush(primitive, matrix, ids);
    case "patch":
      return {
        ...primitive,
        id: ids.patch(),
        revision: 0,
        controlPoints: primitive.controlPoints.map((row) =>
          row.map((point) => ({
            ...point,
            position: transformAffinePoint(matrix, point.position),
          })),
        ),
      };
    case "brush-def":
      return {
        ...primitive,
        id: ids.brushDef(),
        revision: 0,
        faces: primitive.faces.map((face) => {
          const [first, second, third] = face.planePoints;
          return {
            ...face,
            id: ids.face(),
            planePoints: [
              transformAffinePoint(matrix, first),
              transformAffinePoint(matrix, second),
              transformAffinePoint(matrix, third),
            ],
          };
        }),
      };
  }
}

function escapedPropertyNames(value: string | undefined): string[] {
  if (!value) return [];
  const result: string[] = [];
  let current = "";
  let escaping = false;
  for (const character of value) {
    if (escaping) {
      current += character;
      escaping = false;
    } else if (character === "\\") {
      escaping = true;
    } else if (character === ";") {
      if (current) result.push(current);
      current = "";
    } else current += character;
  }
  if (escaping) current += "\\";
  if (current) result.push(current);
  return [...new Set(result)];
}

export function protectedEntityProperties(
  entity: MapEntity,
): readonly string[] {
  return escapedPropertyNames(
    entity.properties[TRENCHBROOM_PROTECTED_PROPERTIES],
  );
}

function serializeProtectedProperties(properties: readonly string[]): string {
  return [...new Set(properties)]
    .filter(Boolean)
    .map((property) => property.replaceAll("\\", "\\\\").replaceAll(";", "\\;"))
    .join(";");
}

function protectedEntityPropertyMerge(
  source: MapEntity,
  counterpart: MapEntity | null,
  transformed: Readonly<Record<string, string>>,
  parentGroupId: string,
): Record<string, string> {
  const sourceProtected = new Set(protectedEntityProperties(source));
  const targetProtected = new Set(
    counterpart ? protectedEntityProperties(counterpart) : [],
  );
  const preserve = new Set([...sourceProtected, ...targetProtected]);
  const properties: Record<string, string> = {
    ...transformed,
    [GROUP_PARENT]: parentGroupId,
  };
  if (counterpart) {
    for (const key of preserve) {
      if (key in counterpart.properties)
        properties[key] = counterpart.properties[key]!;
      else delete properties[key];
    }
    const serialized = serializeProtectedProperties([...targetProtected]);
    if (serialized) properties[TRENCHBROOM_PROTECTED_PROPERTIES] = serialized;
    else delete properties[TRENCHBROOM_PROTECTED_PROPERTIES];
  } else if (sourceProtected.size > 0) {
    delete properties[TRENCHBROOM_PROTECTED_PROPERTIES];
  }
  properties[GROUP_PARENT] = parentGroupId;
  return properties;
}

function transformedRegularEntity(
  source: MapEntity,
  counterpart: MapEntity | null,
  matrix: AffineMatrix,
  parentGroupId: string,
  ids: IdFactory,
): MapEntity {
  const cloned: MapEntity = {
    id: ids.entity(),
    properties: { ...source.properties, [GROUP_PARENT]: parentGroupId },
    primitives: source.primitives.map((primitive) =>
      cloneTransformedPrimitive(primitive, matrix, ids),
    ),
  };
  const transformed =
    source.primitives.length === 0 && parseEntityOrigin(source)
      ? transformPointEntityAffine(
          cloned,
          [
            [matrix[0], matrix[1], matrix[2]],
            [matrix[4], matrix[5], matrix[6]],
            [matrix[8], matrix[9], matrix[10]],
          ],
          [matrix[3], matrix[7], matrix[11]],
        )
      : parseEntityOrigin(source)
        ? {
            ...cloned,
            properties: {
              ...cloned.properties,
              origin: formatEntityOrigin(
                transformAffinePoint(matrix, parseEntityOrigin(source)!),
              ),
            },
          }
        : cloned;
  return {
    ...transformed,
    properties: protectedEntityPropertyMerge(
      source,
      counterpart,
      transformed.properties,
      parentGroupId,
    ),
  };
}

function transformedGroupProperties(
  source: MapEntity,
  persistentId: string,
  parentGroupId: string | null,
  matrix: AffineMatrix,
): Record<string, string> {
  const properties: Record<string, string> = {
    ...source.properties,
    [GROUP_ID]: persistentId,
  };
  if (parentGroupId) properties[GROUP_PARENT] = parentGroupId;
  else delete properties[GROUP_PARENT];
  if (source.properties[TRENCHBROOM_GROUP_TRANSFORMATION]) {
    properties[TRENCHBROOM_GROUP_TRANSFORMATION] = formatGroupTransformation(
      multiplyAffineMatrices(
        matrix,
        parseGroupTransformation(
          source.properties[TRENCHBROOM_GROUP_TRANSFORMATION],
        ),
      ),
    );
  }
  return properties;
}

/** Creates a linked sibling containing a full, independently addressable copy of the group tree. */
export function createLinkedGroupDuplicate(
  document: MapDocument,
  sourceGroupId: string,
  ids: IdFactory,
): GroupDocumentResult {
  const groups = deriveEditorGroups(document);
  const source = groups.find((group) => group.id === sourceGroupId);
  if (!source) throw new Error(`Unknown group ${sourceGroupId}`);
  const memberIds = subtreeGroupIds(groups, source.id);
  const sourceGroups = groups.filter((group) => memberIds.has(group.id));
  const persistentIds = nextPersistentGroupIds(document, sourceGroups.length);
  const idMap = new Map(
    sourceGroups.map((group, index) => [group.id, persistentIds[index]!]),
  );
  const sourceEntityByGroup = new Map(
    sourceGroups.map(
      (group) => [group.id, groupEntity(document, group.id)!] as const,
    ),
  );
  const linkId = source.linkedGroupId ?? `{${ids.entity()}}`;
  const added: MapEntity[] = [];
  for (const group of sourceGroups) {
    const sourceEntity = sourceEntityByGroup.get(group.id)!;
    const persistentId = idMap.get(group.id)!;
    const properties = transformedGroupProperties(
      sourceEntity,
      persistentId,
      group.id === source.id
        ? source.parentGroupId
        : (idMap.get(group.parentGroupId ?? "") ?? null),
      IDENTITY_AFFINE_MATRIX,
    );
    if (group.id === source.id) {
      properties[TRENCHBROOM_LINKED_GROUP_ID] = linkId;
      properties[TRENCHBROOM_GROUP_TRANSFORMATION] = formatGroupTransformation(
        parseGroupTransformation(source.transformation),
      );
    }
    added.push({
      id: ids.entity(),
      properties,
      primitives: sourceEntity.primitives.map((primitive) =>
        cloneTransformedPrimitive(primitive, IDENTITY_AFFINE_MATRIX, ids),
      ),
    });
    for (const entityId of group.directEntityIds) {
      const entity = document.entities.find(
        (candidate) => candidate.id === entityId,
      );
      if (!entity) continue;
      added.push({
        id: ids.entity(),
        properties: { ...entity.properties, [GROUP_PARENT]: persistentId },
        primitives: entity.primitives.map((primitive) =>
          cloneTransformedPrimitive(primitive, IDENTITY_AFFINE_MATRIX, ids),
        ),
      });
    }
  }
  const entities = document.entities.map((entity) => {
    if (entity.id !== source.entityId) return entity;
    return {
      ...entity,
      properties: {
        ...entity.properties,
        [TRENCHBROOM_LINKED_GROUP_ID]: linkId,
        [TRENCHBROOM_GROUP_TRANSFORMATION]: formatGroupTransformation(
          parseGroupTransformation(source.transformation),
        ),
      },
    };
  });
  const after = { ...document, entities: [...entities, ...added] };
  const groupId = idMap.get(source.id)!;
  const duplicate = deriveEditorGroups(after).find(
    (group) => group.id === groupId,
  )!;
  return {
    document: after,
    selection: selectionForEditorGroup(duplicate),
    groupId,
  };
}

/** Copies one edited linked group's complete contents into every transformed sibling. */
export function synchronizeLinkedGroupContents(
  document: MapDocument,
  sourceGroupId: string,
  ids: IdFactory,
): MapDocument {
  const groups = deriveEditorGroups(document);
  const source = groups.find((group) => group.id === sourceGroupId);
  if (!source?.linkedGroupId) return document;
  const targets = groups.filter(
    (group) =>
      group.linkedGroupId === source.linkedGroupId && group.id !== source.id,
  );
  if (targets.length === 0) return normalizeSingleLinkedGroups(document);
  let result = document;
  for (const target of targets) {
    const currentGroups = deriveEditorGroups(result);
    const currentSource = currentGroups.find((group) => group.id === source.id);
    const currentTarget = currentGroups.find((group) => group.id === target.id);
    if (!currentSource || !currentTarget) continue;
    const matrix = multiplyAffineMatrices(
      parseGroupTransformation(currentTarget.transformation),
      invertAffineMatrix(
        parseGroupTransformation(currentSource.transformation),
      ),
    );
    const targetDescendants = subtreeGroupIds(currentGroups, currentTarget.id);
    targetDescendants.delete(currentTarget.id);
    const removedEntityIds = new Set<EntityId>([
      ...currentTarget.directEntityIds,
      ...currentGroups
        .filter((group) => targetDescendants.has(group.id))
        .flatMap((group) => [group.entityId].concat(group.directEntityIds)),
    ]);
    const targetRootEntity = groupEntity(result, currentTarget.id)!;
    const sourceRootEntity = groupEntity(result, currentSource.id)!;
    const remaining = result.entities
      .filter((entity) => !removedEntityIds.has(entity.id))
      .map((entity) =>
        entity.id === targetRootEntity.id
          ? Object.assign({}, entity, {
              primitives: sourceRootEntity.primitives.map((primitive) =>
                cloneTransformedPrimitive(primitive, matrix, ids),
              ),
            })
          : entity,
      );
    const sourceSubtree = subtreeGroupIds(currentGroups, currentSource.id);
    sourceSubtree.delete(currentSource.id);
    const sourceChildren = currentSource.childGroupIds
      .map((id) => currentGroups.find((group) => group.id === id))
      .filter((group): group is EditorGroup => Boolean(group));
    const targetChildren = currentTarget.childGroupIds
      .map((id) => currentGroups.find((group) => group.id === id))
      .filter((group): group is EditorGroup => Boolean(group));
    const idMap = new Map<string, string>();
    const newPersistentIds = nextPersistentGroupIds(result, sourceSubtree.size);
    [...sourceSubtree].forEach((id, index) =>
      idMap.set(id, newPersistentIds[index]!),
    );
    const counterpartBySourceGroup = new Map<string, EditorGroup>();
    const pairChildren = (
      sourceParent: EditorGroup,
      targetParent: EditorGroup,
    ) => {
      sourceParent.childGroupIds.forEach((sourceChildId, index) => {
        const sourceChild = currentGroups.find(
          (group) => group.id === sourceChildId,
        );
        const targetChild = currentGroups.find(
          (group) => group.id === targetParent.childGroupIds[index],
        );
        if (!sourceChild || !targetChild) return;
        counterpartBySourceGroup.set(sourceChild.id, targetChild);
        pairChildren(sourceChild, targetChild);
      });
    };
    sourceChildren.forEach((sourceChild, index) => {
      const targetChild = targetChildren[index];
      if (!targetChild) return;
      counterpartBySourceGroup.set(sourceChild.id, targetChild);
      pairChildren(sourceChild, targetChild);
    });
    const added: MapEntity[] = [];
    currentSource.directEntityIds.forEach((entityId, index) => {
      const entity = result.entities.find(
        (candidate) => candidate.id === entityId,
      );
      const counterpartId = currentTarget.directEntityIds[index];
      const counterpart =
        result.entities.find((candidate) => candidate.id === counterpartId) ??
        null;
      if (entity)
        added.push(
          transformedRegularEntity(
            entity,
            counterpart,
            matrix,
            currentTarget.id,
            ids,
          ),
        );
    });
    for (const nestedSourceGroupId of sourceSubtree) {
      const sourceGroup = currentGroups.find(
        (group) => group.id === nestedSourceGroupId,
      )!;
      const sourceEntity = groupEntity(result, sourceGroup.id)!;
      const persistentId = idMap.get(sourceGroup.id)!;
      const parentId =
        sourceGroup.parentGroupId === currentSource.id
          ? currentTarget.id
          : (idMap.get(sourceGroup.parentGroupId ?? "") ?? currentTarget.id);
      added.push({
        id: ids.entity(),
        properties: transformedGroupProperties(
          sourceEntity,
          persistentId,
          parentId,
          matrix,
        ),
        primitives: sourceEntity.primitives.map((primitive) =>
          cloneTransformedPrimitive(primitive, matrix, ids),
        ),
      });
      const counterpartGroup =
        counterpartBySourceGroup.get(sourceGroup.id) ?? null;
      sourceGroup.directEntityIds.forEach((entityId, index) => {
        const entity = result.entities.find(
          (candidate) => candidate.id === entityId,
        );
        const counterpartId = counterpartGroup?.directEntityIds[index];
        const counterpart =
          result.entities.find((candidate) => candidate.id === counterpartId) ??
          null;
        if (entity)
          added.push(
            transformedRegularEntity(
              entity,
              counterpart,
              matrix,
              persistentId,
              ids,
            ),
          );
      });
    }
    result = Object.assign({}, result, { entities: remaining.concat(added) });
  }
  return result;
}

/** Removes one member from a link set and regularizes the final singleton. */
export function unlinkEditorGroup(
  document: MapDocument,
  groupId: string,
): MapDocument {
  const siblings = linkedGroupSiblings(document, groupId);
  if (siblings.length < 2) return normalizeSingleLinkedGroups(document);
  const idsToRegularize = new Set([groupId]);
  if (siblings.length === 2) {
    const other = siblings.find((group) => group.id !== groupId);
    if (other) idsToRegularize.add(other.id);
  }
  return {
    ...document,
    entities: document.entities.map((entity) => {
      if (
        !isEditorGroupEntity(entity) ||
        !idsToRegularize.has(entity.properties[GROUP_ID] ?? "")
      ) {
        return entity;
      }
      const properties = { ...entity.properties };
      delete properties[TRENCHBROOM_LINKED_GROUP_ID];
      delete properties[TRENCHBROOM_GROUP_TRANSFORMATION];
      return { ...entity, properties };
    }),
  };
}

export function normalizeSingleLinkedGroups(
  document: MapDocument,
): MapDocument {
  const singletonIds = new Set(
    deriveLinkedGroupSets(document)
      .filter((set) => set.groupIds.length < 2)
      .flatMap((set) => set.groupIds),
  );
  if (singletonIds.size === 0) return document;
  return {
    ...document,
    entities: document.entities.map((entity) => {
      if (
        !isEditorGroupEntity(entity) ||
        !singletonIds.has(entity.properties[GROUP_ID] ?? "")
      ) {
        return entity;
      }
      const properties = { ...entity.properties };
      delete properties[TRENCHBROOM_LINKED_GROUP_ID];
      delete properties[TRENCHBROOM_GROUP_TRANSFORMATION];
      return { ...entity, properties };
    }),
  };
}

function groupPath(
  groups: readonly EditorGroup[],
  rootId: string,
  targetId: string,
): readonly number[] | null {
  if (rootId === targetId) return [];
  const root = groups.find((group) => group.id === rootId);
  if (!root) return null;
  for (let index = 0; index < root.childGroupIds.length; index += 1) {
    const nested = groupPath(groups, root.childGroupIds[index]!, targetId);
    if (nested) return [index, ...nested];
  }
  return null;
}

function groupAtPath(
  groups: readonly EditorGroup[],
  rootId: string,
  path: readonly number[],
): EditorGroup | null {
  let group = groups.find((candidate) => candidate.id === rootId) ?? null;
  for (const index of path) {
    group = group
      ? (groups.find(
          (candidate) => candidate.id === group!.childGroupIds[index],
        ) ?? null)
      : null;
  }
  return group;
}

export function correspondingLinkedEntity(
  document: MapDocument,
  sourceRootId: string,
  sourceEntityId: EntityId,
  targetRootId: string,
): MapEntity | null {
  const groups = deriveEditorGroups(document);
  const owner = groups.find((group) =>
    group.directEntityIds.includes(sourceEntityId),
  );
  if (!owner) return null;
  const path = groupPath(groups, sourceRootId, owner.id);
  if (!path) return null;
  const targetOwner = groupAtPath(groups, targetRootId, path);
  const index = owner.directEntityIds.indexOf(sourceEntityId);
  const targetId = targetOwner?.directEntityIds[index];
  return document.entities.find((entity) => entity.id === targetId) ?? null;
}

export function setEntityPropertyProtection(
  document: MapDocument,
  linkedRootId: string,
  entityId: EntityId,
  key: string,
  protect: boolean,
): MapDocument {
  const entity = document.entities.find(
    (candidate) => candidate.id === entityId,
  );
  if (!entity) throw new Error(`Unknown entity ${entityId}`);
  const siblings = linkedGroupSiblings(document, linkedRootId);
  if (siblings.length < 2)
    throw new Error("Protected properties require a linked group");
  const protectedKeys = new Set(protectedEntityProperties(entity));
  const properties = { ...entity.properties };
  if (protect) protectedKeys.add(key);
  else {
    protectedKeys.delete(key);
    const counterpartRoot = siblings.find((group) => group.id !== linkedRootId);
    const counterpart = counterpartRoot
      ? correspondingLinkedEntity(
          document,
          linkedRootId,
          entityId,
          counterpartRoot.id,
        )
      : null;
    if (counterpart && key in counterpart.properties)
      properties[key] = counterpart.properties[key]!;
    else if (counterpart) delete properties[key];
  }
  const serialized = serializeProtectedProperties([...protectedKeys]);
  if (serialized) properties[TRENCHBROOM_PROTECTED_PROPERTIES] = serialized;
  else delete properties[TRENCHBROOM_PROTECTED_PROPERTIES];
  return {
    ...document,
    entities: document.entities.map((candidate) =>
      candidate.id === entityId ? { ...candidate, properties } : candidate,
    ),
  };
}

export function linkedGroupForSelection(
  document: MapDocument,
  selection: EditorSelection | null,
): EditorGroup | null {
  if (!selection) return null;
  if (selection.groupId) {
    const selected = deriveEditorGroups(document).find(
      (group) => group.id === selection.groupId,
    );
    return selected?.linkedGroupId ? selected : null;
  }
  const owner = selection.entityId
    ? document.entities.find((entity) => entity.id === selection.entityId)
    : document.entities.find((entity) =>
        entity.primitives.some((brush) => brush.id === selection.brushId),
      );
  const ownerId =
    owner && isEditorGroupEntity(owner)
      ? owner?.properties[GROUP_ID]
      : owner?.properties[GROUP_PARENT];
  const groups = deriveEditorGroups(document);
  let group = groups.find((candidate) => candidate.id === ownerId) ?? null;
  while (group?.parentGroupId) {
    const parent = groups.find(
      (candidate) => candidate.id === group!.parentGroupId,
    );
    if (!parent) break;
    group = parent;
    if (group.linkedGroupId) return group;
  }
  return group?.linkedGroupId ? group : null;
}

export function linkedGroupCenter(group: EditorGroup): Vec3 | null {
  return group.bounds
    ? [
        (group.bounds.min[0] + group.bounds.max[0]) / 2,
        (group.bounds.min[1] + group.bounds.max[1]) / 2,
        (group.bounds.min[2] + group.bounds.max[2]) / 2,
      ]
    : null;
}
