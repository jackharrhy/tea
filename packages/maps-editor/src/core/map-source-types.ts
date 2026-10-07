import type {
  BrushId,
  EntityId,
  FaceId,
  MapDocument,
  MapDocumentFormat,
  MapFaceSyntax,
} from "./types.js";

export interface MapSourceDiagnostic {
  readonly severity: "warning" | "error";
  readonly code:
    | "unsupported-construct"
    | "unsafe-source-edit"
    | "external-source-change";
  readonly message: string;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
  readonly keyword?: string | undefined;
}

export interface MapSourcePropertySpan {
  readonly key: string;
  readonly start: number;
  readonly end: number;
}

export interface MapSourceFaceSpan {
  readonly faceId: FaceId;
  readonly start: number;
  readonly end: number;
}

export interface MapSourceBrushSpan {
  readonly brushId: BrushId;
  readonly start: number;
  readonly end: number;
  readonly openEnd: number;
  readonly closeStart: number;
  readonly faces: readonly MapSourceFaceSpan[];
}

export interface MapSourceOpaqueSpan {
  readonly keyword: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
}

export interface MapSourceEntitySpan {
  readonly entityId: EntityId;
  readonly start: number;
  readonly end: number;
  readonly openEnd: number;
  readonly closeStart: number;
  readonly properties: readonly MapSourcePropertySpan[];
  readonly brushes: readonly MapSourceBrushSpan[];
  readonly opaque: readonly MapSourceOpaqueSpan[];
}

/** Source ownership retained beside the semantic map document. */
export interface MapSourceState {
  readonly originalText: string;
  readonly fingerprint: string;
  readonly originalDocument: MapDocument;
  readonly format: MapDocumentFormat;
  readonly faceSyntax: MapFaceSyntax;
  readonly newline: "\n" | "\r\n";
  readonly indent: string;
  readonly entities: readonly MapSourceEntitySpan[];
  readonly opaque: readonly MapSourceOpaqueSpan[];
  readonly diagnostics: readonly MapSourceDiagnostic[];
}

export interface ParsedMapSource {
  readonly document: MapDocument;
  readonly source: MapSourceState;
}

export type MapSavePlan =
  | {
      readonly status: "safe";
      readonly text: string;
      readonly diagnostics: readonly MapSourceDiagnostic[];
    }
  | {
      readonly status: "blocked";
      readonly normalizedText: string;
      readonly diagnostics: readonly MapSourceDiagnostic[];
    };
