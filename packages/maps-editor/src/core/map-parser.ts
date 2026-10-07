import { defaultTextureProjection } from "./document.js";
import { planeFromPoints, rotateAroundAxis } from "./math.js";
import type {
  IdFactory,
  MapBrush,
  MapDocument,
  MapEntity,
  MapFace,
  MapFaceSyntax,
  MapFragment,
  MapPrimitive,
  MapPatch,
  MapBrushDef,
  MapBrushDefFace,
  SurfaceAttributes,
  TextureProjection,
  Vec3,
} from "./types.js";
import { createSequentialIdFactory } from "./types.js";
import { MapParseError } from "./map-parser-error.js";
import { tokenizeMapSource, type MapToken as Token } from "./map-tokenizer.js";
import type {
  MapSourceBrushSpan,
  MapSourceDiagnostic,
  MapSourceEntitySpan,
  MapSourceFaceSpan,
  MapSourceOpaqueSpan,
  MapSourcePropertySpan,
  MapSourceState,
  ParsedMapSource,
} from "./map-source-types.js";

class Parser {
  private readonly tokens: readonly Token[];
  private index = 0;
  private faceSyntax: MapFaceSyntax = "quake";
  private readonly entitySpans: MapSourceEntitySpan[] = [];
  private readonly rootOpaque: MapSourceOpaqueSpan[] = [];
  private readonly diagnostics: MapSourceDiagnostic[] = [];

  public constructor(
    source: string,
    private readonly ids: IdFactory,
  ) {
    const tokenized = tokenizeMapSource(source);
    this.tokens = tokenized.tokens;
    this.faceSyntax = tokenized.faceSyntaxHint ?? "quake";
  }

  public parse(): MapDocument {
    const entities: MapEntity[] = [];
    while (this.peek()) {
      if (this.check("{")) entities.push(this.parseEntity());
      else this.rootOpaque.push(this.skipOpaqueConstruct());
    }
    if (entities.length === 0)
      throw new MapParseError("Map contains no entities", 1, 1);
    return {
      id: this.ids.document(),
      revision: 0,
      format: "quake-map",
      faceSyntax: this.faceSyntax,
      entities,
    };
  }

  public parseFragment(): MapFragment {
    const primitives: MapBrush[] = [];
    while (this.peek()) primitives.push(this.parseBrush().brush);
    if (primitives.length === 0)
      throw new MapParseError("Map fragment contains no brushes", 1, 1);
    return { format: "quake-map", faceSyntax: this.faceSyntax, primitives };
  }

  public sourceState(source: string, document: MapDocument): MapSourceState {
    return {
      originalText: source,
      fingerprint: mapSourceFingerprint(source),
      originalDocument: document,
      format: document.format,
      faceSyntax: document.faceSyntax,
      newline: source.includes("\r\n") ? "\r\n" : "\n",
      indent: inferIndent(source),
      entities: this.entitySpans,
      opaque: this.rootOpaque,
      diagnostics: this.diagnostics,
    };
  }

  private parseEntity(): MapEntity {
    const opening = this.expect("{");
    const properties: Record<string, string> = {};
    const primitives: MapPrimitive[] = [];
    const propertySpans: MapSourcePropertySpan[] = [];
    const brushSpans: MapSourceBrushSpan[] = [];
    const opaque: MapSourceOpaqueSpan[] = [];
    while (!this.check("}")) {
      if (this.check("{")) {
        if (this.peek(1)?.value === "(" || this.peek(1)?.value === "}") {
          const parsed = this.parseBrush();
          primitives.push(parsed.brush);
          brushSpans.push(parsed.span);
        } else if (this.peek(1)?.value === "patchDef2") {
          primitives.push(this.parsePatch());
        } else if (this.peek(1)?.value === "brushDef") {
          primitives.push(this.parseBrushDef());
        } else {
          opaque.push(this.skipOpaquePrimitive());
        }
      } else if (this.peek(1)?.value === "{") {
        opaque.push(this.skipOpaqueConstruct());
      } else {
        const key = this.takeValueToken("Expected an entity property name");
        const value = this.takeValueToken(
          `Expected a value for entity property ${key.value}`,
        );
        properties[key.value] = value.value;
        propertySpans.push({
          key: key.value,
          start: key.start,
          end: value.end,
        });
      }
    }
    const closing = this.expect("}");
    const entity = { id: this.ids.entity(), properties, primitives };
    this.entitySpans.push({
      entityId: entity.id,
      start: opening.start,
      end: closing.end,
      openEnd: opening.end,
      closeStart: closing.start,
      properties: propertySpans,
      brushes: brushSpans,
      opaque,
    });
    return entity;
  }

  private parseBrush(): {
    readonly brush: MapBrush;
    readonly span: MapSourceBrushSpan;
  } {
    const opening = this.expect("{");
    const faces: MapFace[] = [];
    const faceSpans: Omit<MapSourceFaceSpan, "faceId">[] = [];
    while (!this.check("}")) {
      const parsed = this.parseFace();
      faces.push(parsed.face);
      faceSpans.push(parsed.span);
    }
    const closing = this.expect("}");
    const brush = {
      kind: "brush" as const,
      id: this.ids.brush(),
      revision: 0,
      faces,
    };
    return {
      brush,
      span: {
        brushId: brush.id,
        start: opening.start,
        end: closing.end,
        openEnd: opening.end,
        closeStart: closing.start,
        faces: faceSpans.map((span, index) => ({
          start: span.start,
          end: span.end,
          faceId: faces[index]!.id,
        })),
      },
    };
  }

  private parsePatch(): MapPatch {
    this.expect("{");
    this.expect("patchDef2");
    this.expect("{");
    const material = this.takeMaterial();
    this.expect("(");
    const dimensions = [
      this.takeInteger("Expected patch width"),
      this.takeInteger("Expected patch height"),
    ] as const;
    const subdivisions = [
      this.takeInteger("Expected patch subdivision"),
      this.takeInteger("Expected patch subdivision"),
      this.takeInteger("Expected patch subdivision"),
    ] as const;
    this.expect(")");
    this.expect("(");
    const controlPoints: MapPatch["controlPoints"][number][] = [];
    while (!this.check(")")) {
      this.expect("(");
      const row: MapPatch["controlPoints"][number][number][] = [];
      while (!this.check(")")) {
        this.expect("(");
        row.push({
          position: [
            this.takeNumber("Expected patch X coordinate"),
            this.takeNumber("Expected patch Y coordinate"),
            this.takeNumber("Expected patch Z coordinate"),
          ],
          uv: [
            this.takeNumber("Expected patch U coordinate"),
            this.takeNumber("Expected patch V coordinate"),
          ],
        });
        this.expect(")");
      }
      this.expect(")");
      controlPoints.push(row);
    }
    this.expect(")");
    this.expect("}");
    this.expect("}");
    if (
      controlPoints.length !== dimensions[1] ||
      controlPoints.some((row) => row.length !== dimensions[0])
    ) {
      const token = this.tokens[Math.max(0, this.index - 1)]!;
      throw new MapParseError(
        "Patch control grid does not match its dimensions",
        token.line,
        token.column,
      );
    }
    return {
      kind: "patch",
      id: this.ids.patch(),
      revision: 0,
      material,
      dimensions,
      subdivisions,
      controlPoints,
    };
  }

  private parseBrushDef(): MapBrushDef {
    this.expect("{");
    this.expect("brushDef");
    this.expect("{");
    const faces: MapBrushDefFace[] = [];
    while (!this.check("}")) {
      const planePoints = [
        this.parsePoint(),
        this.parsePoint(),
        this.parsePoint(),
      ] as const;
      this.expect("(");
      const textureMatrix = [
        this.parseMatrixRow(),
        this.parseMatrixRow(),
      ] as const;
      this.expect(")");
      const material = this.takeMaterial();
      const surface = this.takeSurfaceAttributes();
      faces.push({
        id: this.ids.face(),
        planePoints,
        textureMatrix,
        material,
        surface,
      });
    }
    this.expect("}");
    this.expect("}");
    return { kind: "brush-def", id: this.ids.brushDef(), revision: 0, faces };
  }

  private parseMatrixRow(): Vec3 {
    this.expect("(");
    const row: Vec3 = [
      this.takeNumber("Expected texture-matrix component"),
      this.takeNumber("Expected texture-matrix component"),
      this.takeNumber("Expected texture-matrix component"),
    ];
    this.expect(")");
    return row;
  }

  private parseFace(): {
    readonly face: MapFace;
    readonly span: Omit<MapSourceFaceSpan, "faceId">;
  } {
    const start = this.peek()?.start ?? 0;
    const points: [Vec3, Vec3, Vec3] = [
      this.parsePoint(),
      this.parsePoint(),
      this.parsePoint(),
    ];
    const material = this.takeMaterial();
    let projection: TextureProjection;
    if (this.check("[")) {
      this.faceSyntax = "valve-220";
      const u = this.parseAxis();
      const v = this.parseAxis();
      const rotationDegrees = this.takeNumber("Expected texture rotation");
      const scaleU = this.takeNumber("Expected U texture scale");
      const scaleV = this.takeNumber("Expected V texture scale");
      projection = {
        kind: "valve-220",
        uAxis: u.axis,
        vAxis: v.axis,
        offset: [u.offset, v.offset],
        rotationDegrees,
        scale: [scaleU, scaleV],
      };
    } else {
      const offsetU = this.takeNumber("Expected U texture offset");
      const offsetV = this.takeNumber("Expected V texture offset");
      const rotationDegrees = this.takeNumber("Expected texture rotation");
      const scaleU = this.takeNumber("Expected U texture scale");
      const scaleV = this.takeNumber("Expected V texture scale");
      const plane = planeFromPoints(points);
      if (!plane) {
        const token = this.tokens[Math.max(0, this.index - 1)]!;
        throw new MapParseError(
          "Face points are collinear",
          token.line,
          token.column,
        );
      }
      const base = defaultTextureProjection(plane.normal);
      const radians = (rotationDegrees * Math.PI) / 180;
      projection = {
        kind: "axial",
        uAxis: rotateAroundAxis(base.uAxis, plane.normal, radians),
        vAxis: rotateAroundAxis(base.vAxis, plane.normal, radians),
        offset: [offsetU, offsetV],
        rotationDegrees,
        scale: [scaleU, scaleV],
      };
    }
    const surface = this.takeSurfaceAttributes();
    const face = {
      id: this.ids.face(),
      planePoints: points,
      material,
      projection,
      surface,
    };
    return {
      face,
      span: {
        start,
        end: this.tokens[Math.max(0, this.index - 1)]?.end ?? start,
      },
    };
  }

  private takeSurfaceAttributes(): SurfaceAttributes {
    const valueLine = this.tokens[Math.max(0, this.index - 1)]?.line;
    const extra: number[] = [];
    while (
      this.peek()?.line === valueLine &&
      !this.check("(") &&
      !this.check("}")
    ) {
      const token = this.peek()!;
      const value = Number(token.value);
      if (!Number.isFinite(value)) break;
      extra.push(value);
      this.index += 1;
    }
    const surface: SurfaceAttributes = {};
    if (extra[0] !== undefined) Object.assign(surface, { contents: extra[0] });
    if (extra[1] !== undefined) Object.assign(surface, { flags: extra[1] });
    if (extra[2] !== undefined) Object.assign(surface, { value: extra[2] });
    return surface;
  }

  private parsePoint(): Vec3 {
    this.expect("(");
    const point: Vec3 = [
      this.takeNumber("Expected X plane coordinate"),
      this.takeNumber("Expected Y plane coordinate"),
      this.takeNumber("Expected Z plane coordinate"),
    ];
    this.expect(")");
    return point;
  }

  private parseAxis(): { readonly axis: Vec3; readonly offset: number } {
    this.expect("[");
    const axis: Vec3 = [
      this.takeNumber("Expected texture-axis X component"),
      this.takeNumber("Expected texture-axis Y component"),
      this.takeNumber("Expected texture-axis Z component"),
    ];
    const offset = this.takeNumber("Expected texture-axis offset");
    this.expect("]");
    return { axis, offset };
  }

  private takeMaterial(): string {
    const first = this.peek();
    if (
      !first ||
      (first.kind === "symbol" && first.value !== "{" && first.value !== "}")
    ) {
      throw new MapParseError(
        "Expected a face material",
        first?.line ?? 1,
        first?.column ?? 1,
      );
    }
    if (first.kind === "string") {
      this.index += 1;
      return first.value;
    }
    let material = "";
    let end = first.start;
    while (true) {
      const token = this.peek();
      if (
        !token ||
        (material.length > 0 && token.start !== end) ||
        (token.kind === "symbol" && token.value !== "{" && token.value !== "}")
      ) {
        break;
      }
      material += token.value;
      end = token.end;
      this.index += 1;
    }
    if (material === "{" || material === "}") {
      throw new MapParseError(
        "Expected a face material",
        first.line,
        first.column,
      );
    }
    return material;
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.index + offset];
  }

  private check(value: string): boolean {
    return this.peek()?.value === value;
  }

  private expect(value: string): Token {
    const token = this.peek();
    if (!token || token.value !== value) {
      throw new MapParseError(
        `Expected '${value}'`,
        token?.line ?? 1,
        token?.column ?? 1,
      );
    }
    this.index += 1;
    return token;
  }

  private takeValue(message: string): string {
    return this.takeValueToken(message).value;
  }

  private takeValueToken(message: string): Token {
    const token = this.peek();
    if (!token || token.kind === "symbol") {
      throw new MapParseError(message, token?.line ?? 1, token?.column ?? 1);
    }
    this.index += 1;
    return token;
  }

  private takeNumber(message: string): number {
    const token = this.peek();
    const value = token ? Number(token.value) : Number.NaN;
    if (!token || !Number.isFinite(value)) {
      throw new MapParseError(message, token?.line ?? 1, token?.column ?? 1);
    }
    this.index += 1;
    return value;
  }

  private takeInteger(message: string): number {
    const token = this.peek();
    const value = token ? Number(token.value) : Number.NaN;
    if (!token || !Number.isSafeInteger(value)) {
      throw new MapParseError(message, token?.line ?? 1, token?.column ?? 1);
    }
    this.index += 1;
    return value;
  }

  private skipOpaqueConstruct(): MapSourceOpaqueSpan {
    const keyword = this.takeValueToken(
      "Expected an unsupported construct name",
    );
    const opening = this.expect("{");
    let depth = 1;
    let closing = opening;
    while (depth > 0) {
      const token = this.peek();
      if (!token)
        throw new MapParseError(
          "Unterminated unsupported construct",
          keyword.line,
          keyword.column,
        );
      this.index += 1;
      if (token.value === "{") depth += 1;
      else if (token.value === "}") depth -= 1;
      closing = token;
    }
    const span: MapSourceOpaqueSpan = {
      keyword: keyword.value,
      start: keyword.start,
      end: closing.end,
      line: keyword.line,
      column: keyword.column,
    };
    this.diagnostics.push({
      severity: "warning",
      code: "unsupported-construct",
      message: `${keyword.value} is preserved as opaque map source`,
      line: keyword.line,
      column: keyword.column,
      keyword: keyword.value,
    });
    return span;
  }

  private skipOpaquePrimitive(): MapSourceOpaqueSpan {
    const opening = this.expect("{");
    const span = this.skipOpaqueConstruct();
    const closing = this.expect("}");
    return { ...span, start: opening.start, end: closing.end };
  }
}

function inferIndent(source: string): string {
  const match = /(?:^|\r?\n)([ \t]+)(?:"|\()/m.exec(source);
  return match?.[1] ?? "";
}

export function mapSourceFingerprint(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}:${source.length}`;
}

export function parseMap(
  source: string,
  ids: IdFactory = createSequentialIdFactory("parsed"),
): MapDocument {
  return new Parser(source, ids).parse();
}

export function parseMapSource(
  source: string,
  ids: IdFactory = createSequentialIdFactory("parsed"),
): ParsedMapSource {
  const parser = new Parser(source, ids);
  const document = parser.parse();
  return { document, source: parser.sourceState(source, document) };
}

export function parseMapFragment(
  source: string,
  ids: IdFactory = createSequentialIdFactory("fragment"),
): MapFragment {
  return new Parser(source, ids).parseFragment();
}

export { MapParseError } from "./map-parser-error.js";
