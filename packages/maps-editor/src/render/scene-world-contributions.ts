import {
  brushesInDocument,
  deriveBrush,
  findBrush,
  pointEntitiesInDocument,
  pointEntityBounds,
  pointEntityYawDegrees,
  type EditorObjectViewState,
  type EntityDefinitionCatalog,
  type MapBrush,
  type MapDocument,
  type Vec3,
} from "../core/index.js";
import { appendBoundsWireframe } from "./bounds-overlays.js";
import { uploadFloatBuffer } from "./gpu-buffer.js";
import { LineBatchBuilder } from "./scene-line-batches.js";
import { appendNonBrushPrimitives } from "./scene-nonbrush-primitives.js";
import {
  brushSolidSignature,
  SolidBatchBuilder,
} from "./scene-solid-batches.js";
import {
  appendPointEntityHeading,
  appendTopologyMarker,
} from "./scene-tool-overlays.js";
import type {
  ObjectLineBuffers,
  ReferenceBuffers,
  SolidBuffers,
} from "./scene-types.js";
import type { EditorRenderTheme } from "./theme.js";
import type { EditorReferenceScene, EditorSpriteMaterial } from "./types.js";

interface DocumentGeometrySource {
  readonly document: MapDocument;
  readonly offset: Vec3;
  readonly prefix: string;
  readonly reference: boolean;
}

interface WorldGeometryOptions {
  readonly sources: readonly DocumentGeometrySource[];
  readonly objectViewState: EditorObjectViewState;
  readonly entityDefinitions: EntityDefinitionCatalog | undefined;
  readonly sprites: readonly EditorSpriteMaterial[];
  readonly theme: EditorRenderTheme;
  readonly includedObjectIds: ReadonlySet<string> | null;
  readonly excludedObjectIds: ReadonlySet<string>;
}

interface BrushFaceBatch {
  readonly materialName: string;
  readonly faces: ReturnType<typeof deriveBrush>["faces"];
}

const materialFaceBatchesByBrush = new WeakMap<
  MapBrush,
  readonly BrushFaceBatch[]
>();

function materialFaceBatches(
  brush: MapBrush,
  faces: ReturnType<typeof deriveBrush>["faces"],
): readonly BrushFaceBatch[] {
  const cached = materialFaceBatchesByBrush.get(brush);
  if (cached) return cached;
  const firstMaterial = faces[0]?.material;
  if (firstMaterial && faces.every((face) => face.material === firstMaterial)) {
    const uniform = [{ materialName: firstMaterial, faces }];
    materialFaceBatchesByBrush.set(brush, uniform);
    return uniform;
  }
  const grouped = new Map<string, (typeof faces)[number][]>();
  for (const face of faces) {
    const batch = grouped.get(face.material);
    if (batch) batch.push(face);
    else grouped.set(face.material, [face]);
  }
  const batches = [...grouped].map(([materialName, groupedFaces]) => ({
    materialName,
    faces: groupedFaces,
  }));
  materialFaceBatchesByBrush.set(brush, batches);
  return batches;
}

function sourceBrushes(
  document: MapDocument,
  includedObjectIds: ReadonlySet<string> | null,
): readonly MapBrush[] {
  if (!includedObjectIds) return brushesInDocument(document);
  return [...includedObjectIds].flatMap((objectId) => {
    const brush = findBrush(document, objectId as MapBrush["id"]);
    return brush ? [brush] : [];
  });
}

function sourcePointEntities(
  document: MapDocument,
  includedObjectIds: ReadonlySet<string> | null,
  entityDefinitions: EntityDefinitionCatalog | undefined,
) {
  const entities = includedObjectIds
    ? document.entities.filter((entity) => includedObjectIds.has(entity.id))
    : pointEntitiesInDocument(document, entityDefinitions);
  return includedObjectIds
    ? entities.filter(
        (entity) => pointEntityBounds(entity, entityDefinitions) !== null,
      )
    : entities;
}

function spriteLookup(
  sprites: readonly EditorSpriteMaterial[],
): ReadonlyMap<string, EditorSpriteMaterial> {
  const result = new Map<string, EditorSpriteMaterial>();
  for (const sprite of sprites) {
    const path = sprite.path
      .trim()
      .replaceAll("\\", "/")
      .replace(/^\/+/, "")
      .toLowerCase();
    result.set(path, sprite);
    const basename = path.split("/").at(-1);
    if (basename && !result.has(basename)) result.set(basename, sprite);
  }
  return result;
}

function appendSpritePlane(
  solid: { push(...vertices: number[]): number },
  center: Vec3,
  width: number,
  height: number,
  axis: 0 | 1,
): void {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const point = (horizontal: number, vertical: number): Vec3 => {
    const result = [...center] as [number, number, number];
    result[axis] += horizontal;
    result[2] += vertical;
    return result;
  };
  const corners = [
    { point: point(-halfWidth, -halfHeight), texture: [0, height] },
    { point: point(halfWidth, -halfHeight), texture: [width, height] },
    { point: point(halfWidth, halfHeight), texture: [width, 0] },
    { point: point(-halfWidth, halfHeight), texture: [0, 0] },
  ] as const;
  for (const index of [0, 1, 2, 0, 2, 3]) {
    const vertex = corners[index]!;
    solid.push(...vertex.point, 1, 1, 1, ...vertex.texture);
  }
}

function sourceTheme(
  theme: EditorRenderTheme,
  reference: boolean,
): EditorRenderTheme {
  return reference
    ? { ...theme, material: theme.reference, edge: theme.referenceEdge }
    : theme;
}

export function buildWorldSolidBuffers(
  device: GPUDevice,
  options: WorldGeometryOptions,
  previous?: SolidBuffers,
): SolidBuffers {
  const solids = new SolidBatchBuilder(previous?.solids);
  const hiddenBrushIds = new Set(options.objectViewState.hiddenBrushIds);
  const hiddenEntityIds = new Set(options.objectViewState.hiddenEntityIds);
  const lockedBrushIds = new Set(options.objectViewState.lockedBrushIds);
  const spriteByPath = spriteLookup(options.sprites);

  for (const source of options.sources) {
    const theme = sourceTheme(options.theme, source.reference);
    for (const brush of sourceBrushes(
      source.document,
      options.includedObjectIds,
    )) {
      if (options.includedObjectIds && !options.includedObjectIds.has(brush.id))
        continue;
      if (options.excludedObjectIds.has(brush.id)) continue;
      if (!source.reference && hiddenBrushIds.has(brush.id)) continue;
      const derived = deriveBrush(brush);
      if (!derived.valid || !derived.bounds) continue;
      const locked = !source.reference && lockedBrushIds.has(brush.id);
      const signature = brushSolidSignature(brush, source.offset);
      const color = source.reference
        ? options.theme.reference
        : locked
          ? options.theme.edgeLocked
          : options.theme.material;
      const faceBatches = source.reference
        ? [{ materialName: "__maps_reference__", faces: derived.faces }]
        : locked
          ? [{ materialName: "__maps_locked__", faces: derived.faces }]
          : materialFaceBatches(brush, derived.faces);
      for (const { materialName, faces } of faceBatches) {
        const solid = solids.vertices(
          materialName,
          derived.bounds,
          source.offset,
          `${signature}:${color.join(",")}`,
        );
        if (solid.retained) continue;
        for (const face of faces) {
          for (let index = 1; index < face.vertices.length - 1; index += 1) {
            for (const vertexIndex of [0, index, index + 1]) {
              const point = face.vertices[vertexIndex]!;
              const texture = face.textureCoordinates[vertexIndex]!;
              solid.push(
                point[0] + source.offset[0],
                point[1] + source.offset[1],
                point[2] + source.offset[2],
                ...color,
                texture[0],
                texture[1],
              );
            }
          }
        }
      }
    }
    if (!options.includedObjectIds) {
      appendNonBrushPrimitives({
        source: source.document,
        offset: source.offset,
        lines: [],
        solidBatches: solids,
        theme,
      });
    }
    for (const entity of sourcePointEntities(
      source.document,
      options.includedObjectIds,
      options.entityDefinitions,
    )) {
      if (
        options.includedObjectIds &&
        !options.includedObjectIds.has(entity.id)
      )
        continue;
      if (options.excludedObjectIds.has(entity.id)) continue;
      if (!source.reference && hiddenEntityIds.has(entity.id)) continue;
      const bounds = pointEntityBounds(entity, options.entityDefinitions);
      if (!bounds) continue;
      const classname = entity.properties.classname?.toLowerCase() ?? "";
      const spriteReference =
        entity.properties.model ??
        options.entityDefinitions?.find(classname)?.sprite ??
        "";
      const normalized = spriteReference
        .trim()
        .replaceAll("\\", "/")
        .replace(/^\/+/, "")
        .toLowerCase();
      const sprite =
        spriteByPath.get(normalized) ??
        spriteByPath.get(normalized.split("/").at(-1) ?? "");
      if (!sprite) continue;
      const center: Vec3 = [
        (bounds.min[0] + bounds.max[0]) / 2 + source.offset[0],
        (bounds.min[1] + bounds.max[1]) / 2 + source.offset[1],
        (bounds.min[2] + bounds.max[2]) / 2 + source.offset[2],
      ];
      const scale = Math.max(0.01, Number(entity.properties.scale ?? 1) || 1);
      const solid = solids.vertices(
        sprite.material.name,
        bounds,
        source.offset,
        `${source.prefix}:${entity.id}:${JSON.stringify(entity.properties)}:${sprite.path}:${sprite.material.width}x${sprite.material.height}:${source.offset.join(",")}`,
      );
      if (solid.retained) continue;
      appendSpritePlane(
        solid,
        center,
        sprite.material.width * scale,
        sprite.material.height * scale,
        0,
      );
      appendSpritePlane(
        solid,
        center,
        sprite.material.width * scale,
        sprite.material.height * scale,
        1,
      );
    }
  }
  return { solids: solids.finish(device) };
}

export function buildObjectLineBuffers(
  device: GPUDevice,
  options: WorldGeometryOptions,
  previous?: ObjectLineBuffers,
): ObjectLineBuffers {
  const batches = new LineBatchBuilder(device, previous?.batches);
  const lines: number[] = [];
  const hiddenBrushIds = new Set(options.objectViewState.hiddenBrushIds);
  const hiddenEntityIds = new Set(options.objectViewState.hiddenEntityIds);
  const lockedBrushIds = new Set(options.objectViewState.lockedBrushIds);
  const lockedEntityIds = new Set(options.objectViewState.lockedEntityIds);

  for (const source of options.sources) {
    const theme = sourceTheme(options.theme, source.reference);
    for (const brush of sourceBrushes(
      source.document,
      options.includedObjectIds,
    )) {
      if (options.includedObjectIds && !options.includedObjectIds.has(brush.id))
        continue;
      if (options.excludedObjectIds.has(brush.id)) continue;
      if (!source.reference && hiddenBrushIds.has(brush.id)) continue;
      const derived = deriveBrush(brush);
      if (!derived.valid || !derived.bounds) continue;
      const locked = !source.reference && lockedBrushIds.has(brush.id);
      const color = source.reference
        ? options.theme.referenceEdge
        : locked
          ? options.theme.edgeLocked
          : options.theme.edge;
      batches.add(
        `${source.prefix}:${brush.id}`,
        `${brushSolidSignature(brush, source.offset)}:${color.join(",")}`,
        derived.bounds,
        source.offset,
        () => {
          const vertices: number[] = [];
          for (const edge of derived.edges) {
            vertices.push(
              edge.start[0] + source.offset[0],
              edge.start[1] + source.offset[1],
              edge.start[2] + source.offset[2],
              ...color,
              edge.end[0] + source.offset[0],
              edge.end[1] + source.offset[1],
              edge.end[2] + source.offset[2],
              ...color,
            );
          }
          return vertices;
        },
      );
    }
    if (!options.includedObjectIds) {
      appendNonBrushPrimitives({
        source: source.document,
        offset: source.offset,
        lines,
        solidBatches: null,
        theme,
      });
    }
    for (const entity of sourcePointEntities(
      source.document,
      options.includedObjectIds,
      options.entityDefinitions,
    )) {
      if (
        options.includedObjectIds &&
        !options.includedObjectIds.has(entity.id)
      )
        continue;
      if (options.excludedObjectIds.has(entity.id)) continue;
      if (!source.reference && hiddenEntityIds.has(entity.id)) continue;
      const bounds = pointEntityBounds(entity, options.entityDefinitions);
      if (!bounds) continue;
      const classname = entity.properties.classname?.toLowerCase() ?? "";
      const definitionColor = options.entityDefinitions
        ?.find(classname)
        ?.color?.map((component) => component / 255) as
        | readonly [number, number, number]
        | undefined;
      const locked = !source.reference && lockedEntityIds.has(entity.id);
      const color = source.reference
        ? options.theme.referenceEdge
        : locked
          ? options.theme.axisZ
          : classname === "light"
            ? options.theme.accent
            : classname.startsWith("info_player")
              ? options.theme.info
              : (definitionColor ?? options.theme.special);
      appendBoundsWireframe(lines, bounds, color, source.offset);
      const center: Vec3 = [
        (bounds.min[0] + bounds.max[0]) / 2 + source.offset[0],
        (bounds.min[1] + bounds.max[1]) / 2 + source.offset[1],
        (bounds.min[2] + bounds.max[2]) / 2 + source.offset[2],
      ];
      appendTopologyMarker(lines, center, color, 5);
      const yaw = pointEntityYawDegrees(entity);
      if (yaw !== null) {
        const width = Math.max(
          bounds.max[0] - bounds.min[0],
          bounds.max[1] - bounds.min[1],
        );
        appendPointEntityHeading(
          lines,
          center,
          yaw,
          color,
          Math.max(18, width * 0.75),
        );
      }
    }
  }
  const data = new Float32Array(lines);
  return {
    batches: batches.finish(),
    unbatched: {
      buffer: uploadFloatBuffer(
        device,
        data,
        GPUBufferUsage.VERTEX,
        "Object lines",
      ),
      count: data.length / 6,
    },
  };
}

export function mainDocumentSource(
  document: MapDocument,
): readonly DocumentGeometrySource[] {
  return [
    { document, offset: [0, 0, 0], prefix: "document", reference: false },
  ];
}

export function referenceDocumentSources(
  references: readonly EditorReferenceScene[],
): readonly DocumentGeometrySource[] {
  return references.flatMap((reference, index) =>
    reference.visible
      ? [
          {
            document: reference.document,
            offset: reference.offset,
            prefix: `reference:${index}`,
            reference: true,
          } as const,
        ]
      : [],
  );
}

export function buildWorldGeometryBuffers(
  device: GPUDevice,
  options: WorldGeometryOptions,
  previous?: ReferenceBuffers,
): ReferenceBuffers {
  return {
    ...buildWorldSolidBuffers(device, options, previous),
    ...buildObjectLineBuffers(device, options, previous),
  };
}
