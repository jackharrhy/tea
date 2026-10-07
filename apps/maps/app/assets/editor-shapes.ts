import {
  createBrushSelection,
  createSequentialIdFactory,
  createSimpleShapeBrushes,
  DEFAULT_SIMPLE_SHAPE_OPTIONS,
  type BrushBatchCreationCandidate,
  type EditorObjectViewState,
  type EditorSession,
  type EntityId,
  type SimpleShapeKind,
  type SimpleShapeOptions,
} from "@tea/maps-editor/core";
import {
  type EditorBrushCreateEvent,
  type EditorSourceRenderer,
} from "@tea/maps-editor/render";
import { initEditorShapePanel, shapeFields } from "./editor-shape-bridge.ts";

function number(raw: string): number {
  const value = raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(value))
    throw new Error("Shape values must be finite numbers");
  return value;
}

function integer(
  value: number,
  min: number,
  max: number,
  label: string,
): number {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  return value;
}

function shapeLabel(kind: SimpleShapeKind): string {
  return kind === "uv-sphere"
    ? "UV spheroid"
    : kind === "ico-sphere"
      ? "icosphere"
      : kind;
}

export function createEditorShapes(options: {
  session(): EditorSession;
  renderer(): EditorSourceRenderer | null;
  viewState(): EditorObjectViewState;
  tool(): string;
  material(): string;
  openGroupEntityId(): EntityId | undefined;
  canEdit(): boolean;
  status(message: string): void;
}) {
  let shapeOptions = DEFAULT_SIMPLE_SHAPE_OPTIONS;
  let candidate: BrushBatchCreationCandidate | null = null;
  let prefix: string | null = null;
  const panel = initEditorShapePanel(handleInput);

  function sync() {
    panel.update({
      fields: shapeFields(shapeOptions),
      hollow: shapeOptions.hollow,
      visible: options.tool() === "create",
    });
  }

  function readOptions(): SimpleShapeOptions {
    const { fields, hollow } = panel.state;
    const next: SimpleShapeOptions = {
      kind: fields.kind,
      axis: integer(Number(fields.axis), 0, 2, "Shape axis") as 0 | 1 | 2,
      sides: integer(number(fields.sides), 3, 96, "Sides"),
      circleMode: fields.circleMode,
      hollow,
      thickness: integer(number(fields.thickness), 1, 1024, "Thickness"),
      rings: integer(number(fields.rings), 1, 32, "Rings"),
      accuracy: integer(number(fields.accuracy), 1, 3, "Accuracy"),
      stepHeight: integer(number(fields.stepHeight), 1, 1024, "Step height"),
      stairDirection: fields.stairDirection,
    };
    if (
      next.circleMode === "scalable" &&
      ![12, 24, 48, 96].includes(next.sides)
    )
      return { ...next, sides: 12 };
    return next;
  }

  function refresh() {
    sync();
  }

  function restore() {
    const session = options.session();
    options
      .renderer()
      ?.setDocument(session.document, session.selection, options.viewState());
  }

  function handleCreate(event: EditorBrushCreateEvent) {
    if (event.phase === "cancel" || !event.bounds) {
      candidate = null;
      prefix = null;
      panel.update({ result: "Drag to draw" });
      restore();
      return;
    }
    if (!options.canEdit()) return;
    try {
      prefix ??= `tea-shape-${crypto.randomUUID()}`;
      const brushes = createSimpleShapeBrushes(
        event.bounds,
        options.material(),
        shapeOptions,
        createSequentialIdFactory(prefix),
      );
      const label = `Create ${shapeLabel(shapeOptions.kind)}`;
      const next = options
        .session()
        .createBrushesCandidate(brushes, label, options.openGroupEntityId());
      if (event.phase === "preview") {
        candidate = next;
        options
          .renderer()
          ?.setPreviewDocument(
            next.document,
            createBrushSelection(next.selectionAfter),
            next.selectionAfter,
          );
        panel.update({
          result: `${brushes.length} ${brushes.length === 1 ? "brush" : "brushes"}`,
        });
      } else {
        options.session().commitBatchCreationCandidate(candidate ?? next);
        candidate = null;
        prefix = null;
        panel.update({ result: `${brushes.length} created` });
        options.status(label);
      }
    } catch (error) {
      candidate = null;
      prefix = null;
      panel.update({ result: "Invalid bounds or options" });
      restore();
      options.status(error instanceof Error ? error.message : String(error));
    }
  }

  function handleInput() {
    try {
      shapeOptions = readOptions();
      sync();
      panel.update({ result: `${shapeLabel(shapeOptions.kind)} ready` });
    } catch (error) {
      options.status(error instanceof Error ? error.message : String(error));
    }
  }

  sync();
  return {
    handleCreate,
    refresh,
    reset() {
      candidate = null;
      prefix = null;
      panel.update({ result: "Drag to draw" });
    },
  };
}
