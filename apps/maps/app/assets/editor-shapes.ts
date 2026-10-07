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

function number(input: HTMLInputElement): number {
  const value = input.value.trim() === "" ? NaN : Number(input.value);
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
  const root = document.querySelector<HTMLElement>("#shape-tools")!;
  const result = document.querySelector<HTMLElement>("#shape-result")!;
  const kindInput = document.querySelector<HTMLSelectElement>("#shape-kind")!;
  const axisInput = document.querySelector<HTMLSelectElement>("#shape-axis")!;
  const sidesInput = document.querySelector<HTMLInputElement>("#shape-sides")!;
  const circleModeInput =
    document.querySelector<HTMLSelectElement>("#shape-circle-mode")!;
  const hollowInput =
    document.querySelector<HTMLInputElement>("#shape-hollow")!;
  const hollowLabel = document.querySelector<HTMLElement>(
    "#shape-hollow-label",
  )!;
  const thicknessInput =
    document.querySelector<HTMLInputElement>("#shape-thickness")!;
  const ringsInput = document.querySelector<HTMLInputElement>("#shape-rings")!;
  const accuracyInput =
    document.querySelector<HTMLInputElement>("#shape-accuracy")!;
  const stepHeightInput =
    document.querySelector<HTMLInputElement>("#shape-step-height")!;
  const stairDirectionInput = document.querySelector<HTMLSelectElement>(
    "#shape-stair-direction",
  )!;
  const circleFields = document.querySelector<HTMLElement>(
    "#shape-circle-fields",
  )!;
  const hollowFields = document.querySelector<HTMLElement>(
    "#shape-hollow-fields",
  )!;
  const uvFields = document.querySelector<HTMLElement>("#shape-uv-fields")!;
  const icoFields = document.querySelector<HTMLElement>("#shape-ico-fields")!;
  const stairFields = document.querySelector<HTMLElement>(
    "#shape-stair-fields",
  )!;

  let shapeOptions = DEFAULT_SIMPLE_SHAPE_OPTIONS;
  let candidate: BrushBatchCreationCandidate | null = null;
  let prefix: string | null = null;

  function sync() {
    kindInput.value = shapeOptions.kind;
    axisInput.value = String(shapeOptions.axis);
    sidesInput.value = String(shapeOptions.sides);
    circleModeInput.value = shapeOptions.circleMode;
    hollowInput.checked = shapeOptions.hollow;
    thicknessInput.value = String(shapeOptions.thickness);
    ringsInput.value = String(shapeOptions.rings);
    accuracyInput.value = String(shapeOptions.accuracy);
    stepHeightInput.value = String(shapeOptions.stepHeight);
    stairDirectionInput.value = shapeOptions.stairDirection;
    const circular = ["arch", "cylinder", "cone", "uv-sphere"].includes(
      shapeOptions.kind,
    );
    circleFields.hidden = !circular;
    hollowFields.hidden =
      shapeOptions.kind !== "arch" && shapeOptions.kind !== "cylinder";
    hollowLabel.hidden = shapeOptions.kind === "arch";
    thicknessInput.disabled =
      shapeOptions.kind === "cylinder" && !shapeOptions.hollow;
    uvFields.hidden = shapeOptions.kind !== "uv-sphere";
    icoFields.hidden = shapeOptions.kind !== "ico-sphere";
    stairFields.hidden = shapeOptions.kind !== "stairs";
    root.hidden = options.tool() !== "create";
  }

  function readOptions(): SimpleShapeOptions {
    const next: SimpleShapeOptions = {
      kind: kindInput.value as SimpleShapeKind,
      axis: integer(Number(axisInput.value), 0, 2, "Shape axis") as 0 | 1 | 2,
      sides: integer(number(sidesInput), 3, 96, "Sides"),
      circleMode: circleModeInput.value as SimpleShapeOptions["circleMode"],
      hollow: hollowInput.checked,
      thickness: integer(number(thicknessInput), 1, 1024, "Thickness"),
      rings: integer(number(ringsInput), 1, 32, "Rings"),
      accuracy: integer(number(accuracyInput), 1, 3, "Accuracy"),
      stepHeight: integer(number(stepHeightInput), 1, 1024, "Step height"),
      stairDirection:
        stairDirectionInput.value as SimpleShapeOptions["stairDirection"],
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
      result.textContent = "Drag to draw";
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
        result.textContent = `${brushes.length} ${brushes.length === 1 ? "brush" : "brushes"}`;
      } else {
        options.session().commitBatchCreationCandidate(candidate ?? next);
        candidate = null;
        prefix = null;
        result.textContent = `${brushes.length} created`;
        options.status(label);
      }
    } catch (error) {
      candidate = null;
      prefix = null;
      result.textContent = "Invalid bounds or options";
      restore();
      options.status(error instanceof Error ? error.message : String(error));
    }
  }

  for (const input of [
    kindInput,
    axisInput,
    sidesInput,
    circleModeInput,
    hollowInput,
    thicknessInput,
    ringsInput,
    accuracyInput,
    stepHeightInput,
    stairDirectionInput,
  ]) {
    input.addEventListener("input", () => {
      try {
        shapeOptions = readOptions();
        sync();
        result.textContent = `${shapeLabel(shapeOptions.kind)} ready`;
      } catch (error) {
        options.status(error instanceof Error ? error.message : String(error));
      }
    });
  }

  sync();
  return {
    handleCreate,
    refresh,
    reset() {
      candidate = null;
      prefix = null;
      result.textContent = "Drag to draw";
    },
  };
}
