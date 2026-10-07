import type { TgpuRoot, TgpuBindGroup } from "typegpu";
import type { Vec3 } from "../../core/index.js";
import type { EditorViewportKind } from "../types.js";
import type { SceneBuffers } from "../scene-buffers.js";
import type { FaceHandle } from "../viewport-geometry.js";
import type {
  Pipelines,
  PointerDrag,
  ViewportInteraction,
} from "../viewport-common.js";
import { uploadFloatBuffer } from "../gpu-buffer.js";
import { faceMagnets } from "../face-magnet.js";
import { containsProjectedHull } from "../hull-overlay.js";

export class ViewportToolOverlays {
  private magnetBuffer: GPUBuffer | null = null;
  private magnetFaces: readonly FaceHandle[] = [];
  private magnetCount = 0;
  private alignmentScene: SceneBuffers["toolPreviews"] | null = null;
  private hoverAlignment: readonly FaceHandle[] = [];
  private wasDragging = false;
  private hullShift = false;
  private hullPointer: readonly [number, number] | null = null;

  constructor(
    private readonly root: TgpuRoot,
    private readonly canvas: HTMLCanvasElement,
    private readonly kind: EditorViewportKind,
    private readonly pipelines: Pipelines,
    private readonly overlayBindGroup: TgpuBindGroup,
    private readonly interaction: ViewportInteraction,
    private readonly project: (point: Vec3) => readonly [number, number] | null,
    invalidate: () => void,
    signal: AbortSignal,
  ) {
    const options = { signal };
    const refreshHull = () => {
      if (interaction.currentTool() === "hull") invalidate();
    };
    const updateModifier = (event: KeyboardEvent) => {
      if (event.key !== "Shift") return;
      this.hullShift = event.type === "keydown";
      refreshHull();
    };
    window.addEventListener("keydown", updateModifier, options);
    window.addEventListener("keyup", updateModifier, options);
    window.addEventListener(
      "blur",
      () => {
        this.hullShift = false;
        this.hullPointer = null;
        invalidate();
      },
      options,
    );
    canvas.addEventListener(
      "pointermove",
      (event) => {
        this.hullPointer = [event.clientX, event.clientY];
        this.hullShift = event.shiftKey;
        refreshHull();
      },
      options,
    );
    canvas.addEventListener(
      "pointerleave",
      () => {
        this.hullPointer = null;
        refreshHull();
      },
      options,
    );
  }

  render(
    pass: GPURenderPassEncoder,
    previews: SceneBuffers["toolPreviews"],
    drag: PointerDrag | null,
  ): void {
    if (
      this.alignmentScene !== previews ||
      this.wasDragging !== Boolean(drag)
    ) {
      this.alignmentScene = previews;
      this.wasDragging = Boolean(drag);
      const aligned = !drag
        ? previews.value.resizeFaceSelections.flatMap((selection) => {
            const source = this.interaction.faceHandle(selection);
            return source
              ? faceMagnets(
                  source,
                  this.interaction.faceSnapTargets(source, 0, 0.001),
                )
                  .filter((candidate) => Math.abs(candidate.distance) < 0.001)
                  .map((candidate) => candidate.face)
              : [];
          })
        : [];
      this.hoverAlignment = [...new Set(aligned)];
    }
    const magnets =
      previews.value.resizeFace.count > 0
        ? drag
          ? drag.faceAlignment
          : this.hoverAlignment
        : [];
    this.canvas.dataset.faceAlignment = magnets
      .map((face) => face.selection.faceId)
      .join(" ");
    this.canvas.dataset.faceAlignmentCount = String(magnets.length);
    if (
      magnets.length !== this.magnetFaces.length ||
      magnets.some((face, i) => face !== this.magnetFaces[i])
    ) {
      this.magnetBuffer?.destroy();
      this.magnetBuffer = null;
      this.magnetFaces = magnets;
      const vertices: number[] = [];
      for (const magnet of magnets)
        for (let i = 0; i < magnet.vertices.length; i++)
          vertices.push(
            ...magnet.vertices[i]!,
            0.1,
            0.85,
            1,
            ...magnet.vertices[(i + 1) % magnet.vertices.length]!,
            0.1,
            0.85,
            1,
          );
      this.magnetCount = vertices.length / 6;
      if (vertices.length)
        this.magnetBuffer = uploadFloatBuffer(
          this.root.device,
          new Float32Array(vertices),
          GPUBufferUsage.VERTEX,
        );
    }
    if (this.magnetBuffer) {
      pass.setBindGroup(0, this.root.unwrap(this.overlayBindGroup));
      pass.setPipeline(this.root.unwrap(this.pipelines.hullLines));
      pass.setVertexBuffer(0, this.magnetBuffer);
      pass.draw(6, this.magnetCount / 2);
    }
    const resizeFace = previews.value.resizeFace;
    if (resizeFace.count) {
      pass.setBindGroup(0, this.root.unwrap(this.overlayBindGroup));
      pass.setPipeline(this.root.unwrap(this.pipelines.hullLines));
      pass.setVertexBuffer(0, resizeFace.buffer);
      pass.draw(6, resizeFace.count / 2);
    }
    this.canvas.dataset.resizeFaceEdges = String(resizeFace.count / 2);
    this.canvas.dataset.resizeFaceCount = String(
      previews.value.resizeFaceSelections.length,
    );
    const hull = previews.value.hull;
    const rect = this.canvas.getBoundingClientRect();
    const hullFaceVisible =
      this.kind === "perspective" &&
      this.hullShift &&
      this.hullPointer !== null &&
      containsProjectedHull(
        hull.polygon.map((point) => this.project(point)),
        [this.hullPointer[0] - rect.left, this.hullPointer[1] - rect.top],
      );
    pass.setBindGroup(0, this.root.unwrap(this.overlayBindGroup));
    if (
      this.kind === "perspective" &&
      (hullFaceVisible || hull.polygon.length === 0) &&
      hull.face.count
    ) {
      pass.setPipeline(this.root.unwrap(this.pipelines.hullFace));
      pass.setVertexBuffer(0, hull.face.buffer);
      pass.draw(hull.face.count);
    }
    if (
      this.kind === "perspective" &&
      hull.grid.count &&
      (hull.polygon.length === 0 || hullFaceVisible)
    ) {
      pass.setPipeline(this.root.unwrap(this.pipelines.occludedLines));
      pass.setVertexBuffer(0, hull.grid.buffer);
      pass.draw(6, hull.grid.count / 2);
      pass.setBindGroup(0, this.root.unwrap(this.overlayBindGroup));
    }
    if (hull.lines.count) {
      pass.setPipeline(this.root.unwrap(this.pipelines.hullLines));
      pass.setVertexBuffer(0, hull.lines.buffer);
      pass.draw(6, hull.lines.count / 2);
    }
    if (hull.handles.count) {
      pass.setPipeline(this.root.unwrap(this.pipelines.hullHandles));
      pass.setVertexBuffer(0, hull.handles.buffer);
      pass.draw(hull.handles.count);
    }
    this.canvas.dataset.hullGridSegments = String(hull.grid.count / 2);
    this.canvas.dataset.hullSurfaceTriangles = String(hull.face.count / 3);
    this.canvas.dataset.hullFace = String(hullFaceVisible);
    this.canvas.dataset.hullHandles = String(hull.handles.count / 6);
  }
  dispose(): void {
    this.magnetBuffer?.destroy();
  }
}
