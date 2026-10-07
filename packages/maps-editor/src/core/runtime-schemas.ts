import { z } from "zod";

import type {
  CollaborationEdit,
  CollaborationFailure,
  CollaborationOperation,
} from "./collaboration.js";
import type {
  MapCompileDiagnostic,
  MapCompileLog,
  MapCompileResult,
} from "./compiler.js";
import type {
  MapSourceDiagnostic,
  MapSourceState,
} from "./map-source-types.js";
import type {
  DocumentId,
  EntityId,
  FaceId,
  MapBrush,
  MapBrushDef,
  MapDocument,
  MapEntity,
  MapFace,
  MapPatch,
  PrimitiveId,
  Vec2,
  Vec3,
} from "./types.js";

const MAX_ID_LENGTH = 256;
const MAX_TEXT_LENGTH = 4_096;
const MAX_PROPERTY_COUNT = 2_048;
const MAX_PRIMITIVES_PER_ENTITY = 100_000;
const MAX_ENTITIES = 100_000;

const finiteNumber = z.number().finite();
const nonNegativeInteger = z.number().int().nonnegative();
// Domain IDs are compile-time brands over strings and have no distinct runtime representation.
const id = <T extends string>() =>
  z.string().min(1).max(MAX_ID_LENGTH) as unknown as z.ZodType<T>;

export const DocumentIdSchema = id<DocumentId>();
export const EntityIdSchema = id<EntityId>();
export const PrimitiveIdSchema = id<PrimitiveId>();
export const BrushIdSchema = PrimitiveIdSchema;
export const FaceIdSchema = id<FaceId>();

export const Vec2Schema: z.ZodType<Vec2> = z.tuple([
  finiteNumber,
  finiteNumber,
]);
export const Vec3Schema: z.ZodType<Vec3> = z.tuple([
  finiteNumber,
  finiteNumber,
  finiteNumber,
]);

const SurfaceAttributesSchema = z.strictObject({
  contents: z.number().int().optional(),
  flags: z.number().int().optional(),
  value: z.number().int().optional(),
});

const TextureProjectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("axial"),
    uAxis: Vec3Schema,
    vAxis: Vec3Schema,
    offset: Vec2Schema,
    rotationDegrees: finiteNumber,
    scale: Vec2Schema,
  }),
  z.strictObject({
    kind: z.literal("valve-220"),
    uAxis: Vec3Schema,
    vAxis: Vec3Schema,
    offset: Vec2Schema,
    rotationDegrees: finiteNumber,
    scale: Vec2Schema,
  }),
]);

const MapFaceObjectSchema = z.strictObject({
  id: FaceIdSchema,
  planePoints: z.tuple([Vec3Schema, Vec3Schema, Vec3Schema]),
  material: z.string().max(MAX_TEXT_LENGTH),
  projection: TextureProjectionSchema,
  surface: SurfaceAttributesSchema,
});
export const MapFaceSchema: z.ZodType<MapFace> = MapFaceObjectSchema;

const MapBrushObjectSchema = z.strictObject({
  kind: z.literal("brush"),
  id: BrushIdSchema,
  revision: nonNegativeInteger,
  faces: z.array(MapFaceObjectSchema).min(4).max(1_024),
});
export const MapBrushSchema: z.ZodType<MapBrush> = MapBrushObjectSchema;

const MapPatchPointSchema = z.strictObject({
  position: Vec3Schema,
  uv: Vec2Schema,
});

const MapPatchObjectSchema = z.strictObject({
  kind: z.literal("patch"),
  id: PrimitiveIdSchema,
  revision: nonNegativeInteger,
  material: z.string().max(MAX_TEXT_LENGTH),
  dimensions: z.tuple([nonNegativeInteger, nonNegativeInteger]),
  subdivisions: z.tuple([
    nonNegativeInteger,
    nonNegativeInteger,
    nonNegativeInteger,
  ]),
  controlPoints: z.array(z.array(MapPatchPointSchema).max(1_024)).max(1_024),
});
export const MapPatchSchema: z.ZodType<MapPatch> = MapPatchObjectSchema;

const MapBrushDefFaceSchema = z.strictObject({
  id: FaceIdSchema,
  planePoints: z.tuple([Vec3Schema, Vec3Schema, Vec3Schema]),
  textureMatrix: z.tuple([Vec3Schema, Vec3Schema]),
  material: z.string().max(MAX_TEXT_LENGTH),
  surface: SurfaceAttributesSchema,
});

const MapBrushDefObjectSchema = z.strictObject({
  kind: z.literal("brush-def"),
  id: PrimitiveIdSchema,
  revision: nonNegativeInteger,
  faces: z.array(MapBrushDefFaceSchema).min(4).max(1_024),
});
export const MapBrushDefSchema: z.ZodType<MapBrushDef> =
  MapBrushDefObjectSchema;

const MapPrimitiveSchema = z.discriminatedUnion("kind", [
  MapBrushObjectSchema,
  MapPatchObjectSchema,
  MapBrushDefObjectSchema,
]);

const StringPropertiesSchema = z
  .record(z.string().max(MAX_TEXT_LENGTH), z.string().max(MAX_TEXT_LENGTH))
  .superRefine((properties, context) => {
    if (Object.keys(properties).length > MAX_PROPERTY_COUNT) {
      context.addIssue({
        code: "custom",
        message: `must contain at most ${MAX_PROPERTY_COUNT} properties`,
      });
    }
  });

const MapEntityObjectSchema = z.strictObject({
  id: EntityIdSchema,
  properties: StringPropertiesSchema,
  primitives: z.array(MapPrimitiveSchema).max(MAX_PRIMITIVES_PER_ENTITY),
});
export const MapEntitySchema: z.ZodType<MapEntity> = MapEntityObjectSchema;

const MapDocumentObjectSchema = z.strictObject({
  id: DocumentIdSchema,
  revision: nonNegativeInteger,
  format: z.literal("quake-map"),
  faceSyntax: z.enum(["valve-220", "quake"]),
  entities: z.array(MapEntityObjectSchema).max(MAX_ENTITIES),
});
export const MapDocumentSchema: z.ZodType<MapDocument> =
  MapDocumentObjectSchema;

const MapSourceDiagnosticObjectSchema = z.strictObject({
  severity: z.enum(["warning", "error"]),
  code: z.enum([
    "unsupported-construct",
    "unsafe-source-edit",
    "external-source-change",
  ]),
  message: z.string().min(1).max(MAX_TEXT_LENGTH),
  line: nonNegativeInteger.optional(),
  column: nonNegativeInteger.optional(),
  keyword: z.string().max(MAX_TEXT_LENGTH).optional(),
});
export const MapSourceDiagnosticSchema: z.ZodType<MapSourceDiagnostic> =
  MapSourceDiagnosticObjectSchema;

const SourceRangeSchema = {
  start: nonNegativeInteger,
  end: nonNegativeInteger,
};
const MapSourceOpaqueSpanSchema = z.strictObject({
  keyword: z.string().max(MAX_TEXT_LENGTH),
  ...SourceRangeSchema,
  line: nonNegativeInteger,
  column: nonNegativeInteger,
});
const MapSourceFaceSpanSchema = z.strictObject({
  faceId: FaceIdSchema,
  ...SourceRangeSchema,
});
const MapSourceBrushSpanSchema = z.strictObject({
  brushId: BrushIdSchema,
  ...SourceRangeSchema,
  openEnd: nonNegativeInteger,
  closeStart: nonNegativeInteger,
  faces: z.array(MapSourceFaceSpanSchema).max(1_024),
});
const MapSourceEntitySpanSchema = z.strictObject({
  entityId: EntityIdSchema,
  ...SourceRangeSchema,
  openEnd: nonNegativeInteger,
  closeStart: nonNegativeInteger,
  properties: z
    .array(
      z.strictObject({
        key: z.string().max(MAX_TEXT_LENGTH),
        ...SourceRangeSchema,
      }),
    )
    .max(MAX_PROPERTY_COUNT),
  brushes: z.array(MapSourceBrushSpanSchema).max(MAX_PRIMITIVES_PER_ENTITY),
  opaque: z.array(MapSourceOpaqueSpanSchema).max(MAX_PRIMITIVES_PER_ENTITY),
});

export const MapSourceStateSchema: z.ZodType<MapSourceState> = z.strictObject({
  originalText: z.string().max(8 * 1_024 * 1_024),
  fingerprint: z.string().min(1).max(256),
  originalDocument: MapDocumentSchema,
  format: z.literal("quake-map"),
  faceSyntax: z.enum(["valve-220", "quake"]),
  newline: z.enum(["\n", "\r\n"]),
  indent: z.string().max(64),
  entities: z.array(MapSourceEntitySpanSchema).max(MAX_ENTITIES),
  opaque: z.array(MapSourceOpaqueSpanSchema).max(MAX_PRIMITIVES_PER_ENTITY),
  diagnostics: z.array(MapSourceDiagnosticObjectSchema).max(100_000),
});

export const MapCompileDiagnosticSchema: z.ZodType<MapCompileDiagnostic> =
  z.strictObject({
    severity: z.enum(["info", "warning", "error"]),
    stage: z.string().min(1).max(256),
    message: z.string().max(16_384),
    line: nonNegativeInteger.optional(),
  });
const MapCompileArtifactObjectSchema = z.strictObject({
  name: z.string().min(1).max(MAX_TEXT_LENGTH),
  mediaType: z.string().min(1).max(256),
  data: z.instanceof(ArrayBuffer),
  kind: z.enum(["bsp", "package", "portal", "leak-path", "log", "other"]),
  stage: z.string().min(1).max(256).optional(),
});
export const MapCompileLogSchema: z.ZodType<MapCompileLog> = z.strictObject({
  stage: z.string().min(1).max(256),
  text: z.string().max(8 * 1_024 * 1_024),
  truncated: z.boolean(),
});

export const MapCompileResultSchema: z.ZodType<MapCompileResult> =
  z.strictObject({
    backend: z.enum(["wasm", "remote"]),
    status: z.enum(["succeeded", "failed"]),
    buildId: z.string().min(1).max(256),
    sourceDocumentRevision: nonNegativeInteger,
    diagnostics: z.array(MapCompileDiagnosticSchema).max(10_000),
    artifacts: z.array(MapCompileArtifactObjectSchema).max(1_000),
    logs: z.array(MapCompileLogSchema).max(1_000),
    elapsedMilliseconds: finiteNumber.nonnegative(),
  });

const CollaborationConflictSchema = z.strictObject({
  editIndex: nonNegativeInteger,
  kind: z.enum([
    "missing-target",
    "target-exists",
    "revision-mismatch",
    "invalid-geometry",
  ]),
  targetId: z.string().min(1).max(MAX_ID_LENGTH),
  message: z.string().min(1).max(MAX_TEXT_LENGTH),
});

export const CollaborationFailureSchema: z.ZodType<CollaborationFailure> =
  z.union([CollaborationConflictSchema, MapSourceDiagnosticObjectSchema]);

const InsertEntitySchema = z.strictObject({
  kind: z.literal("insert-entity"),
  insertionIndex: nonNegativeInteger,
  entity: MapEntityObjectSchema.refine(
    (entity) => entity.primitives.length === 0,
    {
      message: "inserted collaboration entities must not contain primitives",
    },
  ),
});

const CollaborationEditObjectSchema = z.discriminatedUnion("kind", [
  InsertEntitySchema,
  z.strictObject({
    kind: z.literal("delete-entity"),
    entityId: EntityIdSchema,
    baseProperties: StringPropertiesSchema,
  }),
  z.strictObject({
    kind: z.literal("replace-brush"),
    brushId: BrushIdSchema,
    baseRevision: nonNegativeInteger,
    brush: MapBrushObjectSchema,
  }),
  z.strictObject({
    kind: z.literal("insert-brush"),
    entityId: EntityIdSchema,
    insertionIndex: nonNegativeInteger,
    brush: MapBrushObjectSchema,
  }),
  z.strictObject({
    kind: z.literal("delete-brush"),
    brushId: BrushIdSchema,
    baseRevision: nonNegativeInteger,
  }),
  z.strictObject({
    kind: z.literal("move-brush"),
    brushId: BrushIdSchema,
    baseEntityId: EntityIdSchema,
    baseRevision: nonNegativeInteger,
    entityId: EntityIdSchema,
    insertionIndex: nonNegativeInteger,
  }),
  z.strictObject({
    kind: z.literal("replace-entity-properties"),
    entityId: EntityIdSchema,
    baseProperties: StringPropertiesSchema,
    properties: StringPropertiesSchema,
  }),
]);
export const CollaborationEditSchema: z.ZodType<CollaborationEdit> =
  CollaborationEditObjectSchema;

export const CollaborationOperationSchema: z.ZodType<CollaborationOperation> =
  z.strictObject({
    schemaVersion: z.literal(1),
    operationId: z.string().min(1).max(128),
    transactionId: z.string().min(1).max(128),
    actorId: z.string().min(1).max(128),
    baseMapVersion: nonNegativeInteger,
    label: z.string().min(1).max(512),
    edits: z.array(CollaborationEditObjectSchema).max(1_000),
    inverseEdits: z.array(CollaborationEditObjectSchema).max(1_000).optional(),
  });
