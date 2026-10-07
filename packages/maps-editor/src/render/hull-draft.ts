import type { Vec3 } from "../core/index.js";
import type { EditorHullCreateEvent } from "./types.js";
import { dedupeHullPoints, encodedTopologyPoint } from "./viewport-geometry.js";

/** Hull construction history stays transient until the finished brush is committed. */
export class HullDraft {
  points: readonly Vec3[] = [];
  preview: readonly Vec3[] = [];
  private past: (readonly Vec3[])[] = [];
  private future: (readonly Vec3[])[] = [];

  constructor(
    private readonly notify: (event: EditorHullCreateEvent) => void,
    private readonly invalidate: () => void,
  ) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  get hasHistory(): boolean {
    return this.canUndo || this.canRedo;
  }

  replace(
    points: readonly Vec3[],
    viewport: EditorHullCreateEvent["viewport"],
  ): void {
    const next = dedupeHullPoints(points);
    if (
      next.length !== this.points.length ||
      next.some(
        (point, index) =>
          encodedTopologyPoint(point) !==
          encodedTopologyPoint(this.points[index]!),
      )
    ) {
      this.past.push(this.points);
      this.future = [];
      this.points = next;
    }
    this.preview = [];
    this.invalidate();
    this.notify({ phase: "preview", viewport, points: this.points });
  }

  setPreview(points: readonly Vec3[]): void {
    this.preview = dedupeHullPoints(points);
    this.notify({
      phase: "preview",
      viewport: "perspective",
      points: dedupeHullPoints([...this.points, ...this.preview]),
    });
    this.invalidate();
  }

  changeHistory(direction: "undo" | "redo"): void {
    const from = direction === "undo" ? this.past : this.future;
    const to = direction === "undo" ? this.future : this.past;
    const points = from.pop();
    if (!points) return;
    to.push(this.points);
    this.points = points;
    this.preview = [];
    this.notify({ phase: "preview", viewport: "perspective", points });
    this.invalidate();
  }

  commit(): void {
    const past = this.past;
    const future = this.future;
    this.past = [];
    this.future = [];
    try {
      this.notify({
        phase: "commit",
        viewport: "perspective",
        points: this.points,
      });
    } catch (error) {
      this.past = past;
      this.future = future;
      throw error;
    }
    this.points = [];
    this.preview = [];
    this.invalidate();
  }

  clear(): boolean {
    if (!this.points.length && !this.preview.length && !this.hasHistory)
      return false;
    this.points = [];
    this.preview = [];
    this.past = [];
    this.future = [];
    this.invalidate();
    this.notify({ phase: "cancel", viewport: "perspective", points: [] });
    return true;
  }
}
