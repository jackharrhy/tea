import {
  brushVertices,
  deriveBrush,
  deriveEditorGroups,
  deriveEntityLinks,
  findBrush,
  extrudableBrushFaces,
  isBrushSelected,
  isFaceSelected,
  isPointEntitySelected,
  linkedGroupCenter,
  pointEntitiesInDocument,
  pointEntityBounds,
  pointEntityYawDegrees,
  selectedBrushIds,
  selectedEditorGroup,
  selectedEntityIdsForLinks,
  selectedFaceReferences,
  selectedPointEntityIds,
  visibleEntityLinks,
  type Bounds,
  type FaceSelection,
  type BrushId,
  type EditorObjectViewState,
  type EditorSelection,
  type EntityDefinitionCatalog,
  type EntityId,
  type EntityLinkMode,
  type MapDocument,
  type Vec3,
} from "../core/index.js";
import {
  appendBoundsWireframe,
  appendSelectionBoundsGuide,
  selectionContainsHoveredObject,
} from "./bounds-overlays.js";
import { buildHullOverlay } from "./hull-overlay.js";
import { uploadFloatBuffer } from "./gpu-buffer.js";
import {
  appendMovementTrace,
  appendPointEntityHeading,
  appendProjectedFaceGrid,
  appendSweepOverlay,
  appendTopologyMarker,
} from "./scene-tool-overlays.js";
import type { LineBuffer, ToolPreviewBuffers } from "./scene-types.js";
import type { EditorRenderTheme } from "./theme.js";
import { appendTransformOverlay } from "./transform-overlay.js";
import type { EditorDiagnosticOverlay, EditorTool } from "./types.js";
import {
  cross,
  isTransformTool,
  normalize,
  topologyHandleBounds,
  topologyHandleKey,
  type MovementTrace,
  type TopologyHandle,
} from "./viewport-geometry.js";

export interface ToolPreviewInput {
  readonly document: MapDocument;
  readonly selection: EditorSelection | null;
  readonly hoverSelection: EditorSelection | null;
  readonly faceOutlines?: readonly FaceSelection[] | null;
  readonly objectViewState: EditorObjectViewState;
  readonly tool: EditorTool;
  readonly transformPivot: Vec3 | null;
  readonly transformPivotHovered: boolean;
  readonly transformPivotTrace: MovementTrace | null;
  readonly movementTraces: readonly MovementTrace[];
  readonly clipPoints: readonly Vec3[];
  readonly gridSize: number;
  readonly hullPoints: readonly Vec3[];
  readonly hullPreviewPoints: readonly Vec3[];
  readonly sweepCaps: readonly (readonly Vec3[])[];
  readonly topologySelection: readonly TopologyHandle[];
  readonly topologyHover: TopologyHandle | null;
  readonly entityLinkMode: EntityLinkMode;
  readonly openGroupId: string | null;
  readonly entityDefinitions: EntityDefinitionCatalog | undefined;
  readonly theme: EditorRenderTheme;
}

/** Face selections still own their brushes for the scene's red X-ray selection treatment. */
export function selectedBrushIdsForScene(
  selection: EditorSelection | null,
): readonly BrushId[] {
  return selection?.faceId
    ? [
        ...new Set(
          selectedFaceReferences(selection).map((face) => face.brushId),
        ),
      ]
    : selectedBrushIds(selection);
}

export function objectSelectionBounds(
  document: MapDocument,
  selection: EditorSelection | null,
  entityDefinitions?: EntityDefinitionCatalog,
): Bounds | null {
  const brushBounds = selectedBrushIds(selection).flatMap((brushId) => {
    const brush = findBrush(document, brushId);
    const derived = brush ? deriveBrush(brush) : null;
    return derived?.bounds ? [derived.bounds] : [];
  });
  const entityIds = new Set(selectedPointEntityIds(selection));
  const bounds = [
    ...brushBounds,
    ...pointEntitiesInDocument(document, entityDefinitions).flatMap(
      (entity) => {
        if (!entityIds.has(entity.id)) return [];
        const entityBounds = pointEntityBounds(entity, entityDefinitions);
        return entityBounds ? [entityBounds] : [];
      },
    ),
  ];
  if (bounds.length === 0) return null;
  return {
    min: [
      Math.min(...bounds.map((entry) => entry.min[0])),
      Math.min(...bounds.map((entry) => entry.min[1])),
      Math.min(...bounds.map((entry) => entry.min[2])),
    ],
    max: [
      Math.max(...bounds.map((entry) => entry.max[0])),
      Math.max(...bounds.map((entry) => entry.max[1])),
      Math.max(...bounds.map((entry) => entry.max[2])),
    ],
  };
}

function appendEntityLinkArrow(
  lines: number[],
  start: Vec3,
  end: Vec3,
  color: readonly [number, number, number],
): void {
  const delta: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const length = Math.hypot(...delta);
  if (length <= 1e-6) return;
  const direction: Vec3 = [
    delta[0] / length,
    delta[1] / length,
    delta[2] / length,
  ];
  const helper: Vec3 = Math.abs(direction[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const side = normalize(cross(direction, helper));
  const up = normalize(cross(side, direction));
  const headLength = Math.min(16, length * 0.3);
  const headWidth = Math.min(7, headLength * 0.5);
  const base: Vec3 = [
    end[0] - direction[0] * headLength,
    end[1] - direction[1] * headLength,
    end[2] - direction[2] * headLength,
  ];
  lines.push(...start, ...color, ...end, ...color);
  for (const normal of [side, up]) {
    const first: Vec3 = [
      base[0] + normal[0] * headWidth,
      base[1] + normal[1] * headWidth,
      base[2] + normal[2] * headWidth,
    ];
    const second: Vec3 = [
      base[0] - normal[0] * headWidth,
      base[1] - normal[1] * headWidth,
      base[2] - normal[2] * headWidth,
    ];
    lines.push(
      ...first,
      ...color,
      ...end,
      ...color,
      ...second,
      ...color,
      ...end,
      ...color,
    );
  }
}

function appendBrushInteraction(
  lines: number[],
  input: ToolPreviewInput,
  brushId: BrushId,
  context: {
    readonly selectedBrushIds: ReadonlySet<BrushId>;
    readonly faceToolBrushIds: ReadonlySet<BrushId>;
    readonly selectedBounds: Bounds | null;
    readonly selectedTopologyKeys: ReadonlySet<string>;
    readonly renderedTopologyKeys: Set<string>;
  },
): void {
  const brush = findBrush(input.document, brushId);
  const derived = brush ? deriveBrush(brush) : null;
  if (!brush || !derived?.valid) return;
  const selectedObject = context.selectedBrushIds.has(brush.id);
  const hoveredObject =
    !input.hoverSelection?.faceId &&
    isBrushSelected(input.hoverSelection, brush.id);
  for (const face of derived.faces) {
    const selectedFace = isFaceSelected(input.selection, brush.id, face.faceId);
    const hoveredFace =
      input.hoverSelection?.brushId === brush.id &&
      input.hoverSelection.faceId === face.faceId;
    const showFaceHandle =
      input.tool === "face" && context.faceToolBrushIds.has(brush.id);
    if (!showFaceHandle && !selectedFace && !hoveredFace) continue;
    const color = selectedFace
      ? input.theme.faceSelected
      : hoveredFace
        ? input.theme.faceHover
        : input.theme.faceHandle;
    for (let index = 0; index < face.vertices.length; index += 1) {
      lines.push(
        ...face.vertices[index]!,
        ...color,
        ...face.vertices[(index + 1) % face.vertices.length]!,
        ...color,
      );
    }
    if (showFaceHandle) {
      const center = face.vertices
        .reduce<[number, number, number]>(
          (sum, point) => [
            sum[0] + point[0],
            sum[1] + point[1],
            sum[2] + point[2],
          ],
          [0, 0, 0],
        )
        .map((component) => component / face.vertices.length) as [
        number,
        number,
        number,
      ];
      for (let axis = 0; axis < 3; axis += 1) {
        const start = [...center] as [number, number, number];
        const end = [...center] as [number, number, number];
        start[axis] = start[axis]! - 4;
        end[axis] = end[axis]! + 4;
        lines.push(...start, ...color, ...end, ...color);
      }
    }
  }
  if (hoveredObject && !selectedObject) {
    for (const edge of derived.edges) {
      lines.push(
        ...edge.start,
        ...input.theme.edgeHover,
        ...edge.end,
        ...input.theme.edgeHover,
      );
    }
  }
  if (
    input.selection?.brushId === brush.id &&
    context.selectedBounds &&
    isTransformTool(input.tool) &&
    input.tool !== "scale"
  ) {
    appendTransformOverlay(
      lines,
      context.selectedBounds,
      input.tool,
      input.transformPivot,
      input.transformPivotHovered,
      input.theme,
    );
  }
  if (
    !selectedObject ||
    input.selection?.faceId ||
    (input.tool !== "vertex" && input.tool !== "edge")
  ) {
    return;
  }
  const handles: readonly TopologyHandle[] =
    input.tool === "vertex"
      ? brushVertices(brush).map((point) => ({
          kind: "vertex",
          center: point,
          vertices: [point],
          key: topologyHandleKey("vertex", [point]),
          brushIds: [brush.id],
        }))
      : derived.edges.map((edge) => {
          const vertices = [edge.start, edge.end] as const;
          return {
            kind: "edge",
            center: [
              (edge.start[0] + edge.end[0]) / 2,
              (edge.start[1] + edge.end[1]) / 2,
              (edge.start[2] + edge.end[2]) / 2,
            ],
            vertices,
            key: topologyHandleKey("edge", vertices),
            brushIds: [brush.id],
          };
        });
  for (const handle of handles) {
    if (context.renderedTopologyKeys.has(handle.key)) continue;
    context.renderedTopologyKeys.add(handle.key);
    const color = context.selectedTopologyKeys.has(handle.key)
      ? input.theme.danger
      : input.topologyHover?.key === handle.key
        ? input.theme.accent
        : input.theme.faceHandle;
    appendTopologyMarker(
      lines,
      handle.center,
      color,
      context.selectedTopologyKeys.has(handle.key) ? 6 : 4,
    );
  }
}

function appendPointEntityInteractions(
  lines: number[],
  input: ToolPreviewInput,
): void {
  const candidateIds = new Set([
    ...selectedPointEntityIds(input.selection),
    ...selectedPointEntityIds(input.hoverSelection),
  ]);
  if (candidateIds.size === 0) return;
  for (const entity of pointEntitiesInDocument(
    input.document,
    input.entityDefinitions,
  )) {
    if (!candidateIds.has(entity.id)) continue;
    const bounds = pointEntityBounds(entity, input.entityDefinitions);
    if (!bounds) continue;
    const selected = isPointEntitySelected(input.selection, entity.id);
    const hovered = isPointEntitySelected(input.hoverSelection, entity.id);
    const color = selected
      ? input.theme.edgeHover
      : hovered
        ? input.theme.faceSelected
        : input.theme.special;
    appendBoundsWireframe(lines, bounds, color);
    const center: Vec3 = [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
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
    const selectedBounds = objectSelectionBounds(
      input.document,
      input.selection,
      input.entityDefinitions,
    );
    if (
      input.selection?.entityId === entity.id &&
      selectedBounds &&
      isTransformTool(input.tool) &&
      input.tool !== "scale"
    ) {
      appendTransformOverlay(
        lines,
        selectedBounds,
        input.tool,
        input.transformPivot,
        input.transformPivotHovered,
        input.theme,
      );
    }
  }
}

function appendGroupAndLinkOverlays(
  lines: number[],
  input: ToolPreviewInput,
): void {
  const hiddenBrushIds = new Set(input.objectViewState.hiddenBrushIds);
  const hiddenEntityIds = new Set(input.objectViewState.hiddenEntityIds);
  const selectedGroupId =
    selectedEditorGroup(input.document, input.selection)?.id ?? null;
  const hoveredGroupId =
    selectedEditorGroup(input.document, input.hoverSelection)?.id ?? null;
  const groups = deriveEditorGroups(input.document);
  for (const group of groups) {
    if (!group.bounds) continue;
    const visible =
      group.brushIds.some((brushId) => !hiddenBrushIds.has(brushId)) ||
      group.pointEntityIds.some((entityId) => !hiddenEntityIds.has(entityId));
    if (!visible) continue;
    const color =
      group.id === input.openGroupId
        ? input.theme.info
        : group.id === selectedGroupId
          ? input.theme.edgeHover
          : group.id === hoveredGroupId
            ? input.theme.referenceEdge
            : group.linkedGroupId
              ? input.theme.special
              : input.theme.axisZ;
    appendBoundsWireframe(lines, group.bounds, color);
  }
  const linkedArrowSource = groups.find(
    (group) =>
      group.linkedGroupId &&
      (group.id === selectedGroupId || group.id === input.openGroupId),
  );
  const linkedArrowStart = linkedArrowSource
    ? linkedGroupCenter(linkedArrowSource)
    : null;
  if (linkedArrowSource?.linkedGroupId && linkedArrowStart) {
    for (const sibling of groups) {
      if (
        sibling.id === linkedArrowSource.id ||
        sibling.linkedGroupId !== linkedArrowSource.linkedGroupId
      ) {
        continue;
      }
      const end = linkedGroupCenter(sibling);
      if (end)
        appendEntityLinkArrow(
          lines,
          linkedArrowStart,
          end,
          input.theme.special,
        );
    }
  }

  const selectedLinkEntities = selectedEntityIdsForLinks(
    input.document,
    input.selection,
  );
  const selectedSet = new Set(selectedLinkEntities);
  const entityById = new Map(
    input.document.entities.map((entity) => [entity.id, entity] as const),
  );
  const entityIsVisible = (entityId: EntityId) => {
    const entity = entityById.get(entityId);
    if (!entity || hiddenEntityIds.has(entityId)) return false;
    return (
      entity.primitives.length === 0 ||
      entity.primitives.some((brush) => !hiddenBrushIds.has(brush.id))
    );
  };
  for (const link of visibleEntityLinks(
    deriveEntityLinks(input.document),
    selectedLinkEntities,
    input.entityLinkMode,
  )) {
    if (
      !entityIsVisible(link.sourceEntityId) ||
      !entityIsVisible(link.targetEntityId)
    )
      continue;
    const selected =
      selectedSet.has(link.sourceEntityId) ||
      selectedSet.has(link.targetEntityId);
    appendEntityLinkArrow(
      lines,
      link.sourceAnchor,
      link.targetAnchor,
      selected ? input.theme.danger : input.theme.success,
    );
  }
}

function appendActiveTool(lines: number[], input: ToolPreviewInput): void {
  if (input.tool === "rotate" && input.transformPivotTrace) {
    appendMovementTrace(lines, input.transformPivotTrace, input.theme);
  }
  for (const trace of input.movementTraces)
    appendMovementTrace(lines, trace, input.theme);
  if (isTransformTool(input.tool)) {
    for (const handle of input.topologySelection) {
      appendTopologyMarker(lines, handle.center, input.theme.danger, 6);
    }
  }
  if (input.tool === "vertex" && input.topologyHover?.insertion) {
    appendTopologyMarker(
      lines,
      input.topologyHover.center,
      input.theme.success,
      6,
    );
  }
  if (input.tool === "clip") {
    const color = input.theme.faceSelected;
    for (const point of input.clipPoints) {
      for (let axis = 0; axis < 3; axis += 1) {
        const start = [...point] as [number, number, number];
        const end = [...point] as [number, number, number];
        start[axis] = start[axis]! - 5;
        end[axis] = end[axis]! + 5;
        lines.push(...start, ...color, ...end, ...color);
      }
    }
    for (let index = 1; index < input.clipPoints.length; index += 1) {
      lines.push(
        ...input.clipPoints[index - 1]!,
        ...color,
        ...input.clipPoints[index]!,
        ...color,
      );
    }
    if (input.clipPoints.length === 3) {
      lines.push(
        ...input.clipPoints[2]!,
        ...color,
        ...input.clipPoints[0]!,
        ...color,
      );
    }
  }
  if (input.tool === "sweep")
    appendSweepOverlay(lines, input.sweepCaps, input.theme);
}

export function buildToolPreviewBuffers(
  device: GPUDevice,
  input: ToolPreviewInput,
): ToolPreviewBuffers {
  const lines: number[] = [];
  const resizeLines: number[] = [];
  const resizeFaceSelections =
    input.faceOutlines ??
    (input.tool === "select" &&
    input.hoverSelection?.faceId &&
    isBrushSelected(input.selection, input.hoverSelection.brushId)
      ? extrudableBrushFaces(
          input.document,
          {
            brushId: input.hoverSelection.brushId,
            faceId: input.hoverSelection.faceId,
          },
          selectedBrushIds(input.selection),
        )
      : []);
  for (const selection of resizeFaceSelections) {
    const brush = findBrush(input.document, selection.brushId);
    const face =
      brush &&
      deriveBrush(brush).faces.find(
        (candidate) => candidate.faceId === selection.faceId,
      );
    if (!face) continue;
    for (let i = 0; i < face.vertices.length; i++)
      resizeLines.push(
        ...face.vertices[i]!,
        1,
        0.92,
        0,
        ...face.vertices[(i + 1) % face.vertices.length]!,
        1,
        0.92,
        0,
      );
  }
  const selectedBrushes = selectedBrushIdsForScene(input.selection);
  const brushIds = new Set([
    ...selectedBrushes,
    ...selectedBrushIdsForScene(input.hoverSelection),
  ]);
  const context = {
    selectedBrushIds: new Set(selectedBrushes),
    faceToolBrushIds: new Set(selectedBrushes),
    selectedBounds:
      isTransformTool(input.tool) && input.topologySelection.length > 0
        ? topologyHandleBounds(input.topologySelection)
        : objectSelectionBounds(
            input.document,
            input.selection,
            input.entityDefinitions,
          ),
    selectedTopologyKeys: new Set(
      input.topologySelection.map((handle) => handle.key),
    ),
    renderedTopologyKeys: new Set<string>(),
  };
  for (const brushId of brushIds) {
    appendBrushInteraction(lines, input, brushId, context);
  }
  appendPointEntityInteractions(lines, input);
  appendGroupAndLinkOverlays(lines, input);
  appendActiveTool(lines, input);

  const selectionGuideLines: number[] = [];
  if (
    input.tool === "select" &&
    context.selectedBounds &&
    selectionContainsHoveredObject(input.selection, input.hoverSelection)
  ) {
    appendSelectionBoundsGuide(
      selectionGuideLines,
      context.selectedBounds,
      input.theme.edgeSelected,
      [0, 0, 0],
    );
  }
  const hull = buildHullOverlay(input);
  const lineData = new Float32Array(lines);
  const guideData = new Float32Array(selectionGuideLines);
  return {
    resizeFaceSelections,
    resizeFace: {
      buffer: uploadFloatBuffer(
        device,
        new Float32Array(resizeLines),
        GPUBufferUsage.VERTEX,
      ),
      count: resizeLines.length / 6,
    },
    hull: {
      polygon: hull.polygon,
      grid: {
        buffer: uploadFloatBuffer(
          device,
          new Float32Array(hull.grid),
          GPUBufferUsage.VERTEX,
        ),
        count: hull.grid.length / 6,
      },
      lines: {
        buffer: uploadFloatBuffer(
          device,
          new Float32Array(hull.lines),
          GPUBufferUsage.VERTEX,
        ),
        count: hull.lines.length / 6,
      },
      handles: {
        buffer: uploadFloatBuffer(
          device,
          new Float32Array(hull.handles),
          GPUBufferUsage.VERTEX,
        ),
        count: hull.handles.length / 8,
      },
      face: {
        buffer: uploadFloatBuffer(
          device,
          new Float32Array(hull.face),
          GPUBufferUsage.VERTEX,
        ),
        count: hull.face.length / 8,
      },
    },
    lines: {
      buffer: uploadFloatBuffer(
        device,
        lineData,
        GPUBufferUsage.VERTEX,
        "Tool previews",
      ),
      count: lineData.length / 6,
    },
    selectionGuide: {
      buffer: uploadFloatBuffer(
        device,
        guideData,
        GPUBufferUsage.VERTEX,
        "Selection bounds guide",
      ),
      count: guideData.length / 6,
    },
    scaleBounds: input.tool === "scale" ? context.selectedBounds : null,
  };
}

export function buildFaceGridBuffer(
  device: GPUDevice,
  input: Pick<
    ToolPreviewInput,
    "document" | "selection" | "hoverSelection" | "theme"
  > & {
    readonly gridSize: number;
  },
): LineBuffer {
  const lines: number[] = [];
  const selectedFaces = selectedFaceReferences(input.selection);
  const selectedBrushes = new Set(selectedBrushIds(input.selection));
  const selectedKeys = new Set(
    selectedFaces.map(
      (selection) => `${selection.brushId}\0${selection.faceId}`,
    ),
  );
  const faces = [
    ...selectedFaces,
    ...(input.hoverSelection?.brushId && input.hoverSelection.faceId
      ? [
          {
            brushId: input.hoverSelection.brushId,
            faceId: input.hoverSelection.faceId,
          },
        ]
      : []),
  ];
  const rendered = new Set<string>();
  for (const faceSelection of faces) {
    const key = `${faceSelection.brushId}\0${faceSelection.faceId}`;
    if (rendered.has(key)) continue;
    rendered.add(key);
    const brush = findBrush(input.document, faceSelection.brushId);
    const face = brush
      ? deriveBrush(brush).faces.find(
          (candidate) => candidate.faceId === faceSelection.faceId,
        )
      : null;
    if (face) {
      appendProjectedFaceGrid(
        lines,
        face,
        input.gridSize,
        selectedKeys.has(key) || !selectedBrushes.has(faceSelection.brushId),
        input.theme,
      );
    }
  }
  const data = new Float32Array(lines);
  return {
    buffer: uploadFloatBuffer(
      device,
      data,
      GPUBufferUsage.VERTEX,
      "Selected face grid",
    ),
    count: data.length / 6,
  };
}

export function buildDiagnosticBuffer(
  device: GPUDevice,
  overlays: readonly EditorDiagnosticOverlay[],
  theme: EditorRenderTheme,
): LineBuffer {
  const lines: number[] = [];
  for (const overlay of overlays) {
    const color = overlay.kind === "leak-path" ? theme.danger : theme.info;
    for (let index = 1; index < overlay.points.length; index += 1) {
      lines.push(
        ...overlay.points[index - 1]!,
        ...color,
        ...overlay.points[index]!,
        ...color,
      );
    }
    if (overlay.kind === "portal" && overlay.points.length > 2) {
      lines.push(
        ...overlay.points.at(-1)!,
        ...color,
        ...overlay.points[0]!,
        ...color,
      );
    }
  }
  const data = new Float32Array(lines);
  return {
    buffer: uploadFloatBuffer(
      device,
      data,
      GPUBufferUsage.VERTEX,
      "Diagnostics",
    ),
    count: data.length / 6,
  };
}
