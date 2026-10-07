import { pickFaceMagnet, faceMagnets, alignedFaces } from "./face-magnet.js";
import {
  isBrushSelected,
  isFaceSelected,
  isPointEntitySelected,
  type TransformAxis,
  type Vec3,
} from "../core/index.js";
import type { EditorTransformPivotDragEvent } from "./types.js";
import { boundsCenter } from "./scene-buffers.js";
import {
  addScaled,
  creationBounds,
  cross,
  dedupeHullPoints,
  encodedTopologyPoint,
  normalize,
  rayPlaneIntersection,
  rectangleOnPlane,
  snapPointToPlane,
  snappedDelta,
  topologyHandleBrushIds,
  topologyHandleVertices,
} from "./viewport-geometry.js";

import {
  isBrushRayHit,
  selectionForHit,
  selectionContainsHit,
} from "./viewport-common.js";
import { ViewportPointerDown } from "./viewport-pointer-down.js";
export abstract class ViewportPointerMove extends ViewportPointerDown {
  protected connectPointerMove(): void {
    const options = { signal: this.inputSignal };
    this.canvas.addEventListener(
      "pointerleave",
      () => {
        this.hoverPointer = null;
      },
      options,
    );
    const refreshModifier = (event: KeyboardEvent) => {
      if (event.key !== "Shift" || this.dragState || !this.hoverPointer) return;
      this.updateHoverAt({
        ...this.hoverPointer,
        clientX: this.hoverPointer.clientX,
        clientY: this.hoverPointer.clientY,
        shiftKey: event.type === "keydown",
      });
    };
    window.addEventListener("keydown", refreshModifier, options);
    window.addEventListener("keyup", refreshModifier, options);
    this.canvas.addEventListener(
      "pointermove",
      (event) => this.updatePointerPosition(event),
      {
        signal: this.inputSignal,
      },
    );
  }

  private hoverPointer: Pick<
    PointerEvent,
    "clientX" | "clientY" | "shiftKey"
  > | null = null;

  private updateHoverAt(
    event: Pick<PointerEvent, "clientX" | "clientY" | "shiftKey">,
  ): void {
    const tool = this.interaction.currentTool();
    if (tool === "rotate") {
      const selection = this.interaction.currentSelection();
      const bounds =
        selection && !selection.faceId
          ? this.interaction.brushBounds(selection)
          : null;
      const pivot = bounds
        ? (this.interaction.transformPivot() ?? boundsCenter(bounds))
        : null;
      const hovered = Boolean(
        pivot &&
        this.transformPivotHandleAt(pivot, event.clientX, event.clientY),
      );
      this.interaction.hoverTransformPivot(hovered);
      if (hovered && pivot) this.showPivotCoordinates(pivot);
      else this.hideTransformReadout();
      this.interaction.hover(null);
      this.interaction.hoverTopology(null);
    } else if (tool === "vertex" || tool === "edge") {
      this.interaction.hoverTransformPivot(false);
      this.hideTransformReadout();
      const handle = this.topologyHandleAt(tool, event.clientX, event.clientY);
      const insertion =
        tool === "vertex" && event.shiftKey && !handle
          ? this.prospectiveVertexHandleAt(event.clientX, event.clientY)
          : null;
      this.interaction.hoverTopology(handle ?? insertion);
      this.interaction.hover(null);
    } else if (tool === "face") {
      this.interaction.hoverTransformPivot(false);
      this.hideTransformReadout();
      const handle = this.faceHandleAt(event.clientX, event.clientY);
      if (handle) this.interaction.hover(handle.selection);
      else {
        const ray = this.rayAt(event.clientX, event.clientY);
        const hit = this.interaction
          .hitTests(ray.origin, ray.direction)
          .find(isBrushRayHit);
        this.interaction.hover(
          hit ? { brushId: hit.brushId, faceId: hit.faceId } : null,
        );
      }
    } else if (tool === "select") {
      this.interaction.hoverTransformPivot(false);
      this.hideTransformReadout();
      const ray = this.rayAt(event.clientX, event.clientY);
      const selection = this.interaction.currentSelection();
      const hit = event.shiftKey
        ? (this.interaction
            .hitTests(ray.origin, ray.direction)
            .find(
              (candidate) =>
                isBrushRayHit(candidate) &&
                selectionContainsHit(selection, candidate),
            ) ?? null)
        : this.selectionHitAt(event.clientX, event.clientY);
      const proximateFace =
        event.shiftKey && selection && !selection.faceId
          ? this.proximateSelectedFaceAt(event.clientX, event.clientY)
          : null;
      this.interaction.hover(
        hit &&
          event.shiftKey &&
          isBrushRayHit(hit) &&
          selection &&
          !selection.faceId &&
          selectionContainsHit(selection, hit)
          ? { brushId: hit.brushId, faceId: hit.faceId }
          : proximateFace
            ? proximateFace.selection
            : hit
              ? selectionForHit(hit)
              : null,
      );
      this.interaction.hoverTopology(null);
    } else {
      this.interaction.hoverTransformPivot(false);
      this.hideTransformReadout();
      this.interaction.hover(null);
      this.interaction.hoverTopology(null);
    }
  }

  protected updatePointerPosition(event: PointerEvent): void {
    this.hoverPointer = event;
    const drag = this.dragState;
    // Camera drags need no surface pick or collaboration cursor update on every mouse sample.
    // Refresh the editing cursor once on release, using the resulting camera.
    if (!drag?.cameraMode) {
      const pointerPosition = this.pointerPositionAt(
        event.clientX,
        event.clientY,
      );
      if (pointerPosition) this.interaction.pointerPosition(pointerPosition);
    }
    if (!drag || drag.pointerId !== event.pointerId) {
      this.updateHoverAt(event);
      return;
    }
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.moved = Math.hypot(
      event.clientX - drag.startX,
      event.clientY - drag.startY,
    );
    if (drag.cameraMode === "look" && drag.cameraEye && drag.moved >= 5) {
      // Keyboard flight can move the eye during a look gesture; preserve its current position.
      const cameraEye = this.perspectiveEye();
      this.state.yaw -= deltaX * 0.006;
      this.state.pitch = Math.max(
        -1.45,
        Math.min(1.45, this.state.pitch - deltaY * 0.006),
      );
      const center = addScaled(
        cameraEye,
        this.perspectiveForward(),
        this.state.distance,
      );
      this.state.center = [center[0], center[1], center[2]];
      this.setInteractionState("camera-looking");
      this.notifyCamera("look");
    } else if (drag.cameraMode === "orbit" && drag.moved >= 5) {
      if (!drag.cameraOrbitInitialized) {
        if (drag.cameraOrbit) {
          this.state.center = [...drag.cameraOrbit.center];
          this.state.distance = drag.cameraOrbit.distance;
          this.state.yaw = drag.cameraOrbit.yaw;
          this.state.pitch = drag.cameraOrbit.pitch;
        }
        drag.cameraOrbitInitialized = true;
      }
      this.state.yaw -= deltaX * 0.006;
      this.state.pitch = Math.max(
        -1.45,
        Math.min(1.45, this.state.pitch - deltaY * 0.006),
      );
      this.setInteractionState("camera-orbiting");
      this.notifyCamera("orbit");
    } else if (
      drag.cameraMode === "pan" &&
      (drag.button === 1 || drag.moved >= 5)
    ) {
      if (this.kind === "perspective") {
        const forward = this.perspectiveForward();
        const right = normalize(cross(forward, [0, 0, 1]));
        const up = normalize(cross(right, forward));
        const worldPerPixel = this.worldPerPixel();
        this.translatePerspectiveCamera(
          addScaled(
            [
              right[0] * -deltaX * worldPerPixel,
              right[1] * -deltaX * worldPerPixel,
              right[2] * -deltaX * worldPerPixel,
            ],
            up,
            deltaY * worldPerPixel,
          ),
        );
      } else {
        const worldPerPixel =
          this.state.orthographicSpan / Math.max(1, this.canvas.clientHeight);
        if (this.kind === "xy") {
          this.state.center[0] -= deltaX * worldPerPixel;
          this.state.center[1] += deltaY * worldPerPixel;
        } else if (this.kind === "xz") {
          this.state.center[0] -= deltaX * worldPerPixel;
          this.state.center[2] += deltaY * worldPerPixel;
        } else if (this.kind === "yz") {
          this.state.center[1] -= deltaX * worldPerPixel;
          this.state.center[2] += deltaY * worldPerPixel;
        }
      }
      this.setInteractionState("camera-panning");
      this.notifyCamera("pan");
    } else if (drag.button === 0 && drag.moved >= 5 && drag.objectPainting) {
      const hit = this.selectionHitAt(event.clientX, event.clientY);
      const candidates = [drag.hit, hit ? selectionForHit(hit) : null];
      for (const candidate of candidates) {
        if (candidate?.brushId) {
          if (drag.paintedBrushIds.has(candidate.brushId)) continue;
          drag.paintedBrushIds.add(candidate.brushId);
          if (
            isBrushSelected(
              this.interaction.currentSelection(),
              candidate.brushId,
            )
          )
            continue;
        } else if (candidate?.entityId) {
          if (drag.paintedEntityIds.has(candidate.entityId)) continue;
          drag.paintedEntityIds.add(candidate.entityId);
          if (
            isPointEntitySelected(
              this.interaction.currentSelection(),
              candidate.entityId,
            )
          ) {
            continue;
          }
        } else {
          continue;
        }
        this.interaction.pick(candidate, this.kind, {
          additive: false,
          objectAdditive: true,
          expansion: "single",
          objectExpansion: "single",
          paint: true,
        });
      }
      this.setInteractionState("painting");
    } else if (drag.button === 0 && drag.moved >= 5 && drag.sweep) {
      const sweepEvent = this.sweepDragEvent(drag.sweep, drag, event);
      if (!sweepEvent) return;
      const changed =
        sweepEvent.mode === "translate"
          ? sweepEvent.delta.some(
              (component) => Math.abs(component) > Number.EPSILON,
            )
          : sweepEvent.mode === "rotate"
            ? Math.abs(sweepEvent.angleDegrees) > Number.EPSILON
            : Math.abs(sweepEvent.factor - 1) > Number.EPSILON;
      if (!changed) return;
      drag.sweepMoving = true;
      drag.lastSweep = sweepEvent;
      this.setInteractionState("transforming");
      this.interaction.sweep(sweepEvent);
    } else if (
      drag.button === 0 &&
      drag.moved >= 5 &&
      drag.clipping &&
      drag.clipPointIndex !== null &&
      drag.clipPoint
    ) {
      const candidate = this.clipPointAt(
        event.clientX,
        event.clientY,
        drag.clipPoint,
      );
      if (!candidate) return;
      let point = candidate;
      let axisRestriction: TransformAxis | null = null;
      if (this.kind !== "perspective" && event.shiftKey) {
        const viewportAxes = this.viewportAxes();
        const axes = [viewportAxes.right, viewportAxes.up] as const;
        const delta: Vec3 = [
          candidate[0] - drag.clipPoint[0],
          candidate[1] - drag.clipPoint[1],
          candidate[2] - drag.clipPoint[2],
        ];
        axisRestriction = axes.reduce((best, axis) =>
          Math.abs(delta[axis]) > Math.abs(delta[best]) ? axis : best,
        );
        const restricted = [...drag.clipPoint] as [number, number, number];
        restricted[axisRestriction] += delta[axisRestriction];
        point = restricted;
      }
      if (
        drag.clipMoving &&
        drag.lastClipPoint?.every(
          (component, axis) => component === point[axis],
        ) &&
        drag.lastAxisRestriction === axisRestriction
      )
        return;
      drag.clipMoving = true;
      drag.lastClipPoint = point;
      drag.lastAxisRestriction = axisRestriction;
      this.setInteractionState("reshaping");
      this.interaction.moveClipPoint(
        drag.clipPointIndex,
        point,
        this.kind,
        this.viewDirection(),
        axisRestriction,
        "preview",
      );
    } else if (
      drag.button === 0 &&
      drag.faceTransferMode &&
      drag.faceTransferSource &&
      drag.moved >= 5
    ) {
      const ray = this.rayAt(event.clientX, event.clientY);
      const hit = this.interaction
        .hitTests(ray.origin, ray.direction)
        .find(isBrushRayHit);
      if (!hit) return;
      const target = { brushId: hit.brushId, faceId: hit.faceId } as const;
      if (
        target.brushId === drag.faceTransferSource.brushId &&
        target.faceId === drag.faceTransferSource.faceId
      )
        return;
      const key = `${target.brushId}\u0000${target.faceId}`;
      if (
        drag.faceTransferTargets.some(
          (candidate) =>
            `${candidate.brushId}\u0000${candidate.faceId}` === key,
        )
      )
        return;
      drag.faceTransferTargets.push(target);
      drag.faceTransferMoving = true;
      this.setInteractionState("painting");
      this.interaction.transfer({
        phase: "preview",
        viewport: this.kind,
        mode: drag.faceTransferMode,
        source: drag.faceTransferSource,
        targets: drag.faceTransferTargets,
      });
    } else if (
      drag.button === 0 &&
      drag.moved >= 5 &&
      drag.hullBuilding &&
      drag.hullPoint &&
      drag.planePoint
    ) {
      let preview: readonly Vec3[] = [];
      if (drag.hullDuplicating && drag.faceScreenDirection) {
        const totalX = event.clientX - drag.startX;
        const totalY = event.clientY - drag.startY;
        const projectedPixels =
          totalX * drag.faceScreenDirection[0] +
          totalY * drag.faceScreenDirection[1];
        const distance =
          Math.round(
            projectedPixels / drag.facePixelsPerWorld / this.gridSize,
          ) * this.gridSize;
        preview = this.interaction
          .hullPoints()
          .map((point) => addScaled(point, drag.planeNormal, distance));
      } else {
        const ray = this.rayAt(event.clientX, event.clientY);
        const point = rayPlaneIntersection(
          ray.origin,
          ray.direction,
          drag.planePoint,
          drag.planeNormal,
        );
        if (!point) return;
        preview = rectangleOnPlane(
          drag.hullPoint,
          snapPointToPlane(
            point,
            drag.planePoint,
            drag.planeNormal,
            this.gridSize,
          ),
          drag.planeNormal,
        );
      }
      preview = dedupeHullPoints(preview);
      if (
        drag.hullMoving &&
        preview.length === drag.lastHullPoints.length &&
        preview.every(
          (point, index) =>
            encodedTopologyPoint(point) ===
            encodedTopologyPoint(drag.lastHullPoints[index]!),
        )
      )
        return;
      drag.hullMoving = true;
      drag.lastHullPoints = preview;
      this.setInteractionState("creating");
      this.interaction.previewHullPoints(preview);
    } else if (drag.button === 0 && drag.facePainting) {
      const ray = this.rayAt(event.clientX, event.clientY);
      const hit = this.interaction
        .hitTests(ray.origin, ray.direction)
        .find(isBrushRayHit);
      if (!hit) return;
      const key = `${hit.brushId}\u0000${hit.faceId}`;
      if (drag.paintedFaceKeys.has(key)) return;
      drag.paintedFaceKeys.add(key);
      if (
        isFaceSelected(
          this.interaction.currentSelection(),
          hit.brushId,
          hit.faceId,
        )
      )
        return;
      this.setInteractionState("painting");
      this.interaction.pick(
        { brushId: hit.brushId, faceId: hit.faceId },
        this.kind,
        {
          additive: true,
          expansion: "single",
          paint: true,
        },
      );
    } else if (drag.button === 0 && drag.moved >= 5 && drag.faceLassoEligible) {
      drag.faceLasso = true;
      this.updateHandleLasso(
        drag.startX,
        drag.startY,
        event.clientX,
        event.clientY,
      );
    } else if (
      drag.button === 0 &&
      drag.moved >= 5 &&
      drag.topologyKind &&
      !drag.topologyHandle
    ) {
      drag.topologyLasso = true;
      this.updateHandleLasso(
        drag.startX,
        drag.startY,
        event.clientX,
        event.clientY,
      );
    } else if (
      drag.button === 0 &&
      drag.moved >= 5 &&
      drag.transform?.tool === "pivot" &&
      drag.anchor &&
      drag.planePoint
    ) {
      const movement = this.pointerMovementDelta(drag, event, true);
      if (!movement) return;
      if (
        !drag.pivotMoving &&
        movement.delta.every(
          (component) => Math.abs(component) <= Number.EPSILON,
        )
      ) {
        return;
      }
      const pivot: Vec3 = [
        drag.transform.pivot[0] + movement.delta[0],
        drag.transform.pivot[1] + movement.delta[1],
        drag.transform.pivot[2] + movement.delta[2],
      ];
      if (
        drag.lastPivot &&
        drag.lastPivot.pivot.every(
          (component, axis) => component === pivot[axis],
        ) &&
        drag.lastPivot.axisRestriction === movement.axisRestriction &&
        drag.lastPivot.movementPlane === movement.movementPlane
      ) {
        return;
      }
      const pivotEvent: EditorTransformPivotDragEvent = {
        phase: "preview",
        viewport: this.kind,
        startPivot: drag.transform.pivot,
        pivot,
        delta: movement.delta,
        movementPlane: movement.movementPlane,
        axisRestriction: movement.axisRestriction,
      };
      drag.pivotMoving = true;
      drag.lastPivot = pivotEvent;
      drag.lastDelta = movement.delta;
      drag.lastMovementPlane = movement.movementPlane;
      drag.lastAxisRestriction = movement.axisRestriction;
      this.setInteractionState("transforming");
      this.showPivotCoordinates(pivot);
      this.interaction.moveTransformPivot(pivotEvent);
    } else if (
      drag.button === 0 &&
      drag.moved >= 5 &&
      drag.transform &&
      drag.transform.tool !== "pivot"
    ) {
      const transformEvent = this.transformDragEvent(
        drag.transform,
        event,
        drag.startX,
      );
      if (!transformEvent) return;
      const changed =
        transformEvent.tool === "rotate"
          ? Math.abs(transformEvent.angleDegrees) > Number.EPSILON
          : transformEvent.tool === "scale"
            ? transformEvent.factors.some(
                (factor) => Math.abs(factor - 1) > Number.EPSILON,
              )
            : Math.abs(transformEvent.factor) > Number.EPSILON;
      if (!changed) return;
      drag.transformMoving = true;
      drag.lastTransform = transformEvent;
      this.setInteractionState("transforming");
      if (transformEvent.tool === "rotate") {
        this.showTransformReadout(
          `${transformEvent.angleDegrees}\u00b0`,
          transformEvent.pivot,
        );
      }
      this.interaction.transform(transformEvent);
    } else if (
      drag.button === 0 &&
      drag.moved >= 5 &&
      drag.topologyKind &&
      drag.topologyHandle &&
      !drag.topologySnapTarget &&
      drag.topologySelection &&
      drag.anchor &&
      drag.planePoint
    ) {
      const movement = this.pointerMovementDelta(
        drag,
        event,
        drag.topologyOperation === "move",
      );
      if (!movement) return;
      const snapMode =
        drag.topologyKind === "vertex" && (event.ctrlKey || event.metaKey)
          ? "absolute"
          : "relative";
      const delta =
        snapMode === "absolute"
          ? this.absoluteTopologyDelta(
              drag.topologyHandle,
              movement.delta,
              movement.axes,
            )
          : movement.delta;
      if (
        drag.topologyMoving &&
        delta.every((component, axis) => component === drag.lastDelta[axis])
      )
        return;
      drag.topologyMoving = true;
      drag.lastDelta = delta;
      drag.lastTopologySnapMode = snapMode;
      drag.lastMovementPlane = movement.movementPlane;
      drag.lastAxisRestriction = movement.axisRestriction;
      this.setInteractionState("reshaping");
      this.interaction.topology(
        {
          phase: "preview",
          viewport: this.kind,
          kind: drag.topologyKind,
          operation: drag.topologyOperation,
          selection: drag.topologySelection,
          brushIds: topologyHandleBrushIds(drag.topologyHandles),
          vertices: topologyHandleVertices(drag.topologyHandles),
          delta,
          snapMode,
          movementPlane: movement.movementPlane,
          axisRestriction: movement.axisRestriction,
        },
        drag.topologyHandles,
      );
    } else if (
      drag.button === 0 &&
      (drag.faceMoving || drag.moved >= 5) &&
      drag.faceTranslating &&
      drag.faceSelection &&
      drag.anchor &&
      drag.planePoint
    ) {
      const ray = this.rayAt(event.clientX, event.clientY);
      const point = rayPlaneIntersection(
        ray.origin,
        ray.direction,
        drag.planePoint,
        drag.planeNormal,
      );
      if (!point) return;
      const delta = snappedDelta(drag.anchor, point, this.gridSize);
      if (
        drag.faceMoving &&
        delta.every((component, axis) => component === drag.lastDelta[axis])
      )
        return;
      drag.faceMoving = true;
      drag.lastDelta = delta;
      this.setInteractionState("reshaping");
      this.interaction.face({
        phase: "preview",
        viewport: this.kind,
        selection: drag.faceSelection,
        mode: "translate",
        delta,
        split: false,
        stamp: false,
      });
    } else if (
      drag.button === 0 &&
      (drag.faceMoving || drag.moved >= 5) &&
      drag.faceSelection &&
      drag.faceScreenDirection
    ) {
      const totalX = event.clientX - drag.startX;
      const totalY = event.clientY - drag.startY;
      const projectedPixels =
        totalX * drag.faceScreenDirection[0] +
        totalY * drag.faceScreenDirection[1];
      const rawDistance = projectedPixels / drag.facePixelsPerWorld;
      const candidatesAt = (distance: number) =>
        drag.faceSource
          ? faceMagnets(
              drag.faceSource,
              this.interaction.faceSnapTargets(
                drag.faceSource,
                distance,
                14 / Math.max(0.001, drag.facePixelsPerWorld),
              ),
            )
          : [];
      drag.faceMagnet =
        event.ctrlKey || event.metaKey
          ? null
          : pickFaceMagnet(
              rawDistance,
              drag.facePixelsPerWorld,
              candidatesAt(rawDistance),
              drag.faceMagnet,
            );
      const distance =
        drag.faceMagnet?.distance ??
        Math.round(rawDistance / this.gridSize) * this.gridSize;
      const alignment = alignedFaces(
        distance,
        drag.facePixelsPerWorld,
        candidatesAt(distance),
      );
      if (
        alignment.length !== drag.faceAlignment.length ||
        alignment.some((face, i) => face !== drag.faceAlignment[i])
      ) {
        drag.faceAlignment = alignment;
        this.invalidateRender();
      }
      this.hideTransformReadout();
      this.canvas.dataset.faceMagnet = drag.faceMagnet ? String(distance) : "";
      if (drag.faceMoving && distance === drag.lastFaceDistance) return;
      drag.faceMoving = true;
      drag.lastFaceDistance = distance;
      this.setInteractionState("extruding");
      this.interaction.face({
        phase: "preview",
        viewport: this.kind,
        selection: drag.faceSelection,
        mode: "normal",
        distance,
        split: drag.faceSplitting,
        stamp: drag.faceStamping,
      });
    } else if (
      drag.button === 0 &&
      drag.moved >= 5 &&
      drag.creating &&
      drag.anchor &&
      drag.planePoint
    ) {
      const ray = this.rayAt(event.clientX, event.clientY);
      const point = rayPlaneIntersection(
        ray.origin,
        ray.direction,
        drag.planePoint,
        drag.planeNormal,
      );
      if (!point) return;
      const heightOnly =
        this.kind === "perspective" && event.altKey && !event.shiftKey;
      const cube =
        this.kind === "perspective" && event.altKey && event.shiftKey;
      const square = event.shiftKey && !cube;
      let nextBounds = creationBounds(
        drag.anchor,
        point,
        this.kind,
        this.gridSize,
        drag.creationReferenceBounds,
        square || cube,
        cube,
      );
      if (heightOnly && drag.lastBounds) {
        const height = Math.max(
          this.gridSize,
          Math.round(
            (Math.abs(event.clientY - drag.startY) * this.worldPerPixel()) /
              this.gridSize,
          ) * this.gridSize,
        );
        nextBounds = {
          min: [
            drag.lastBounds.min[0],
            drag.lastBounds.min[1],
            drag.planePoint[2],
          ],
          max: [
            drag.lastBounds.max[0],
            drag.lastBounds.max[1],
            drag.planePoint[2] + height,
          ],
        };
      }
      drag.lastBounds = nextBounds;
      if (!drag.lastBounds) return;
      drag.lastCreationConstraint = heightOnly
        ? "height"
        : cube
          ? "cube"
          : square
            ? "square"
            : "none";
      drag.moving = true;
      this.setInteractionState("creating");
      this.interaction.create({
        phase: "preview",
        viewport: this.kind,
        bounds: drag.lastBounds,
        constraint: drag.lastCreationConstraint,
      });
    } else if (
      drag.button === 0 &&
      drag.moved >= 5 &&
      drag.moveSelection &&
      drag.anchor &&
      drag.planePoint
    ) {
      const movement = this.pointerMovementDelta(drag, event, true);
      if (!movement) return;
      drag.moving = true;
      drag.lastDelta = movement.delta;
      drag.lastMovementPlane = movement.movementPlane;
      drag.lastAxisRestriction = movement.axisRestriction;
      this.setInteractionState("moving");
      this.interaction.drag(
        {
          phase: "preview",
          viewport: this.kind,
          selection: drag.moveSelection,
          delta: drag.lastDelta,
          movementPlane: movement.movementPlane,
          axisRestriction: movement.axisRestriction,
          duplicate: drag.duplicating,
        },
        [drag.planePoint],
      );
    }
  }
}
