import {
  createSequentialIdFactory,
  selectedBrushIds,
  selectedPointEntityIds,
  type Bounds,
  type BrushBatchEditCandidate,
  type BrushEditCandidate,
  type DocumentEditCandidate,
  type EditorObjectViewState,
  type EditorSession,
  type Vec3,
} from "@tea/maps-editor/core";
import {
  type EditorSourceRenderer,
  type EditorTransformDragEvent,
  type EditorTransformPivotDragEvent,
} from "@tea/maps-editor/render";
import { initEditorTransformTool } from "./editor-transform-tool-bridge.ts";

type Candidate =
  | BrushEditCandidate
  | BrushBatchEditCandidate
  | DocumentEditCandidate;

function vector(values: readonly number[]): Vec3 {
  return [values[0]!, values[1]!, values[2]!];
}

export function createEditorTransform(options: {
  session(): EditorSession;
  renderer(): EditorSourceRenderer | null;
  viewState(): EditorObjectViewState;
  tool(): string;
  bounds(): Bounds | null;
  topology(): { kind: "vertex" | "edge" | null; vertices: readonly Vec3[] };
  gridSize(): number;
  textureLock(): boolean;
  canEdit(): boolean;
  applyNumeric(tool: "rotate" | "scale" | "shear"): void;
  status(message: string): void;
}) {
  let pivot: Vec3 | null = null;
  let selectionKey: string | null = null;
  let preview: Candidate | null = null;
  let prefix: string | null = null;
  const panel = initEditorTransformTool({
    commitPivot,
    resetPivot,
    apply: () => {
      const tool = activeTool();
      if (tool) options.applyNumeric(tool);
    },
  });

  function activeTool(): "rotate" | "scale" | "shear" | null {
    const tool = options.tool();
    return tool === "rotate" || tool === "scale" || tool === "shear"
      ? tool
      : null;
  }

  function selectedBounds(): Bounds | null {
    const vertices = options.topology().vertices;
    if (vertices.length === 0) return options.bounds();
    return {
      min: vector(
        [0, 1, 2].map((axis) =>
          Math.min(...vertices.map((point) => point[axis]!)),
        ),
      ),
      max: vector(
        [0, 1, 2].map((axis) =>
          Math.max(...vertices.map((point) => point[axis]!)),
        ),
      ),
    };
  }

  function currentSelectionKey(): string | null {
    const selection = options.session().selection;
    if (!selection || selection.faceId) return null;
    const topology = options.topology();
    return [
      ...selectedBrushIds(selection).toSorted(),
      ...selectedPointEntityIds(selection).toSorted(),
      selection.groupId ?? "",
      topology.kind ?? "",
      ...topology.vertices.map((point) => point.join(",")),
    ].join("|");
  }

  function centerPivot(): Vec3 | null {
    const bounds = selectedBounds();
    if (!bounds) return null;
    const grid = options.gridSize();
    return vector(
      [0, 1, 2].map(
        (axis) =>
          Math.round((bounds.min[axis]! + bounds.max[axis]!) / (2 * grid)) *
          grid,
      ),
    );
  }

  function syncPivot() {
    panel.update({
      pivot: [
        String(pivot?.[0] ?? 0),
        String(pivot?.[1] ?? 0),
        String(pivot?.[2] ?? 0),
      ],
    });
    options.renderer()?.setTransformPivot(activeTool() ? pivot : null);
  }

  function resetPivot() {
    pivot = centerPivot();
    selectionKey = currentSelectionKey();
    syncPivot();
  }

  function refresh() {
    const tool = activeTool();
    panel.update({ visible: !!tool });
    if (!tool) {
      options.renderer()?.setTransformPivot(null);
      return;
    }
    panel.update({ title: tool[0]!.toUpperCase() + tool.slice(1) });
    const nextKey = currentSelectionKey();
    if (selectionKey !== nextKey) resetPivot();
    else syncPivot();
    panel.update({
      applyDisabled: !pivot || !options.canEdit(),
      updateAnglesDisabled:
        selectedPointEntityIds(options.session().selection).length === 0,
    });
  }

  function restore() {
    const session = options.session();
    options
      .renderer()
      ?.setDocument(session.document, session.selection, options.viewState());
  }

  function candidateFor(event: EditorTransformDragEvent): Candidate | null {
    const session = options.session();
    const topology = options.topology();
    const brushIds = selectedBrushIds(event.selection);
    const components = topology.kind && topology.vertices.length > 0;
    prefix ??= `tea-transform-${crypto.randomUUID()}`;
    const ids = createSequentialIdFactory(prefix);
    if (event.tool === "rotate") {
      return components
        ? session.createBrushSetVertexRotationCandidate(
            brushIds,
            topology.vertices,
            event.pivot,
            event.axis,
            event.angleDegrees,
            ids,
            options.textureLock(),
          )
        : session.createObjectRotationCandidate(
            event.selection,
            event.pivot,
            event.axis,
            event.angleDegrees,
            options.textureLock(),
            panel.state.updateAngles,
          );
    }
    if (event.tool === "scale") {
      return components
        ? session.createBrushSetVertexScaleCandidate(
            brushIds,
            topology.vertices,
            event.pivot,
            event.factors,
            ids,
            options.textureLock(),
          )
        : session.createObjectScaleCandidate(
            event.selection,
            event.pivot,
            event.factors,
            options.textureLock(),
            panel.state.updateAngles,
          );
    }
    return components
      ? session.createBrushSetVertexShearCandidate(
          brushIds,
          topology.vertices,
          event.pivot,
          event.sourceAxis,
          event.targetAxis,
          event.factor,
          ids,
          options.textureLock(),
        )
      : session.createObjectShearCandidate(
          event.selection,
          event.pivot,
          event.sourceAxis,
          event.targetAxis,
          event.factor,
          options.textureLock(),
          panel.state.updateAngles,
        );
  }

  function handleDrag(event: EditorTransformDragEvent) {
    if (event.phase === "cancel") {
      preview = null;
      prefix = null;
      restore();
      return;
    }
    if (!options.canEdit()) return;
    try {
      const next = candidateFor(event);
      if (!next) return;
      if (event.phase === "preview") {
        preview = next;
        options
          .renderer()
          ?.setPreviewDocument(next.document, options.session().selection, [
            ...selectedBrushIds(event.selection),
            ...selectedPointEntityIds(event.selection),
          ]);
        options.status(`${event.tool} preview`);
      } else {
        const committed = preview ?? next;
        if ("selectionAfter" in committed)
          options.session().commitDocumentCandidate(committed);
        else options.session().commitCandidate(committed);
        if (options.topology().vertices.length > 0)
          options.renderer()?.remapTopologySelection(event);
        preview = null;
        prefix = null;
        options.status(
          `${event.tool[0]!.toUpperCase()}${event.tool.slice(1)} applied`,
        );
      }
    } catch (error) {
      preview = null;
      prefix = null;
      restore();
      options.status(error instanceof Error ? error.message : String(error));
    }
  }

  function handlePivotDrag(event: EditorTransformPivotDragEvent) {
    pivot = [
      ...(event.phase === "cancel" ? event.startPivot : event.pivot),
    ] as Vec3;
    selectionKey = currentSelectionKey();
    syncPivot();
  }

  function commitPivot() {
    const next = panel.state.pivot.map((value) =>
      value.trim() === "" ? NaN : Number(value),
    );
    if (next.some((value) => !Number.isFinite(value))) {
      options.status("Pivot coordinates must be finite numbers");
      syncPivot();
      return;
    }
    pivot = [next[0]!, next[1]!, next[2]!];
    selectionKey = currentSelectionKey();
    syncPivot();
  }

  return {
    refresh,
    resetPivot,
    handleDrag,
    handlePivotDrag,
    pivot: () => (activeTool() ? pivot : null),
    updateAngles: () => panel.state.updateAngles,
    clear() {
      preview = null;
      prefix = null;
      pivot = null;
      selectionKey = null;
      syncPivot();
    },
  };
}
