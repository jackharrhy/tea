import {
  createSequentialIdFactory,
  deriveBrush,
  findBrush,
  selectedFaceReferences,
  type EditorObjectViewState,
  type EditorSession,
  type SweepCandidate,
  type SweepOptions,
  type SweepPath,
  type SweepTransform,
  type Vec3,
} from "@tea/maps-editor/core";
import {
  type EditorSourceRenderer,
  type EditorSweepDragEvent,
} from "@tea/maps-editor/render";

function vector(values: readonly number[]): Vec3 {
  return [values[0]!, values[1]!, values[2]!];
}

function readNumber(input: HTMLInputElement): number {
  const value = input.value.trim() === "" ? NaN : Number(input.value);
  if (!Number.isFinite(value))
    throw new Error("Sweep values must be finite numbers");
  return value;
}

export function createEditorSweep(options: {
  session(): EditorSession;
  renderer(): EditorSourceRenderer | null;
  viewState(): EditorObjectViewState;
  tool(): string;
  gridSize(): number;
  textureLock(): boolean;
  canEdit(): boolean;
  status(message: string): void;
  selectTool(): void;
}) {
  const section = document.querySelector<HTMLElement>("#sweep-tools")!;
  const count = document.querySelector<HTMLElement>("#sweep-count")!;
  const applyButton =
    document.querySelector<HTMLButtonElement>("#apply-sweep")!;
  const resetButton =
    document.querySelector<HTMLButtonElement>("#reset-sweep")!;
  const translationInputs = (["x", "y", "z"] as const).map((axis) =>
    document.querySelector<HTMLInputElement>(`#sweep-translate-${axis}`)!,
  );
  const rotationInputs = (["x", "y", "z"] as const).map((axis) =>
    document.querySelector<HTMLInputElement>(`#sweep-rotate-${axis}`)!,
  );
  const scaleInput = document.querySelector<HTMLInputElement>("#sweep-scale")!;
  const pathInput = document.querySelector<HTMLSelectElement>("#sweep-path")!;
  const segmentsInput =
    document.querySelector<HTMLInputElement>("#sweep-segments")!;
  const iterationsInput =
    document.querySelector<HTMLInputElement>("#sweep-iterations")!;
  const snapInput = document.querySelector<HTMLInputElement>("#sweep-snap")!;

  let candidate: SweepCandidate | null = null;
  let prefix = `tea-sweep-${crypto.randomUUID()}`;
  let transform: SweepTransform = {
    translation: [0, 0, 64],
    rotationDegrees: [0, 0, 0],
    scale: 1,
  };
  let sweepOptions: Omit<SweepOptions, "textureLock"> = {
    path: "straight",
    segments: 4,
    iterations: 1,
    snapToInteger: false,
  };
  let dragBase: SweepTransform | null = null;
  let escapeReset = false;

  function initialTransform(): SweepTransform {
    const session = options.session();
    const first = selectedFaceReferences(session.selection)[0];
    const brush = first ? findBrush(session.document, first.brushId) : null;
    const face =
      brush && first
        ? deriveBrush(brush).faces.find((item) => item.faceId === first.faceId)
        : null;
    const distance = options.gridSize() * 4;
    return {
      translation: face
        ? vector(face.normal.map((component) => component * distance))
        : [0, 0, distance],
      rotationDegrees: [0, 0, 0],
      scale: 1,
    };
  }

  function syncInputs() {
    translationInputs.forEach((input, axis) => {
      input.value = String(transform.translation[axis]);
    });
    rotationInputs.forEach((input, axis) => {
      input.value = String(transform.rotationDegrees[axis]);
    });
    scaleInput.value = String(transform.scale);
    pathInput.value = sweepOptions.path;
    segmentsInput.value = String(sweepOptions.segments);
    iterationsInput.value = String(sweepOptions.iterations);
    snapInput.checked = sweepOptions.snapToInteger;
  }

  function restoreDocument() {
    const session = options.session();
    options
      .renderer()
      ?.setDocument(session.document, session.selection, options.viewState());
    options.renderer()?.setSweepCaps([]);
  }

  function refresh(announce = false) {
    const active = options.tool() === "sweep";
    section.hidden = !active;
    if (!active) return;
    candidate = null;
    const session = options.session();
    const faces = selectedFaceReferences(session.selection);
    if (faces.length === 0) {
      restoreDocument();
      count.textContent = "0 brushes";
      applyButton.disabled = true;
      if (announce)
        options.status("Select one or more brush faces before sweeping");
      return;
    }
    try {
      const next = session.createSweepCandidate(
        faces,
        transform,
        { ...sweepOptions, textureLock: options.textureLock() },
        createSequentialIdFactory(prefix),
      );
      if (!next) throw new Error("Sweep did not produce a candidate");
      candidate = next;
      options
        .renderer()
        ?.setPreviewDocument(
          next.document,
          session.selection,
          next.selectionAfter,
          [
            ...new Set([
              ...faces.map((face) => face.brushId),
              ...next.selectionAfter,
            ]),
          ],
        );
      options.renderer()?.setSweepCaps(next.destinationCaps);
      const amount = next.insertions.length;
      count.textContent = `${amount} ${amount === 1 ? "brush" : "brushes"}`;
      applyButton.disabled = !options.canEdit();
      if (announce)
        options.status(
          `Sweep preview: ${faces.length} faces → ${amount} brushes`,
        );
    } catch (error) {
      restoreDocument();
      count.textContent = "Invalid sweep";
      applyButton.disabled = true;
      options.status(error instanceof Error ? error.message : String(error));
    }
  }

  function reset() {
    transform = initialTransform();
    sweepOptions = {
      path: "straight",
      segments: 4,
      iterations: 1,
      snapToInteger: false,
    };
    dragBase = null;
    syncInputs();
    refresh();
  }

  function enter() {
    prefix = `tea-sweep-${crypto.randomUUID()}`;
    escapeReset = false;
    reset();
  }

  function leave() {
    candidate = null;
    dragBase = null;
    section.hidden = true;
    options.renderer()?.setSweepCaps([]);
    restoreDocument();
  }

  function apply() {
    if (!candidate || !options.canEdit()) return;
    const current = candidate;
    candidate = null;
    try {
      options.session().commitBatchCreationCandidate(current);
      options.selectTool();
      options.status(
        `${current.label}: created ${current.insertions.length} brushes`,
      );
    } catch (error) {
      options.status(error instanceof Error ? error.message : String(error));
      refresh();
    }
  }

  function handleDrag(event: EditorSweepDragEvent) {
    if (event.phase === "cancel") {
      if (dragBase) transform = dragBase;
      dragBase = null;
      syncInputs();
      refresh();
      return;
    }
    dragBase ??= transform;
    const base = dragBase;
    if (event.mode === "translate") {
      transform = {
        ...base,
        translation: vector(
          base.translation.map((value, axis) => value + event.delta[axis]!),
        ),
      };
    } else if (event.mode === "rotate") {
      const rotationDegrees = [...base.rotationDegrees] as [
        number,
        number,
        number,
      ];
      rotationDegrees[event.axis] += event.angleDegrees;
      transform = { ...base, rotationDegrees };
    } else {
      transform = {
        ...base,
        scale: Math.max(0.05, Math.min(20, base.scale * event.factor)),
      };
    }
    escapeReset = false;
    syncInputs();
    refresh();
    if (event.phase === "commit") dragBase = null;
  }

  function readInputs() {
    const translation = vector(translationInputs.map(readNumber));
    const rotationDegrees = vector(rotationInputs.map(readNumber));
    const scale = readNumber(scaleInput);
    const segments = readNumber(segmentsInput);
    const iterations = readNumber(iterationsInput);
    if (scale <= 0 || scale > 20)
      throw new Error("Sweep scale must be greater than 0 and at most 20");
    if (!Number.isInteger(segments) || segments < 1 || segments > 128)
      throw new Error("Sweep segments must be an integer from 1 to 128");
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > 64)
      throw new Error("Sweep iterations must be an integer from 1 to 64");
    transform = { translation, rotationDegrees, scale };
    sweepOptions = {
      path: pathInput.value as SweepPath,
      segments,
      iterations,
      snapToInteger: snapInput.checked,
    };
    escapeReset = false;
    refresh();
  }

  for (const input of [
    ...translationInputs,
    ...rotationInputs,
    scaleInput,
    pathInput,
    segmentsInput,
    iterationsInput,
    snapInput,
  ]) {
    input.addEventListener("input", () => {
      try {
        readInputs();
      } catch (error) {
        candidate = null;
        applyButton.disabled = true;
        restoreDocument();
        options.status(error instanceof Error ? error.message : String(error));
      }
    });
    input.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Enter") {
        event.preventDefault();
        apply();
      }
    });
  }
  applyButton.addEventListener("click", apply);
  resetButton.addEventListener("click", reset);

  return {
    enter,
    leave,
    refresh,
    reset,
    handleDrag,
    apply,
    clear: leave,
    escape() {
      if (!escapeReset) {
        reset();
        escapeReset = true;
        options.status("Sweep reset; press Escape again to leave the tool");
      } else options.selectTool();
    },
  };
}
