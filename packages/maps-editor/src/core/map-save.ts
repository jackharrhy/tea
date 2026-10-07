import { parseMapSource } from "./map-parser.js";
import {
  serializeMap,
  serializeMapEntity,
  serializeMapFace,
  serializeMapPrimitive,
} from "./map-serializer.js";
import type {
  MapSavePlan,
  MapSourceBrushSpan,
  MapSourceDiagnostic,
  MapSourceEntitySpan,
  MapSourceState,
} from "./map-source-types.js";
import type {
  IdFactory,
  MapBrush,
  MapDocument,
  MapEntity,
  MapFace,
  MapPrimitive,
} from "./types.js";

interface SourcePatch {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function isPatchList(
  value: readonly SourcePatch[] | MapSourceDiagnostic,
): value is readonly SourcePatch[] {
  return Array.isArray(value);
}

function quote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;
}

function valueEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function faceEqual(left: MapFace, right: MapFace): boolean {
  if (left === right) return true;
  return (
    left.id === right.id &&
    valueEqual(left.planePoints, right.planePoints) &&
    left.material === right.material &&
    valueEqual(left.projection, right.projection) &&
    valueEqual(left.surface, right.surface)
  );
}

function brushEqual(left: MapBrush, right: MapBrush): boolean {
  if (left === right) return true;
  return (
    left.id === right.id &&
    left.faces.length === right.faces.length &&
    left.faces.every((face, index) => faceEqual(face, right.faces[index]!))
  );
}

function primitiveEqual(left: MapPrimitive, right: MapPrimitive): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "brush" && right.kind === "brush"
    ? brushEqual(left, right)
    : valueEqual(left, right);
}

function entityEqual(left: MapEntity, right: MapEntity): boolean {
  if (left === right) return true;
  return (
    left.id === right.id &&
    valueEqual(left.properties, right.properties) &&
    left.primitives.length === right.primitives.length &&
    left.primitives.every((primitive, index) =>
      primitiveEqual(primitive, right.primitives[index]!),
    )
  );
}

function retainedOrderChanged<T extends { readonly id: string }>(
  original: readonly T[],
  current: readonly T[],
): boolean {
  const currentIds = new Set(current.map(({ id }) => id));
  const originalIds = new Set(original.map(({ id }) => id));
  return (
    original
      .filter(({ id }) => currentIds.has(id))
      .map(({ id }) => id)
      .join("\0") !==
    current
      .filter(({ id }) => originalIds.has(id))
      .map(({ id }) => id)
      .join("\0")
  );
}

function lineIndentAt(
  source: string,
  offset: number,
  fallback: string,
): string {
  const lineStart = Math.max(source.lastIndexOf("\n", offset - 1) + 1, 0);
  const prefix = source.slice(lineStart, offset);
  return /^[ \t]*$/.test(prefix) ? prefix : fallback;
}

function localizeNewlines(text: string, newline: "\n" | "\r\n"): string {
  return newline === "\n" ? text : text.replaceAll("\n", "\r\n");
}

function unsafe(message: string): MapSourceDiagnostic {
  return { severity: "error", code: "unsafe-source-edit", message };
}

function entityPatches(
  original: MapEntity,
  current: MapEntity,
  span: MapSourceEntitySpan,
  state: MapSourceState,
  valve220: boolean,
): readonly SourcePatch[] | MapSourceDiagnostic {
  if (
    entityEqual(original, current) &&
    state.faceSyntax === (valve220 ? "valve-220" : "quake")
  )
    return [];
  if (retainedOrderChanged(original.primitives, current.primitives)) {
    return unsafe(
      `Entity ${current.id} reordered existing brushes and cannot be source-patched safely`,
    );
  }

  const patches: SourcePatch[] = [];
  const source = state.originalText;
  const newline = state.newline;
  const propertySpans = new Map<string, typeof span.properties>();
  for (const property of span.properties) {
    propertySpans.set(property.key, [
      ...(propertySpans.get(property.key) ?? []),
      property,
    ]);
  }
  for (const [key, originalValue] of Object.entries(original.properties)) {
    const currentValue = current.properties[key];
    if (currentValue === originalValue) continue;
    const spans = propertySpans.get(key) ?? [];
    if (currentValue === undefined) {
      for (const property of spans)
        patches.push({ start: property.start, end: property.end, text: "" });
    } else if (spans.length > 0) {
      const property = spans.at(-1)!;
      patches.push({
        start: property.start,
        end: property.end,
        text: `${quote(key)} ${quote(currentValue)}`,
      });
    }
  }
  const existingPropertyKeys = new Set(Object.keys(original.properties));
  const newProperties = Object.entries(current.properties).filter(
    ([key]) => !existingPropertyKeys.has(key),
  );
  if (newProperties.length > 0) {
    const propertyIndent = span.properties[0]
      ? lineIndentAt(source, span.properties[0].start, state.indent)
      : state.indent;
    patches.push({
      start: span.openEnd,
      end: span.openEnd,
      text: `${newline}${newProperties.map(([key, value]) => `${propertyIndent}${quote(key)} ${quote(value)}`).join(newline)}`,
    });
  }

  const currentBrushes = new Map(
    current.primitives.map((brush) => [brush.id, brush]),
  );
  const originalBrushes = new Map(
    original.primitives.map((brush) => [brush.id, brush]),
  );
  const spanByBrush = new Map(
    span.brushes.map((brush) => [brush.brushId, brush]),
  );
  for (const originalBrush of original.primitives) {
    const currentBrush = currentBrushes.get(originalBrush.id);
    if (originalBrush.kind !== "brush") {
      if (!currentBrush)
        return unsafe(`Primitive ${originalBrush.id} cannot be deleted safely`);
      if (!primitiveEqual(originalBrush, currentBrush))
        return unsafe(
          `Primitive ${originalBrush.id} cannot be source-patched safely`,
        );
      continue;
    }
    const brushSpan = spanByBrush.get(originalBrush.id);
    if (!brushSpan)
      return unsafe(`Brush ${originalBrush.id} has no retained source anchor`);
    if (!currentBrush) {
      patches.push({ start: brushSpan.start, end: brushSpan.end, text: "" });
      continue;
    }
    if (currentBrush.kind !== "brush")
      return unsafe(`Brush ${originalBrush.id} changed primitive kind`);
    const result = brushPatches(
      originalBrush,
      currentBrush,
      brushSpan,
      state,
      valve220,
    );
    if (!isPatchList(result)) return result;
    patches.push(...result);
  }
  const newBrushes = current.primitives.filter(
    ({ id }) => !originalBrushes.has(id),
  );
  if (newBrushes.length > 0) {
    const brushIndent = span.brushes[0]
      ? lineIndentAt(source, span.brushes[0].start, state.indent)
      : state.indent;
    const serialized = newBrushes
      .map((brush) =>
        localizeNewlines(serializeMapPrimitive(brush, valve220), newline)
          .split(newline)
          .map((line) => `${brushIndent}${line}`)
          .join(newline),
      )
      .join(newline);
    patches.push({
      start: span.closeStart,
      end: span.closeStart,
      text: `${serialized}${newline}`,
    });
  }
  return patches;
}

function brushPatches(
  original: MapBrush,
  current: MapBrush,
  span: MapSourceBrushSpan,
  state: MapSourceState,
  valve220: boolean,
): readonly SourcePatch[] | MapSourceDiagnostic {
  if (
    brushEqual(original, current) &&
    state.faceSyntax === (valve220 ? "valve-220" : "quake")
  )
    return [];
  if (retainedOrderChanged(original.faces, current.faces)) {
    return unsafe(
      `Brush ${current.id} reordered existing faces and cannot be source-patched safely`,
    );
  }
  const patches: SourcePatch[] = [];
  const currentFaces = new Map(current.faces.map((face) => [face.id, face]));
  const originalFaces = new Map(original.faces.map((face) => [face.id, face]));
  const spanByFace = new Map(span.faces.map((face) => [face.faceId, face]));
  for (const originalFace of original.faces) {
    const currentFace = currentFaces.get(originalFace.id);
    const faceSpan = spanByFace.get(originalFace.id);
    if (!faceSpan)
      return unsafe(`Face ${originalFace.id} has no retained source anchor`);
    if (!currentFace)
      patches.push({ start: faceSpan.start, end: faceSpan.end, text: "" });
    else if (
      !faceEqual(originalFace, currentFace) ||
      state.faceSyntax !== (valve220 ? "valve-220" : "quake")
    ) {
      patches.push({
        start: faceSpan.start,
        end: faceSpan.end,
        text: serializeMapFace(currentFace, valve220),
      });
    }
  }
  const newFaces = current.faces.filter(({ id }) => !originalFaces.has(id));
  if (newFaces.length > 0) {
    const faceIndent = span.faces[0]
      ? lineIndentAt(state.originalText, span.faces[0].start, state.indent)
      : state.indent;
    patches.push({
      start: span.closeStart,
      end: span.closeStart,
      text: `${newFaces.map((face) => `${faceIndent}${serializeMapFace(face, valve220)}`).join(state.newline)}${state.newline}`,
    });
  }
  return patches;
}

function applyPatches(source: string, patches: readonly SourcePatch[]): string {
  const ordered = patches.toSorted(
    (left, right) => right.start - left.start || right.end - left.end,
  );
  let previousStart = source.length + 1;
  let result = source;
  for (const patch of ordered) {
    if (patch.end > previousStart)
      throw new Error("Map source patches overlap");
    result = `${result.slice(0, patch.start)}${patch.text}${result.slice(patch.end)}`;
    previousStart = patch.start;
  }
  return result;
}

/** Plans a structure-preserving save or returns a normalized copy with blocking diagnostics. */
export function planMapSave(
  document: MapDocument,
  state: MapSourceState,
): MapSavePlan {
  const blocked = (diagnostic: MapSourceDiagnostic): MapSavePlan => ({
    status: "blocked",
    normalizedText: serializeMap(document),
    diagnostics: [diagnostic],
  });
  if (
    retainedOrderChanged(state.originalDocument.entities, document.entities)
  ) {
    return blocked(
      unsafe(
        "Existing entities were reordered and cannot be source-patched safely",
      ),
    );
  }
  const patches: SourcePatch[] = [];
  const currentEntities = new Map(
    document.entities.map((entity) => [entity.id, entity]),
  );
  const originalEntities = new Map(
    state.originalDocument.entities.map((entity) => [entity.id, entity]),
  );
  const spanByEntity = new Map(
    state.entities.map((entity) => [entity.entityId, entity]),
  );
  for (const original of state.originalDocument.entities) {
    const current = currentEntities.get(original.id);
    const span = spanByEntity.get(original.id);
    if (!span) {
      return blocked(
        unsafe(`Entity ${original.id} has no retained source anchor`),
      );
    }
    if (!current) {
      if (span.opaque.length > 0) {
        return blocked(
          unsafe(
            `Entity ${original.id} owns unsupported source that cannot be reanchored after deletion`,
          ),
        );
      }
      patches.push({ start: span.start, end: span.end, text: "" });
      continue;
    }
    const result = entityPatches(
      original,
      current,
      span,
      state,
      document.faceSyntax === "valve-220",
    );
    if (!isPatchList(result)) {
      return blocked(result);
    }
    patches.push(...result);
  }
  const newEntities = document.entities.filter(
    ({ id }) => !originalEntities.has(id),
  );
  if (newEntities.length > 0) {
    const serialized = newEntities
      .map((entity) =>
        localizeNewlines(
          serializeMapEntity(entity, document.faceSyntax === "valve-220"),
          state.newline,
        ),
      )
      .join(state.newline);
    const prefix = state.originalText.endsWith("\n") ? "" : state.newline;
    patches.push({
      start: state.originalText.length,
      end: state.originalText.length,
      text: `${prefix}${serialized}${state.newline}`,
    });
  }
  return {
    status: "safe",
    text: applyPatches(state.originalText, patches),
    diagnostics: [],
  };
}

function replayIds(document: MapDocument): IdFactory {
  const entities = [...document.entities];
  const primitives = document.entities.flatMap((entity) => entity.primitives);
  const brushes = primitives.filter((primitive) => primitive.kind === "brush");
  const patches = primitives.filter((primitive) => primitive.kind === "patch");
  const brushDefs = primitives.filter(
    (primitive) => primitive.kind === "brush-def",
  );
  const faceIds = primitives.flatMap((primitive) =>
    primitive.kind === "brush"
      ? primitive.faces.map((face) => face.id)
      : primitive.kind === "brush-def"
        ? primitive.faces.map((face) => face.id)
        : [],
  );
  return {
    document: () => document.id,
    entity: () => entities.shift()!.id,
    brush: () => brushes.shift()!.id,
    patch: () => patches.shift()!.id,
    brushDef: () => brushDefs.shift()!.id,
    face: () => faceIds.shift()!,
  };
}

/** Rebuilds source anchors after a confirmed successful save without changing stable object IDs. */
export function rebaseMapSource(
  document: MapDocument,
  savedText: string,
): MapSourceState {
  return parseMapSource(savedText, replayIds(document)).source;
}
