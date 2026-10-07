import {
  createSequentialIdFactory,
  selectedBrushIds,
  type BrushBatchEditCandidate,
  type BrushEditCandidate,
  type EditorObjectViewState,
  type EditorSession,
  type Vec3,
} from "@tea/maps-editor/core";
import {
  type EditorSourceRenderer,
  type EditorTopologyDragEvent,
  type EditorTopologyKind,
  type EditorViewportKind,
} from "@tea/maps-editor/render";

type Candidate = BrushEditCandidate | BrushBatchEditCandidate;

export function createEditorTopology(options: {
  session(): EditorSession;
  renderer(): EditorSourceRenderer | null;
  viewState(): EditorObjectViewState;
  tool(): string;
  viewport(): EditorViewportKind;
  gridSize(): number;
  textureLock(): boolean;
  canEdit(): boolean;
  status(message: string): void;
  selectTool(): void;
}) {
  const section = document.querySelector<HTMLElement>("#topology-tools")!;
  const title = document.querySelector<HTMLElement>("#topology-title")!;
  const count = document.querySelector<HTMLElement>("#topology-count")!;
  const deleteButton =
    document.querySelector<HTMLButtonElement>("#delete-topology")!;
  let kind: EditorTopologyKind | null = null;
  let selectedVertices: readonly Vec3[] = [];
  let selectedCount = 0;
  let preview: Candidate | null = null;
  let prefix: string | null = null;

  function restore() {
    const session = options.session();
    options
      .renderer()
      ?.setDocument(session.document, session.selection, options.viewState());
  }

  function refresh() {
    const active = options.tool() === "vertex" || options.tool() === "edge";
    section.hidden = !active;
    if (!active) return;
    title.textContent = options.tool() === "edge" ? "Edge edit" : "Vertex edit";
    count.textContent = String(selectedCount);
    deleteButton.disabled = selectedCount === 0 || !options.canEdit();
  }

  function selectionChanged(
    nextKind: EditorTopologyKind,
    nextCount: number,
    vertices: readonly Vec3[],
  ) {
    kind = nextCount > 0 ? nextKind : null;
    selectedCount = nextCount;
    selectedVertices = vertices;
    refresh();
  }

  function handleDrag(event: EditorTopologyDragEvent) {
    const label =
      event.operation === "insert"
        ? "Vertex insertion"
        : event.operation === "snap"
          ? "Vertex snap"
          : event.kind === "edge"
            ? "Edge move"
            : "Vertex move";
    if (
      event.phase === "cancel" ||
      event.delta.every((value) => Math.abs(value) <= Number.EPSILON)
    ) {
      preview = null;
      prefix = null;
      restore();
      return;
    }
    if (!options.canEdit()) return;
    try {
      prefix ??= `tea-topology-${crypto.randomUUID()}`;
      const session = options.session();
      const ids = createSequentialIdFactory(prefix);
      const candidate =
        event.operation === "insert"
          ? event.vertices[0]
            ? session.createVertexInsertionCandidate(
                event.brushIds[0] ?? event.selection.brushId,
                event.vertices[0],
                event.delta,
                ids,
                options.textureLock(),
              )
            : null
          : event.operation === "snap" && event.anchor && event.target
            ? session.createVertexSnapCandidate(
                selectedBrushIds(event.selection),
                event.vertices,
                event.anchor,
                event.target,
                ids,
                options.textureLock(),
              )
            : session.createBrushSetVertexMoveCandidate(
                selectedBrushIds(event.selection),
                event.vertices,
                event.delta,
                ids,
                options.textureLock(),
              );
      if (!candidate) return;
      if (event.phase === "preview") {
        preview = candidate;
        options
          .renderer()
          ?.setPreviewDocument(
            candidate.document,
            session.selection,
            selectedBrushIds(event.selection),
          );
        options.status(`${label} preview: ${event.delta.join(", ")}`);
      } else {
        session.commitCandidate(preview ?? candidate);
        preview = null;
        prefix = null;
        options.status(label);
      }
    } catch (error) {
      preview = null;
      prefix = null;
      restore();
      options.status(error instanceof Error ? error.message : String(error));
    }
  }

  function deleteHandles() {
    if (!kind || selectedVertices.length === 0 || !options.canEdit()) return;
    try {
      const changed = options
        .session()
        .deleteSelectedVertices(
          selectedVertices,
          createSequentialIdFactory(
            `tea-topology-delete-${crypto.randomUUID()}`,
          ),
          options.textureLock(),
        );
      if (changed) {
        options.renderer()?.clearTopologySelection();
        options.status("Deleted selected handles");
      }
    } catch (error) {
      options.status(error instanceof Error ? error.message : String(error));
    }
  }

  function arrowDelta(
    key: string,
    viewport: EditorViewportKind,
    vertical: boolean,
  ): Vec3 | null {
    const horizontal = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
    const upward = key === "ArrowUp" ? 1 : key === "ArrowDown" ? -1 : 0;
    if (horizontal === 0 && upward === 0) return null;
    const delta: [number, number, number] = [0, 0, 0];
    const step = options.gridSize();
    if (viewport === "xy")
      delta[horizontal === 0 ? 1 : 0] = step * (horizontal || upward);
    else if (viewport === "xz")
      delta[horizontal === 0 ? 2 : 0] = step * (horizontal || upward);
    else if (viewport === "yz")
      delta[horizontal === 0 ? 2 : 1] = step * (horizontal || upward);
    else if (vertical && upward) delta[2] = step * upward;
    else {
      const yaw = options.renderer()?.viewportCamera("perspective")?.yaw ?? 0;
      const basis = horizontal
        ? [-Math.sin(yaw), Math.cos(yaw)]
        : [Math.cos(yaw), Math.sin(yaw)];
      const axis = Math.abs(basis[0]!) >= Math.abs(basis[1]!) ? 0 : 1;
      delta[axis] =
        step * (horizontal || upward) * (basis[axis]! >= 0 ? 1 : -1);
    }
    return delta;
  }

  function nudge(key: string, vertical: boolean): boolean {
    if (!kind || selectedVertices.length === 0 || !options.canEdit())
      return false;
    const delta = arrowDelta(key, options.viewport(), vertical);
    if (!delta) return false;
    try {
      const session = options.session();
      const candidate = session.createBrushSetVertexMoveCandidate(
        selectedBrushIds(session.selection),
        selectedVertices,
        delta,
        createSequentialIdFactory(`tea-topology-nudge-${crypto.randomUUID()}`),
        options.textureLock(),
      );
      if (!candidate) return false;
      options.renderer()?.translateTopologySelection(delta);
      session.commitCandidate({
        ...candidate,
        label: kind === "vertex" ? "Nudge vertices" : "Nudge edges",
      });
      options.status(
        `${kind === "vertex" ? "Vertices" : "Edges"} nudged ${delta.join(", ")}`,
      );
      return true;
    } catch (error) {
      restore();
      options.status(error instanceof Error ? error.message : String(error));
      return true;
    }
  }

  function escape() {
    if (selectedCount > 0) {
      options.renderer()?.clearTopologySelection();
      options.status(
        "Cleared selected handles; press Escape again to leave the tool",
      );
    } else options.selectTool();
  }

  function clear() {
    preview = null;
    prefix = null;
    options.renderer()?.clearTopologySelection();
    kind = null;
    selectedVertices = [];
    selectedCount = 0;
    refresh();
  }

  deleteButton.addEventListener("click", deleteHandles);

  return {
    refresh,
    selectionChanged,
    handleDrag,
    deleteHandles,
    nudge,
    escape,
    clear,
    selection: () => ({ kind, vertices: selectedVertices }),
  };
}
