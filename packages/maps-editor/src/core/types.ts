import type { Vec3Tuple } from "@jackharrhy/tea-maps-renderer/core";

export type Vec2 = readonly [number, number];
export type Vec3 = Vec3Tuple;

declare const idBrand: unique symbol;
type BrandedId<Name extends string> = string & { readonly [idBrand]: Name };

export type DocumentId = BrandedId<"document">;
export type EntityId = BrandedId<"entity">;
export type PrimitiveId = BrandedId<"primitive">;
/** Legacy brush-tool name for the shared primitive identifier namespace. */
export type BrushId = PrimitiveId;
export type PatchId = PrimitiveId;
export type BrushDefId = PrimitiveId;
export type FaceId = BrandedId<"face">;

export type MapDocumentFormat = "quake-map";
export type MapFaceSyntax = "valve-220" | "quake";

interface TextureProjectionBase {
  /** Valve 220 world-space texture axes. */
  readonly uAxis: Vec3;
  readonly vAxis: Vec3;
  /** Texture-space translation in texels. */
  readonly offset: Vec2;
  /** Retained for compatible serialization and texture-tool presentation. */
  readonly rotationDegrees: number;
  readonly scale: Vec2;
}

export interface AxialTextureProjection extends TextureProjectionBase {
  readonly kind: "axial";
}

export interface Valve220TextureProjection extends TextureProjectionBase {
  readonly kind: "valve-220";
}

export type TextureProjection =
  | AxialTextureProjection
  | Valve220TextureProjection;

export interface SurfaceAttributes {
  readonly contents?: number | undefined;
  readonly flags?: number | undefined;
  readonly value?: number | undefined;
}

export interface MapFace {
  readonly id: FaceId;
  readonly planePoints: readonly [Vec3, Vec3, Vec3];
  readonly material: string;
  readonly projection: TextureProjection;
  readonly surface: SurfaceAttributes;
}

export interface MapBrush {
  readonly kind: "brush";
  readonly id: BrushId;
  readonly revision: number;
  readonly faces: readonly MapFace[];
}

export interface MapPatchPoint {
  readonly position: Vec3;
  readonly uv: Vec2;
}

export interface MapPatch {
  readonly kind: "patch";
  readonly id: PatchId;
  readonly revision: number;
  readonly material: string;
  readonly dimensions: readonly [number, number];
  readonly subdivisions: readonly [number, number, number];
  readonly controlPoints: readonly (readonly MapPatchPoint[])[];
}

export interface MapBrushDefFace {
  readonly id: FaceId;
  readonly planePoints: readonly [Vec3, Vec3, Vec3];
  readonly textureMatrix: readonly [Vec3, Vec3];
  readonly material: string;
  readonly surface: SurfaceAttributes;
}

export interface MapBrushDef {
  readonly kind: "brush-def";
  readonly id: BrushDefId;
  readonly revision: number;
  readonly faces: readonly MapBrushDefFace[];
}

/** Closed semantic primitive union. Tool support must explicitly narrow by primitive kind. */
export type MapPrimitive = MapBrush | MapPatch | MapBrushDef;

export interface MapEntity {
  readonly id: EntityId;
  readonly properties: Readonly<Record<string, string>>;
  readonly primitives: readonly MapPrimitive[];
}

export interface MapDocument {
  readonly id: DocumentId;
  readonly revision: number;
  readonly format: MapDocumentFormat;
  readonly faceSyntax: MapFaceSyntax;
  readonly entities: readonly MapEntity[];
}

/** Brush-only interchange used by prefabs, clipboard adapters, and geometry test fixtures. */
export interface MapFragment {
  readonly format: "quake-map";
  readonly faceSyntax: MapFaceSyntax;
  readonly primitives: readonly MapBrush[];
}

export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface GeometryDiagnostic {
  readonly severity: "warning" | "error";
  readonly code:
    | "too-few-faces"
    | "degenerate-plane"
    | "open-face"
    | "empty-brush"
    | "unbounded-brush";
  readonly message: string;
  readonly faceId?: FaceId;
}

export interface DerivedFace {
  readonly faceId: FaceId;
  readonly material: string;
  readonly normal: Vec3;
  readonly distance: number;
  readonly vertices: readonly Vec3[];
  readonly textureCoordinates: readonly Vec2[];
}

export interface DerivedEdge {
  readonly start: Vec3;
  readonly end: Vec3;
}

export interface DerivedBrush {
  readonly brushId: BrushId;
  readonly sourceRevision: number;
  readonly valid: boolean;
  readonly bounds: Bounds | null;
  readonly faces: readonly DerivedFace[];
  readonly edges: readonly DerivedEdge[];
  /** Interleaved position, normal, and texel-space UV values. */
  readonly vertices: Float32Array;
  readonly diagnostics: readonly GeometryDiagnostic[];
}

export interface FaceSelection {
  readonly brushId: BrushId;
  readonly faceId: FaceId;
}

export interface BrushSelection {
  /** Non-serialized persistent group ID when this aggregate selection represents one closed group. */
  readonly groupId?: string;
  /** The primary brush used by single-object tools and inspector presentation. */
  readonly brushId: BrushId;
  /** Normalized multi-brush selection, including the primary brush; omitted for single/face selections. */
  readonly brushIds?: readonly BrushId[];
  /** The primary face. Its presence distinguishes face selection from object selection. */
  readonly faceId?: FaceId;
  /** Normalized multi-face selection, including the primary face; omitted for single/object selections. */
  readonly faces?: readonly FaceSelection[];
  /** Point entities retained when an additive object selection is mixed. */
  readonly entityIds?: readonly EntityId[];
  readonly entityId?: undefined;
}

/** An object selection whose primary object is a point entity. */
export interface PointEntitySelection {
  /** Non-serialized persistent group ID when this aggregate selection represents one closed group. */
  readonly groupId?: string;
  readonly entityId: EntityId;
  readonly entityIds?: readonly EntityId[];
  /** Brushes retained when an additive object selection is mixed. */
  readonly brushIds?: readonly BrushId[];
  readonly brushId?: undefined;
  readonly faceId?: undefined;
  readonly faces?: undefined;
}

export type EditorSelection = BrushSelection | PointEntitySelection;

/** Non-serialized authoring state for viewport clutter and edit protection. */
export interface EditorObjectViewState {
  readonly hiddenBrushIds: readonly BrushId[];
  readonly hiddenEntityIds: readonly EntityId[];
  readonly lockedBrushIds: readonly BrushId[];
  readonly lockedEntityIds: readonly EntityId[];
}

export interface IdFactory {
  document(): DocumentId;
  entity(): EntityId;
  brush(): BrushId;
  patch(): PatchId;
  brushDef(): BrushDefId;
  face(): FaceId;
}

export function createSequentialIdFactory(prefix = "maps"): IdFactory {
  let document = 0;
  let entity = 0;
  let brush = 0;
  let patch = 0;
  let brushDef = 0;
  let face = 0;
  return {
    document: () => `${prefix}-document-${++document}` as DocumentId,
    entity: () => `${prefix}-entity-${++entity}` as EntityId,
    brush: () => `${prefix}-brush-${++brush}` as PrimitiveId,
    patch: () => `${prefix}-patch-${++patch}` as PrimitiveId,
    brushDef: () => `${prefix}-brush-def-${++brushDef}` as PrimitiveId,
    face: () => `${prefix}-face-${++face}` as FaceId,
  };
}

const documentPrimitives = new WeakMap<MapDocument, readonly MapPrimitive[]>();
const documentPrimitivesById = new WeakMap<
  MapDocument,
  ReadonlyMap<MapPrimitive["id"], MapPrimitive>
>();

export function primitivesInDocument(
  document: MapDocument,
): readonly MapPrimitive[] {
  const cached = documentPrimitives.get(document);
  if (cached) return cached;
  const primitives = document.entities.flatMap((entity) => entity.primitives);
  documentPrimitives.set(document, primitives);
  return primitives;
}

export function findPrimitive(
  document: MapDocument,
  primitiveId: MapPrimitive["id"],
): MapPrimitive | null {
  let primitivesById = documentPrimitivesById.get(document);
  if (!primitivesById) {
    primitivesById = new Map(
      primitivesInDocument(document).map(
        (primitive) => [primitive.id, primitive] as const,
      ),
    );
    documentPrimitivesById.set(document, primitivesById);
  }
  return primitivesById.get(primitiveId) ?? null;
}

export function brushesInDocument(document: MapDocument): readonly MapBrush[] {
  return primitivesInDocument(document).filter(
    (primitive): primitive is MapBrush => primitive.kind === "brush",
  );
}

export function brushesInEntity(entity: MapEntity): readonly MapBrush[] {
  return entity.primitives.filter(
    (primitive): primitive is MapBrush => primitive.kind === "brush",
  );
}

export function patchesInDocument(document: MapDocument): readonly MapPatch[] {
  return primitivesInDocument(document).filter(
    (primitive): primitive is MapPatch => primitive.kind === "patch",
  );
}

export function brushDefsInDocument(
  document: MapDocument,
): readonly MapBrushDef[] {
  return primitivesInDocument(document).filter(
    (primitive): primitive is MapBrushDef => primitive.kind === "brush-def",
  );
}

export function isMapBrush(primitive: MapPrimitive): primitive is MapBrush {
  return primitive.kind === "brush";
}

export function findBrush(
  document: MapDocument,
  brushId: BrushId,
): MapBrush | null {
  const primitive = findPrimitive(document, brushId);
  return primitive?.kind === "brush" ? primitive : null;
}
