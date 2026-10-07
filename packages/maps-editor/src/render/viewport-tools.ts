import {
  type Bounds,
  type EditorSelection,
  type TransformAxis,
  type Vec3,
} from "../core/index.js";
import type {
  EditorSweepDragEvent,
  EditorPointerPositionEvent,
  EditorTransformDragEvent,
} from "./types.js";
import {
  boundsCenter,
  scaleHandles,
  scalePivot,
  snappedScaleFactor,
  sweepCapsBounds,
  sweepScaleHandle,
} from "./scene-buffers.js";
import {
  addScaled,
  cross,
  dominantAxis,
  dot,
  pointSegmentDistance,
  rayPlaneIntersection,
  snappedDelta,
  type ScaleHandle,
  type TopologyHandle,
} from "./viewport-geometry.js";

import {
  isBrushRayHit,
  type TransformGesture,
  type SweepGesture,
  type PointerDrag,
} from "./viewport-common.js";
import { ViewportBase } from "./viewport-base.js";
export abstract class ViewportTools extends ViewportBase {
  protected absoluteTopologyDelta(
    handle: TopologyHandle,
    relativeDelta: Vec3,
    axes: readonly TransformAxis[],
  ): Vec3 {
    const delta: [number, number, number] = [0, 0, 0];
    for (const axis of axes) {
      delta[axis] =
        Math.round(
          (handle.center[axis] + relativeDelta[axis]) / this.gridSize,
        ) *
          this.gridSize -
        handle.center[axis];
    }
    return delta;
  }

  protected pointerMovementDelta(
    drag: PointerDrag,
    event: PointerEvent,
    restrictAxis: boolean,
  ): {
    readonly delta: Vec3;
    readonly axes: readonly TransformAxis[];
    readonly movementPlane: "viewport" | "xy" | "z";
    readonly axisRestriction: TransformAxis | null;
  } | null {
    if (!drag.planePoint || !drag.anchor) return null;
    const viewportAxes = this.viewportAxes();
    const vertical = this.kind === "perspective" && event.altKey;
    const movementPlane = vertical
      ? "z"
      : this.kind === "perspective"
        ? "xy"
        : "viewport";
    const axes: readonly TransformAxis[] = vertical
      ? [2]
      : this.kind === "perspective"
        ? [0, 1]
        : [viewportAxes.right, viewportAxes.up];
    let delta: Vec3;
    if (vertical) {
      const mapping = this.faceDragMapping(drag.planePoint, [0, 0, 1]);
      const totalX = event.clientX - drag.startX;
      const totalY = event.clientY - drag.startY;
      const projectedPixels =
        totalX * mapping.direction[0] + totalY * mapping.direction[1];
      const distance =
        Math.round(projectedPixels / mapping.pixelsPerWorld / this.gridSize) *
        this.gridSize;
      delta = [0, 0, distance];
    } else {
      const ray = this.rayAt(event.clientX, event.clientY);
      const normal: Vec3 =
        this.kind === "perspective" ? [0, 0, 1] : this.viewDirection();
      const point = rayPlaneIntersection(
        ray.origin,
        ray.direction,
        drag.planePoint,
        normal,
      );
      if (!point) return null;
      delta = snappedDelta(drag.anchor, point, this.gridSize);
    }
    if (!restrictAxis || !event.shiftKey || axes.length < 2) {
      return { delta, axes, movementPlane, axisRestriction: null };
    }
    const axisRestriction = axes.reduce((best, axis) =>
      Math.abs(delta[axis]) > Math.abs(delta[best]) ? axis : best,
    );
    const restricted: [number, number, number] = [0, 0, 0];
    restricted[axisRestriction] = delta[axisRestriction];
    return {
      delta: restricted,
      axes: [axisRestriction],
      movementPlane,
      axisRestriction,
    };
  }

  protected faceDragMapping(
    center: Vec3,
    normal: Vec3,
  ): {
    readonly direction: readonly [number, number];
    readonly pixelsPerWorld: number;
  } {
    const referenceDistance = Math.max(this.gridSize * 4, 64);
    const start = this.projectToCanvas(center);
    const end = this.projectToCanvas(
      addScaled(center, normal, referenceDistance),
    );
    if (start && end) {
      const deltaX = end[0] - start[0];
      const deltaY = end[1] - start[1];
      const magnitude = Math.hypot(deltaX, deltaY);
      if (magnitude >= 2) {
        return {
          direction: [deltaX / magnitude, deltaY / magnitude],
          pixelsPerWorld: magnitude / referenceDistance,
        };
      }
    }
    const bounds = this.canvas.getBoundingClientRect();
    const visibleWorldHeight =
      this.kind === "perspective"
        ? 2 * this.state.distance * Math.tan(this.state.fieldOfViewRadians / 2)
        : this.state.orthographicSpan;
    return {
      direction: [0, -1],
      pixelsPerWorld: Math.max(0.01, bounds.height / visibleWorldHeight),
    };
  }

  protected clipPointIndexAt(clientX: number, clientY: number): number | null {
    const canvasBounds = this.canvas.getBoundingClientRect();
    const localX = clientX - canvasBounds.left;
    const localY = clientY - canvasBounds.top;
    let nearest: { readonly index: number; readonly distance: number } | null =
      null;
    for (const [index, point] of this.interaction.clipPoints().entries()) {
      const projected = this.projectToCanvas(point);
      if (!projected) continue;
      const distance = Math.hypot(projected[0] - localX, projected[1] - localY);
      if (distance <= 12 && (!nearest || distance < nearest.distance)) {
        nearest = { index, distance };
      }
    }
    return nearest?.index ?? null;
  }

  protected clipPointAt(
    clientX: number,
    clientY: number,
    depthPoint?: Vec3,
  ): Vec3 | null {
    const ray = this.rayAt(clientX, clientY);
    if (this.kind === "perspective") {
      const hit = this.interaction
        .hitTests(ray.origin, ray.direction)
        .find(isBrushRayHit);
      return hit ? this.interaction.snapClipHit(hit, this.gridSize) : null;
    }
    const selection = this.interaction.currentSelection();
    const center =
      depthPoint ??
      (selection ? this.interaction.brushCenter(selection) : this.state.center);
    if (!center) return null;
    const point = rayPlaneIntersection(
      ray.origin,
      ray.direction,
      center,
      this.viewDirection(),
    );
    if (!point) return null;
    const snapped = [...point] as [number, number, number];
    const visibleAxes =
      this.kind === "xy"
        ? ([0, 1] as const)
        : this.kind === "xz"
          ? ([0, 2] as const)
          : ([1, 2] as const);
    for (const axis of visibleAxes) {
      snapped[axis] = Math.round(snapped[axis] / this.gridSize) * this.gridSize;
    }
    const depthAxis = this.kind === "xy" ? 2 : this.kind === "xz" ? 1 : 0;
    snapped[depthAxis] = center[depthAxis];
    return snapped;
  }

  protected pointEntityOriginAt(clientX: number, clientY: number): Vec3 | null {
    const ray = this.rayAt(clientX, clientY);
    const relativeBounds = this.interaction.entityPlacementBounds();
    const currentSelection = this.interaction.currentSelection();
    const selectionBounds = currentSelection
      ? this.interaction.brushBounds(currentSelection)
      : null;
    if (this.kind === "perspective") {
      const hit = this.interaction
        .hitTests(ray.origin, ray.direction)
        .find(isBrushRayHit);
      let point: Vec3 | null = hit?.point ?? null;
      let normal: Vec3 = [0, 0, 1];
      if (hit) {
        normal = this.interaction.brushFaceNormal(hit) ?? normal;
      } else {
        const height = selectionBounds?.max[2] ?? 0;
        point = rayPlaneIntersection(
          ray.origin,
          ray.direction,
          [0, 0, height],
          [0, 0, 1],
        );
      }
      if (!point) return null;
      const origin = point.map(
        (component) => Math.round(component / this.gridSize) * this.gridSize,
      ) as [number, number, number];
      const axis = dominantAxis(normal);
      const relativeSide =
        normal[axis] >= 0 ? relativeBounds.min[axis] : relativeBounds.max[axis];
      origin[axis] =
        Math.round((point[axis] - relativeSide) / this.gridSize) *
        this.gridSize;
      return origin;
    }
    const center = selectionBounds
      ? ([
          (selectionBounds.min[0] + selectionBounds.max[0]) / 2,
          (selectionBounds.min[1] + selectionBounds.max[1]) / 2,
          (selectionBounds.min[2] + selectionBounds.max[2]) / 2,
        ] as [number, number, number])
      : this.state.center;
    const viewDirection = this.viewDirection();
    if (selectionBounds) {
      const depthAxis = this.kind === "xy" ? 2 : this.kind === "xz" ? 1 : 0;
      center[depthAxis] =
        viewDirection[depthAxis] >= 0
          ? selectionBounds.max[depthAxis]
          : selectionBounds.min[depthAxis];
    }
    const point = rayPlaneIntersection(
      ray.origin,
      ray.direction,
      center,
      viewDirection,
    );
    if (!point) return null;
    const origin = [...center] as [number, number, number];
    const visibleAxes =
      this.kind === "xy"
        ? ([0, 1] as const)
        : this.kind === "xz"
          ? ([0, 2] as const)
          : ([1, 2] as const);
    for (const axis of visibleAxes) {
      origin[axis] = Math.round(point[axis] / this.gridSize) * this.gridSize;
    }
    return origin;
  }

  protected pointerPositionAt(
    clientX: number,
    clientY: number,
  ): EditorPointerPositionEvent | null {
    const ray = this.rayAt(clientX, clientY);
    const selection = this.interaction.currentSelection();
    const selectionBounds = selection
      ? this.interaction.brushBounds(selection)
      : null;
    if (this.kind === "perspective") {
      const hit = this.interaction
        .hitTests(ray.origin, ray.direction)
        .find(isBrushRayHit);
      if (hit) {
        const point = this.interaction.snapClipHit(hit, this.gridSize);
        if (!point) return null;
        return {
          viewport: this.kind,
          point,
          surfaceNormal: this.interaction.brushFaceNormal(hit),
        };
      }
      const point = [
        ray.origin[0] + ray.direction[0] * 256,
        ray.origin[1] + ray.direction[1] * 256,
        ray.origin[2] + ray.direction[2] * 256,
      ] as Vec3;
      return {
        viewport: this.kind,
        point: point.map(
          (component) => Math.round(component / this.gridSize) * this.gridSize,
        ) as [number, number, number],
        surfaceNormal: (() => {
          const forward = this.perspectiveForward();
          return [-forward[0], -forward[1], -forward[2]];
        })(),
      };
    }
    const center = selectionBounds
      ? ([
          (selectionBounds.min[0] + selectionBounds.max[0]) / 2,
          (selectionBounds.min[1] + selectionBounds.max[1]) / 2,
          (selectionBounds.min[2] + selectionBounds.max[2]) / 2,
        ] as [number, number, number])
      : this.state.center;
    const viewDirection = this.viewDirection();
    if (selectionBounds) {
      const depthAxis = this.kind === "xy" ? 2 : this.kind === "xz" ? 1 : 0;
      center[depthAxis] =
        viewDirection[depthAxis] >= 0
          ? selectionBounds.max[depthAxis]
          : selectionBounds.min[depthAxis];
    }
    const point = rayPlaneIntersection(
      ray.origin,
      ray.direction,
      center,
      viewDirection,
    );
    if (!point) return null;
    const snapped = [...center] as [number, number, number];
    const visibleAxes =
      this.kind === "xy"
        ? ([0, 1] as const)
        : this.kind === "xz"
          ? ([0, 2] as const)
          : ([1, 2] as const);
    for (const axis of visibleAxes) {
      snapped[axis] = Math.round(point[axis] / this.gridSize) * this.gridSize;
    }
    return {
      viewport: this.kind,
      point: snapped,
      surfaceNormal: selectionBounds ? viewDirection : null,
    };
  }

  protected viewportAxes(): {
    readonly right: 0 | 1 | 2;
    readonly up: 0 | 1 | 2;
    readonly normal: 0 | 1 | 2;
  } {
    if (this.kind === "xz") return { right: 0, up: 2, normal: 1 };
    if (this.kind === "yz") return { right: 1, up: 2, normal: 0 };
    return { right: 0, up: 1, normal: 2 };
  }

  protected worldPerPixel(): number {
    const visibleWorldHeight =
      this.kind === "perspective"
        ? 2 * this.state.distance * Math.tan(this.state.fieldOfViewRadians / 2)
        : this.state.orthographicSpan;
    return visibleWorldHeight / Math.max(1, this.canvas.clientHeight);
  }

  protected scaleHandleAt(
    bounds: Bounds,
    clientX: number,
    clientY: number,
  ): ScaleHandle | null {
    const viewportAxes = this.viewportAxes();
    const activeAxes: readonly TransformAxis[] =
      this.kind === "perspective"
        ? [0, 1, 2]
        : [viewportAxes.right, viewportAxes.up];
    const canvasBounds = this.canvas.getBoundingClientRect();
    const localX = clientX - canvasBounds.left;
    const localY = clientY - canvasBounds.top;
    let nearest: {
      readonly handle: ScaleHandle;
      readonly distance: number;
    } | null = null;
    for (const handle of scaleHandles(bounds, activeAxes)) {
      const projected = this.projectToCanvas(handle.point);
      if (!projected) continue;
      const distance = Math.hypot(projected[0] - localX, projected[1] - localY);
      if (distance <= 14 && (!nearest || distance < nearest.distance)) {
        nearest = { handle, distance };
      }
    }
    return nearest?.handle ?? null;
  }

  protected transformPivotHandleAt(
    pivot: Vec3,
    clientX: number,
    clientY: number,
  ): boolean {
    const projected = this.projectToCanvas(pivot);
    if (!projected) return false;
    const bounds = this.canvas.getBoundingClientRect();
    return (
      Math.hypot(
        projected[0] - (clientX - bounds.left),
        projected[1] - (clientY - bounds.top),
      ) <= 14
    );
  }

  protected rotationAxisAt(
    bounds: Bounds,
    pivot: Vec3,
    clientX: number,
    clientY: number,
  ): TransformAxis | null {
    if (this.kind !== "perspective") return this.viewportAxes().normal;
    const size: Vec3 = [
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    ];
    const radius =
      Math.max(...size) * 0.62 +
      Math.max(3, Math.min(10, Math.max(...size) * 0.04));
    const rings = [
      { axis: 0 as const, first: 1 as const, second: 2 as const },
      { axis: 1 as const, first: 0 as const, second: 2 as const },
      { axis: 2 as const, first: 0 as const, second: 1 as const },
    ];
    const canvasBounds = this.canvas.getBoundingClientRect();
    const local: readonly [number, number] = [
      clientX - canvasBounds.left,
      clientY - canvasBounds.top,
    ];
    let nearest: {
      readonly axis: TransformAxis;
      readonly distance: number;
    } | null = null;
    for (const ring of rings) {
      let previous: readonly [number, number] | null = null;
      for (let segment = 0; segment <= 48; segment += 1) {
        const radians = (segment / 48) * Math.PI * 2;
        const point = [...pivot] as [number, number, number];
        point[ring.first] += Math.cos(radians) * radius;
        point[ring.second] += Math.sin(radians) * radius;
        const projected = this.projectToCanvas(point);
        if (previous && projected) {
          const distance = pointSegmentDistance(local, previous, projected);
          if (distance <= 10 && (!nearest || distance < nearest.distance)) {
            nearest = { axis: ring.axis, distance };
          }
        }
        previous = projected;
      }
    }
    return nearest?.axis ?? null;
  }

  protected sweepGestureAt(
    clientX: number,
    clientY: number,
  ): SweepGesture | null {
    if (this.kind !== "perspective") return null;
    const caps = this.interaction.sweepCaps();
    const bounds = sweepCapsBounds(caps);
    if (!bounds) return null;
    const pivot = boundsCenter(bounds);
    const handle = sweepScaleHandle(bounds);
    const canvasBounds = this.canvas.getBoundingClientRect();
    const local: readonly [number, number] = [
      clientX - canvasBounds.left,
      clientY - canvasBounds.top,
    ];
    const projectedHandle = this.projectToCanvas(handle);
    if (
      projectedHandle &&
      Math.hypot(
        projectedHandle[0] - local[0],
        projectedHandle[1] - local[1],
      ) <= 14
    ) {
      return { mode: "scale", pivot, handle };
    }
    const projectedPivot = this.projectToCanvas(pivot);
    if (
      projectedPivot &&
      Math.hypot(projectedPivot[0] - local[0], projectedPivot[1] - local[1]) <=
        14
    ) {
      return { mode: "translate", pivot };
    }

    const size: Vec3 = [
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    ];
    const radius = Math.max(
      12,
      Math.max(...size) * 0.62 +
        Math.max(3, Math.min(10, Math.max(...size) * 0.04)),
    );
    const ringAxes = [
      { axis: 0 as const, first: 1 as const, second: 2 as const },
      { axis: 1 as const, first: 0 as const, second: 2 as const },
      { axis: 2 as const, first: 0 as const, second: 1 as const },
    ];
    let nearest: {
      readonly axis: TransformAxis;
      readonly distance: number;
    } | null = null;
    for (const ring of ringAxes) {
      let previous: readonly [number, number] | null = null;
      for (let segment = 0; segment <= 48; segment += 1) {
        const radians = (segment / 48) * Math.PI * 2;
        const point = [...pivot] as [number, number, number];
        point[ring.first] += Math.cos(radians) * radius;
        point[ring.second] += Math.sin(radians) * radius;
        const projected = this.projectToCanvas(point);
        if (previous && projected) {
          const distance = pointSegmentDistance(local, previous, projected);
          if (distance <= 10 && (!nearest || distance < nearest.distance)) {
            nearest = { axis: ring.axis, distance };
          }
        }
        previous = projected;
      }
    }
    if (!nearest) return null;
    const normal: Vec3 =
      nearest.axis === 0
        ? [1, 0, 0]
        : nearest.axis === 1
          ? [0, 1, 0]
          : [0, 0, 1];
    const ray = this.rayAt(clientX, clientY);
    const point = rayPlaneIntersection(
      ray.origin,
      ray.direction,
      pivot,
      normal,
    );
    if (!point) return null;
    const startVector: Vec3 = [
      point[0] - pivot[0],
      point[1] - pivot[1],
      point[2] - pivot[2],
    ];
    return Math.hypot(...startVector) <= 1e-4
      ? null
      : { mode: "rotate", pivot, axis: nearest.axis, startVector };
  }

  protected sweepDragEvent(
    gesture: SweepGesture,
    drag: PointerDrag,
    event: PointerEvent,
  ): EditorSweepDragEvent | null {
    if (this.kind !== "perspective") return null;
    if (gesture.mode === "translate") {
      const movement = this.pointerMovementDelta(drag, event, true);
      if (!movement || movement.movementPlane === "viewport") return null;
      return {
        phase: "preview",
        viewport: "perspective",
        mode: "translate",
        delta: movement.delta,
        movementPlane: movement.movementPlane,
        axisRestriction: movement.axisRestriction,
      };
    }
    if (gesture.mode === "rotate") {
      const normal: Vec3 =
        gesture.axis === 0
          ? [1, 0, 0]
          : gesture.axis === 1
            ? [0, 1, 0]
            : [0, 0, 1];
      const ray = this.rayAt(event.clientX, event.clientY);
      const point = rayPlaneIntersection(
        ray.origin,
        ray.direction,
        gesture.pivot,
        normal,
      );
      if (!point) return null;
      const current: Vec3 = [
        point[0] - gesture.pivot[0],
        point[1] - gesture.pivot[1],
        point[2] - gesture.pivot[2],
      ];
      if (Math.hypot(...current) <= 1e-4) return null;
      const radians = Math.atan2(
        dot(normal, cross(gesture.startVector, current)),
        dot(gesture.startVector, current),
      );
      const snap = event.shiftKey ? 5 : 15;
      return {
        phase: "preview",
        viewport: "perspective",
        mode: "rotate",
        axis: gesture.axis,
        angleDegrees: Math.round((radians * 180) / Math.PI / snap) * snap,
      };
    }
    const projectedPivot = this.projectToCanvas(gesture.pivot);
    const projectedHandle = this.projectToCanvas(gesture.handle);
    if (!projectedPivot || !projectedHandle) return null;
    const canvasBounds = this.canvas.getBoundingClientRect();
    const startX = projectedHandle[0] - projectedPivot[0];
    const startY = projectedHandle[1] - projectedPivot[1];
    const denominator = startX * startX + startY * startY;
    if (denominator <= 1e-6) return null;
    const currentX = event.clientX - canvasBounds.left - projectedPivot[0];
    const currentY = event.clientY - canvasBounds.top - projectedPivot[1];
    return {
      phase: "preview",
      viewport: "perspective",
      mode: "scale",
      factor: snappedScaleFactor(
        (currentX * startX + currentY * startY) / denominator,
      ),
    };
  }

  protected createTransformGesture(
    tool: "rotate" | "scale" | "shear",
    selection: EditorSelection,
    bounds: Bounds,
    clientX: number,
    clientY: number,
  ): TransformGesture | null {
    const boundsPivot: Vec3 = [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ];
    const pivot =
      tool === "rotate"
        ? (this.interaction.transformPivot() ?? boundsPivot)
        : boundsPivot;
    const axes = this.viewportAxes();
    if (tool === "rotate") {
      if (this.transformPivotHandleAt(pivot, clientX, clientY)) {
        return { tool: "pivot", pivot };
      }
      const axis = this.rotationAxisAt(bounds, pivot, clientX, clientY);
      if (axis === null) return null;
      const normal: Vec3 =
        axis === 0 ? [1, 0, 0] : axis === 1 ? [0, 1, 0] : [0, 0, 1];
      const ray = this.rayAt(clientX, clientY);
      const point = rayPlaneIntersection(
        ray.origin,
        ray.direction,
        pivot,
        normal,
      );
      if (!point) return null;
      const startVector: Vec3 = [
        point[0] - pivot[0],
        point[1] - pivot[1],
        point[2] - pivot[2],
      ];
      if (Math.hypot(...startVector) <= 1e-4) return null;
      return { tool, selection, pivot, axis, startVector };
    }
    if (tool === "scale") {
      const handle = this.scaleHandleAt(bounds, clientX, clientY);
      return handle ? { tool, selection, bounds, handle } : null;
    }
    const sourceAxis = this.kind === "perspective" ? 2 : axes.up;
    const targetAxis = this.kind === "perspective" ? 0 : axes.right;
    const sourceSpan = bounds.max[sourceAxis] - bounds.min[sourceAxis];
    if (sourceSpan <= 1e-6) return null;
    const shearPivot = [...pivot] as [number, number, number];
    shearPivot[sourceAxis] = bounds.min[sourceAxis];
    return {
      tool,
      selection,
      pivot: shearPivot,
      sourceAxis,
      targetAxis,
      sourceSpan,
    };
  }

  protected transformDragEvent(
    gesture: TransformGesture,
    event: PointerEvent,
    startX: number,
  ): EditorTransformDragEvent | null {
    if (gesture.tool === "pivot") return null;
    if (gesture.tool === "rotate") {
      const normal: Vec3 =
        gesture.axis === 0
          ? [1, 0, 0]
          : gesture.axis === 1
            ? [0, 1, 0]
            : [0, 0, 1];
      const ray = this.rayAt(event.clientX, event.clientY);
      const point = rayPlaneIntersection(
        ray.origin,
        ray.direction,
        gesture.pivot,
        normal,
      );
      if (!point) return null;
      const current: Vec3 = [
        point[0] - gesture.pivot[0],
        point[1] - gesture.pivot[1],
        point[2] - gesture.pivot[2],
      ];
      if (Math.hypot(...current) <= 1e-4) return null;
      const radians = Math.atan2(
        dot(normal, cross(gesture.startVector, current)),
        dot(gesture.startVector, current),
      );
      const snap = event.shiftKey ? 5 : 15;
      const angleDegrees = Math.round((radians * 180) / Math.PI / snap) * snap;
      return {
        phase: "preview",
        viewport: this.kind,
        tool: "rotate",
        selection: gesture.selection,
        pivot: gesture.pivot,
        axis: gesture.axis,
        angleDegrees,
      };
    }
    if (gesture.tool === "scale") {
      const pivot = scalePivot(gesture.bounds, gesture.handle, event.altKey);
      const viewportAxes = this.viewportAxes();
      const proportionalAxes: readonly TransformAxis[] =
        this.kind === "perspective"
          ? [0, 1, 2]
          : [viewportAxes.right, viewportAxes.up];
      const transformedAxes = event.shiftKey
        ? proportionalAxes
        : gesture.handle.axes;
      const factors: [number, number, number] = [1, 1, 1];

      if (this.kind === "perspective" || event.shiftKey) {
        const projectedPivot = this.projectToCanvas(pivot);
        const projectedHandle = this.projectToCanvas(gesture.handle.point);
        if (!projectedPivot || !projectedHandle) return null;
        const canvasBounds = this.canvas.getBoundingClientRect();
        const projectedStartX = projectedHandle[0] - projectedPivot[0];
        const projectedStartY = projectedHandle[1] - projectedPivot[1];
        const denominator =
          projectedStartX * projectedStartX + projectedStartY * projectedStartY;
        if (denominator <= 1e-6) return null;
        const currentX = event.clientX - canvasBounds.left - projectedPivot[0];
        const currentY = event.clientY - canvasBounds.top - projectedPivot[1];
        const factor = snappedScaleFactor(
          (currentX * projectedStartX + currentY * projectedStartY) /
            denominator,
        );
        for (const axis of transformedAxes) factors[axis] = factor;
      } else {
        const ray = this.rayAt(event.clientX, event.clientY);
        const point = rayPlaneIntersection(
          ray.origin,
          ray.direction,
          gesture.handle.point,
          this.viewDirection(),
        );
        if (!point) return null;
        for (const axis of transformedAxes) {
          const start = gesture.handle.point[axis] - pivot[axis];
          if (Math.abs(start) <= 1e-6) continue;
          factors[axis] = snappedScaleFactor(
            (point[axis] - pivot[axis]) / start,
          );
        }
      }
      return {
        phase: "preview",
        viewport: this.kind,
        tool: "scale",
        selection: gesture.selection,
        pivot,
        factors,
      };
    }
    const offset =
      Math.round(
        ((event.clientX - startX) * this.worldPerPixel()) / this.gridSize,
      ) * this.gridSize;
    return {
      phase: "preview",
      viewport: this.kind,
      tool: "shear",
      selection: gesture.selection,
      pivot: gesture.pivot,
      sourceAxis: gesture.sourceAxis,
      targetAxis: gesture.targetAxis,
      factor: offset / gesture.sourceSpan,
      offset,
    };
  }
}
