import {
  createSequentialIdFactory,
  deriveBrush,
  findBrush,
  selectedFaceReferences,
  type EditorObjectViewState,
  type EditorSession,
  type SweepCandidate,
  type SweepOptions,
  type SweepTransform,
  type Vec3,
} from "@tea/maps-editor/core";
import {
  type EditorSourceRenderer,
  type EditorSweepDragEvent,
} from "@tea/maps-editor/render";
import { initEditorSweepPanel } from "./editor-sweep-bridge.ts";

function vector(values: readonly number[]): Vec3 {
  return [values[0]!, values[1]!, values[2]!];
}

function readNumber(raw: string): number {
  const value = raw.trim() === "" ? NaN : Number(raw);
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
  const panel = initEditorSweepPanel({
    inputChanged: handleInput,
    apply,
    reset,
  });

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
    panel.update({
      fields: {
        translateX: String(transform.translation[0]),
        translateY: String(transform.translation[1]),
        translateZ: String(transform.translation[2]),
        rotateX: String(transform.rotationDegrees[0]),
        rotateY: String(transform.rotationDegrees[1]),
        rotateZ: String(transform.rotationDegrees[2]),
        scale: String(transform.scale),
        segments: String(sweepOptions.segments),
        iterations: String(sweepOptions.iterations),
      },
      path: sweepOptions.path,
      snap: sweepOptions.snapToInteger,
    });
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
    panel.update({ visible: active });
    if (!active) return;
    candidate = null;
    const session = options.session();
    const faces = selectedFaceReferences(session.selection);
    if (faces.length === 0) {
      restoreDocument();
      panel.update({ count: "0 brushes", applyDisabled: true });
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
      panel.update({
        count: `${amount} ${amount === 1 ? "brush" : "brushes"}`,
        applyDisabled: !options.canEdit(),
      });
      if (announce)
        options.status(
          `Sweep preview: ${faces.length} faces → ${amount} brushes`,
        );
    } catch (error) {
      restoreDocument();
      panel.update({ count: "Invalid sweep", applyDisabled: true });
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
    panel.update({ visible: false });
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
    const { fields, path, snap } = panel.state;
    const translation = vector(
      [fields.translateX, fields.translateY, fields.translateZ].map(readNumber),
    );
    const rotationDegrees = vector(
      [fields.rotateX, fields.rotateY, fields.rotateZ].map(readNumber),
    );
    const scale = readNumber(fields.scale);
    const segments = readNumber(fields.segments);
    const iterations = readNumber(fields.iterations);
    if (scale <= 0 || scale > 20)
      throw new Error("Sweep scale must be greater than 0 and at most 20");
    if (!Number.isInteger(segments) || segments < 1 || segments > 128)
      throw new Error("Sweep segments must be an integer from 1 to 128");
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > 64)
      throw new Error("Sweep iterations must be an integer from 1 to 64");
    transform = { translation, rotationDegrees, scale };
    sweepOptions = {
      path,
      segments,
      iterations,
      snapToInteger: snap,
    };
    escapeReset = false;
    refresh();
  }

  function handleInput() {
    try {
      readInputs();
    } catch (error) {
      candidate = null;
      panel.update({ applyDisabled: true });
      restoreDocument();
      options.status(error instanceof Error ? error.message : String(error));
    }
  }

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
