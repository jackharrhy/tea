import { connectDragLifecycle } from "./viewport/drag-lifecycle.js";
import { type Vec3 } from "../core/index.js";
import type {
  EditorSweepDragEvent,
  EditorTransformDragEvent,
} from "./types.js";
import {
  topologyHandleBrushIds,
  topologyHandleVertices,
} from "./viewport-geometry.js";

import { isBrushRayHit, selectionForHit } from "./viewport-common.js";
import { ViewportPointerMove } from "./viewport-pointer-move.js";
export class Viewport extends ViewportPointerMove {
  protected connectInput(): void {
    this.connectPointerDown();
    this.connectPointerMove();
    connectDragLifecycle({
      canvas: this.canvas,
      signal: this.inputSignal,
      current: () => this.dragState,
      release: (event) => this.releaseDrag(event),
      cancel: () => this.cancelDrag(),
    });
    this.canvas.addEventListener(
      "dblclick",
      (event) => {
        if (event.button !== 0) return;
        const ray = this.rayAt(event.clientX, event.clientY);
        const tool = this.interaction.currentTool();
        const hit =
          tool === "select" && !event.shiftKey && !event.altKey
            ? this.selectionHitAt(event.clientX, event.clientY)
            : (this.interaction
                .hitTests(ray.origin, ray.direction)
                .find(isBrushRayHit) ?? null);
        if (!hit) {
          if (tool === "select" && !event.shiftKey && !event.altKey) {
            this.interaction.pick(null, this.kind, {
              additive: false,
              expansion: "single",
              objectExpansion: "activate",
            });
          }
          return;
        }
        if (this.interaction.currentTool() === "clip") {
          if (isBrushRayHit(hit))
            this.interaction.matchClipFace(hit, this.kind);
          return;
        }
        const sequenceSource = this.faceTransferSequenceSource;
        if (this.kind === "perspective" && event.altKey) {
          if (this.pendingFaceTransferClick !== null) {
            window.clearTimeout(this.pendingFaceTransferClick);
            this.pendingFaceTransferClick = null;
          }
          if (this.faceTransferSequenceReset !== null) {
            window.clearTimeout(this.faceTransferSequenceReset);
            this.faceTransferSequenceReset = null;
          }
          this.faceTransferSequenceSource = undefined;
        }
        if (
          isBrushRayHit(hit) &&
          this.kind === "perspective" &&
          event.altKey &&
          sequenceSource &&
          (this.interaction.currentTool() === "select" ||
            this.interaction.currentTool() === "face")
        ) {
          this.interaction.transfer({
            phase: "commit",
            viewport: this.kind,
            mode:
              event.ctrlKey || event.metaKey
                ? "material"
                : event.shiftKey
                  ? "rotate"
                  : "project",
            source: sequenceSource,
            targets: this.interaction
              .brushFaceSelections(hit.brushId)
              .filter(
                (target) =>
                  target.brushId !== sequenceSource.brushId ||
                  target.faceId !== sequenceSource.faceId,
              ),
          });
          return;
        }
        if (
          isBrushRayHit(hit) &&
          this.interaction.currentTool() === "hull" &&
          this.kind === "perspective"
        ) {
          this.interaction.addHullFace(
            { brushId: hit.brushId, faceId: hit.faceId },
            "perspective",
            this.interaction.snapClipHit(hit, this.gridSize) ?? undefined,
          );
          return;
        }
        if (
          this.interaction.currentTool() === "select" &&
          !event.shiftKey &&
          !event.altKey
        ) {
          this.interaction.pick(selectionForHit(hit), this.kind, {
            additive: false,
            objectAdditive: event.ctrlKey || event.metaKey,
            expansion: "single",
            objectExpansion: "activate",
          });
          return;
        }
        if (!isBrushRayHit(hit)) return;
        if (
          this.interaction.currentTool() !== "face" &&
          !(this.interaction.currentTool() === "select" && event.shiftKey)
        )
          return;
        this.interaction.pick(
          { brushId: hit.brushId, faceId: hit.faceId },
          this.kind,
          {
            additive:
              this.interaction.currentTool() === "face"
                ? event.shiftKey
                : event.ctrlKey || event.metaKey,
            expansion: event.altKey ? "coplanar" : "brush",
          },
        );
      },
      { signal: this.inputSignal },
    );
    this.canvas.addEventListener(
      "pointerleave",
      () => {
        if (!this.dragState) {
          this.interaction.hover(null);
          this.interaction.hoverTopology(null);
          this.interaction.hoverTransformPivot(false);
          this.hideTransformReadout();
        }
      },
      { signal: this.inputSignal },
    );
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        if (
          this.interaction.currentTool() === "select" &&
          (event.ctrlKey || event.metaKey) &&
          event.deltaY !== 0
        ) {
          const selection = this.interaction.currentSelection();
          const faceDrill = event.shiftKey;
          if (!selection || faceDrill !== Boolean(selection.faceId)) return;
          const ray = this.rayAt(event.clientX, event.clientY);
          const hits = faceDrill
            ? this.interaction
                .hitTests(ray.origin, ray.direction)
                .filter(isBrushRayHit)
            : this.selectionHitsAt(event.clientX, event.clientY);
          const selectedIndex = hits.findIndex((hit) => {
            if (faceDrill)
              return (
                isBrushRayHit(hit) &&
                hit.brushId === selection.brushId &&
                hit.faceId === selection.faceId
              );
            return isBrushRayHit(hit)
              ? hit.brushId === selection.brushId
              : hit.entityId === selection.entityId;
          });
          if (selectedIndex < 0) return;
          const direction = event.deltaY < 0 ? "farther" : "nearer";
          const offset = direction === "farther" ? 1 : -1;
          const next =
            hits[(selectedIndex + offset + hits.length) % hits.length];
          if (!next || hits.length < 2) return;
          const nextSelection =
            faceDrill && isBrushRayHit(next)
              ? { brushId: next.brushId, faceId: next.faceId }
              : selectionForHit(next);
          this.interaction.pick(nextSelection, this.kind, {
            additive: false,
            expansion: "single",
            objectExpansion: "single",
            drill: direction,
            drillTarget: faceDrill ? "face" : "object",
          });
          return;
        }
        const factor = Math.exp(event.deltaY * 0.001);
        if (this.kind === "perspective") {
          if (this.dragState?.cameraMode === "orbit") {
            this.dragState.moved = Math.max(5, this.dragState.moved);
            this.state.distance = Math.max(
              8,
              Math.min(65_536, this.state.distance * factor),
            );
            this.notifyCamera("orbit");
            return;
          }
          if (this.dragState?.cameraMode === "look") {
            this.dragState.moved = Math.max(5, this.dragState.moved);
            this.state.flySpeed = Math.max(
              32,
              Math.min(
                4096,
                this.state.flySpeed * Math.exp(event.deltaY * -0.001),
              ),
            );
            this.notifyCamera("fly");
            return;
          }
          if (event.shiftKey) {
            this.state.fieldOfViewRadians = Math.max(
              Math.PI / 9,
              Math.min(
                (Math.PI * 2) / 3,
                this.state.fieldOfViewRadians * factor,
              ),
            );
            this.notifyCamera("zoom");
            return;
          }
          const deltaScale =
            event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 240 : 1;
          const amount =
            -event.deltaY *
            deltaScale *
            Math.max(0.08, this.state.distance / 1600);
          const forward = this.perspectiveForward();
          this.translatePerspectiveCamera([
            forward[0] * amount,
            forward[1] * amount,
            forward[2] * amount,
          ]);
          this.notifyCamera("dolly");
        } else {
          const before = this.rayAt(event.clientX, event.clientY).origin;
          this.state.orthographicSpan = Math.max(
            32,
            Math.min(32_768, this.state.orthographicSpan * factor),
          );
          const after = this.rayAt(event.clientX, event.clientY).origin;
          const axes = this.viewportAxes();
          this.state.center[axes.right] +=
            before[axes.right] - after[axes.right];
          this.state.center[axes.up] += before[axes.up] - after[axes.up];
          this.notifyCamera("zoom");
        }
      },
      { passive: false, signal: this.inputSignal },
    );
  }

  private releaseDrag(event: PointerEvent): void {
    const drag = this.dragState;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // A release can carry a position newer than the last delivered pointermove.
    // Resolve that sample through the same constraints/previews before committing.
    if (event.clientX !== drag.x || event.clientY !== drag.y) {
      this.updatePointerPosition(event);
    }
    this.dragState = null;
    if (drag.button === 2 && drag.moved < 5 && drag.cameraMode !== "orbit") {
      const pointer = this.pointerPositionAt(event.clientX, event.clientY);
      if (pointer) {
        const hit = this.selectionHitAt(event.clientX, event.clientY);
        this.interaction.contextMenu({
          viewport: this.kind,
          clientX: event.clientX,
          clientY: event.clientY,
          pointer,
          hit: hit
            ? isBrushRayHit(hit)
              ? { brushId: hit.brushId, faceId: hit.faceId }
              : { entityId: hit.entityId }
            : null,
          pointEntityOrigin: this.pointEntityOriginAt(
            event.clientX,
            event.clientY,
          ),
        });
      }
    } else if (drag.button === 0 && drag.clipping) {
      if (
        drag.clipMoving &&
        drag.clipPointIndex !== null &&
        drag.lastClipPoint
      ) {
        this.interaction.moveClipPoint(
          drag.clipPointIndex,
          drag.lastClipPoint,
          this.kind,
          this.viewDirection(),
          drag.lastAxisRestriction,
          "commit",
        );
      } else if (drag.clipPointIndex === null && drag.clipPoint) {
        const end = this.clipPointAt(event.clientX, event.clientY);
        const points =
          drag.moved >= 5 && end ? [drag.clipPoint, end] : [drag.clipPoint];
        this.interaction.addClipPoints(points, this.kind, this.viewDirection());
      }
    } else if (drag.button === 0 && drag.hullBuilding) {
      if (this.kind === "perspective") {
        if (drag.hullMoving && drag.lastHullPoints.length > 0) {
          this.interaction.addHullPoints(drag.lastHullPoints, "perspective");
        } else if (drag.moved < 5 && drag.hullPoint) {
          this.interaction.addHullPoints([drag.hullPoint], "perspective");
        } else {
          this.interaction.clearHullPreview();
        }
      }
    } else if (
      drag.button === 0 &&
      drag.faceTransferMode &&
      drag.faceTransferSource
    ) {
      if (drag.faceTransferTargets.length > 0) {
        const transfer = () =>
          this.interaction.transfer({
            phase: "commit",
            viewport: this.kind,
            mode: drag.faceTransferMode!,
            source: drag.faceTransferSource!,
            targets: drag.faceTransferTargets,
          });
        if (drag.faceTransferMoving || drag.moved >= 5) {
          transfer();
        } else {
          if (this.pendingFaceTransferClick !== null) {
            window.clearTimeout(this.pendingFaceTransferClick);
          }
          this.pendingFaceTransferClick = window.setTimeout(() => {
            this.pendingFaceTransferClick = null;
            transfer();
          }, 220);
        }
      }
    } else if (drag.button === 0 && drag.facePainting) {
      // The shared interaction cleanup below clears the paint affordance.
    } else if (drag.button === 0 && drag.sweepMoving && drag.lastSweep) {
      this.interaction.sweep({
        ...drag.lastSweep,
        phase: "commit",
      } as EditorSweepDragEvent);
    } else if (drag.button === 0 && drag.pivotMoving && drag.lastPivot) {
      this.interaction.moveTransformPivot({
        ...drag.lastPivot,
        phase: "commit",
      });
    } else if (
      drag.button === 0 &&
      drag.transformMoving &&
      drag.lastTransform
    ) {
      this.interaction.transform({
        ...drag.lastTransform,
        phase: "commit",
      } as EditorTransformDragEvent);
    } else if (drag.button === 0 && drag.faceLasso) {
      this.interaction.selectFaceLasso(
        this.faceHandlesInRectangle(
          drag.startX,
          drag.startY,
          event.clientX,
          event.clientY,
        ),
        drag.faceLassoEnsureSelected || event.shiftKey,
        this.kind,
      );
    } else if (drag.button === 0 && drag.topologyLasso && drag.topologyKind) {
      this.interaction.selectTopologyLasso(
        this.topologyHandlesInRectangle(
          drag.topologyKind,
          drag.startX,
          drag.startY,
          event.clientX,
          event.clientY,
        ),
        drag.topologyLassoAdditive || event.ctrlKey || event.metaKey,
      );
    } else if (
      drag.button === 0 &&
      drag.moved < 5 &&
      drag.topologyKind === "vertex" &&
      drag.topologySnapTarget &&
      drag.topologySelection &&
      drag.topologyHandles.length > 0
    ) {
      const target = drag.topologySnapTarget.center;
      const anchor = drag.topologyHandles.reduce((closest, handle) => {
        const distance = Math.hypot(
          handle.center[0] - target[0],
          handle.center[1] - target[1],
          handle.center[2] - target[2],
        );
        const closestDistance = Math.hypot(
          closest.center[0] - target[0],
          closest.center[1] - target[1],
          closest.center[2] - target[2],
        );
        return distance < closestDistance ? handle : closest;
      });
      const delta: Vec3 = [
        target[0] - anchor.center[0],
        target[1] - anchor.center[1],
        target[2] - anchor.center[2],
      ];
      this.interaction.topology(
        {
          phase: "commit",
          viewport: this.kind,
          kind: "vertex",
          operation: "snap",
          selection: drag.topologySelection,
          brushIds: topologyHandleBrushIds(drag.topologyHandles),
          vertices: topologyHandleVertices(drag.topologyHandles),
          delta,
          anchor: anchor.center,
          target,
          snapMode: "absolute",
          movementPlane: "viewport",
          axisRestriction: null,
        },
        drag.topologyHandles,
      );
    } else if (
      drag.button === 0 &&
      drag.topologyMoving &&
      drag.topologyKind &&
      drag.topologySelection
    ) {
      this.interaction.topology(
        {
          phase: drag.lastDelta.some(
            (component) => Math.abs(component) > Number.EPSILON,
          )
            ? "commit"
            : "cancel",
          viewport: this.kind,
          kind: drag.topologyKind,
          operation: drag.topologyOperation,
          selection: drag.topologySelection,
          brushIds: topologyHandleBrushIds(drag.topologyHandles),
          vertices: topologyHandleVertices(drag.topologyHandles),
          delta: drag.lastDelta,
          snapMode: drag.lastTopologySnapMode,
          movementPlane: drag.lastMovementPlane,
          axisRestriction: drag.lastAxisRestriction,
        },
        drag.topologyHandles,
      );
    } else if (
      drag.button === 0 &&
      drag.faceMoving &&
      drag.faceTranslating &&
      drag.faceSelection
    ) {
      this.interaction.face({
        phase: drag.lastDelta.some(
          (component) => Math.abs(component) > Number.EPSILON,
        )
          ? "commit"
          : "cancel",
        viewport: this.kind,
        selection: drag.faceSelection,
        mode: "translate",
        delta: drag.lastDelta,
        split: false,
        stamp: false,
      });
    } else if (drag.button === 0 && drag.faceMoving && drag.faceSelection) {
      this.interaction.face({
        phase:
          Math.abs(drag.lastFaceDistance) > Number.EPSILON
            ? "commit"
            : "cancel",
        viewport: this.kind,
        selection: drag.faceSelection,
        mode: "normal",
        distance: drag.lastFaceDistance,
        split: drag.faceSplitting,
        stamp: drag.faceStamping,
      });
    } else if (drag.button === 0 && drag.creating && drag.lastBounds) {
      this.interaction.create({
        phase: "commit",
        viewport: this.kind,
        bounds: drag.lastBounds,
        constraint: drag.lastCreationConstraint,
      });
    } else if (drag.button === 0 && drag.placingEntity && drag.moved < 5) {
      const origin = this.pointEntityOriginAt(event.clientX, event.clientY);
      if (origin)
        this.interaction.placePointEntity({ viewport: this.kind, origin });
    } else if (drag.button === 0 && drag.moving && drag.moveSelection) {
      this.interaction.drag(
        {
          phase: "commit",
          viewport: this.kind,
          selection: drag.moveSelection,
          delta: drag.lastDelta,
          movementPlane: drag.lastMovementPlane,
          axisRestriction: drag.lastAxisRestriction,
          duplicate: drag.duplicating,
        },
        drag.planePoint ? [drag.planePoint] : [],
      );
    } else if (
      drag.button === 0 &&
      drag.moved < 5 &&
      this.interaction.currentTool() !== "sweep" &&
      !drag.placingEntity &&
      !drag.transform &&
      !drag.topologyHandle &&
      !drag.topologyKind
    ) {
      const currentSelection = this.interaction.currentSelection();
      this.interaction.pick(drag.hit, this.kind, {
        additive: Boolean(event.shiftKey && currentSelection?.faceId),
        objectAdditive: Boolean(
          drag.hit &&
          !drag.hit.faceId &&
          !currentSelection?.faceId &&
          (event.ctrlKey || event.metaKey),
        ),
        expansion: "single",
      });
    } else if (
      drag.button === 0 &&
      drag.moved < 5 &&
      drag.topologyKind &&
      !drag.topologyHandle
    ) {
      this.interaction.selectTopology(null, event.ctrlKey || event.metaKey);
    }
    if (drag.cameraMode && drag.moved >= 5) {
      const pointerPosition = this.pointerPositionAt(
        event.clientX,
        event.clientY,
      );
      if (pointerPosition) this.interaction.pointerPosition(pointerPosition);
    }
    delete this.canvas.dataset.faceMagnet;
    this.removeHandleLasso();
    this.clearInteractionState();
    if (!drag.pivotMoving) this.hideTransformReadout();
  }

  protected cancelDrag(): void {
    const drag = this.dragState;
    if (!drag) return;
    this.dragState = null;
    if (drag.clipMoving && drag.clipPointIndex !== null && drag.clipPoint) {
      this.interaction.moveClipPoint(
        drag.clipPointIndex,
        drag.clipPoint,
        this.kind,
        this.viewDirection(),
        null,
        "cancel",
      );
    } else if (drag.hullMoving) {
      this.interaction.clearHullPreview();
    } else if (
      drag.faceTransferMoving &&
      drag.faceTransferMode &&
      drag.faceTransferSource
    ) {
      this.interaction.transfer({
        phase: "cancel",
        viewport: this.kind,
        mode: drag.faceTransferMode,
        source: drag.faceTransferSource,
        targets: drag.faceTransferTargets,
      });
    } else if (drag.sweepMoving && drag.lastSweep) {
      this.interaction.sweep({
        ...drag.lastSweep,
        phase: "cancel",
      } as EditorSweepDragEvent);
    } else if (drag.pivotMoving && drag.lastPivot) {
      this.interaction.moveTransformPivot({
        ...drag.lastPivot,
        phase: "cancel",
        pivot: drag.lastPivot.startPivot,
        delta: [0, 0, 0],
        axisRestriction: null,
      });
    } else if (drag.transformMoving && drag.lastTransform) {
      this.interaction.transform({
        ...drag.lastTransform,
        phase: "cancel",
      } as EditorTransformDragEvent);
    } else if (
      drag.topologyMoving &&
      drag.topologyKind &&
      drag.topologySelection
    ) {
      this.interaction.topology(
        {
          phase: "cancel",
          viewport: this.kind,
          kind: drag.topologyKind,
          operation: drag.topologyOperation,
          selection: drag.topologySelection,
          brushIds: topologyHandleBrushIds(drag.topologyHandles),
          vertices: topologyHandleVertices(drag.topologyHandles),
          delta: drag.lastDelta,
          snapMode: drag.lastTopologySnapMode,
          movementPlane: drag.lastMovementPlane,
          axisRestriction: drag.lastAxisRestriction,
        },
        drag.topologyHandles,
      );
    } else if (drag.creating && drag.lastBounds) {
      this.interaction.create({
        phase: "cancel",
        viewport: this.kind,
        bounds: null,
        constraint: drag.lastCreationConstraint,
      });
    } else if (drag.faceMoving && drag.faceSelection) {
      this.interaction.face(
        drag.faceTranslating
          ? {
              phase: "cancel",
              viewport: this.kind,
              selection: drag.faceSelection,
              mode: "translate",
              delta: drag.lastDelta,
              split: false,
              stamp: false,
            }
          : {
              phase: "cancel",
              viewport: this.kind,
              selection: drag.faceSelection,
              mode: "normal",
              distance: drag.lastFaceDistance,
              split: drag.faceSplitting,
              stamp: drag.faceStamping,
            },
      );
    } else if (drag.moving && drag.moveSelection) {
      this.interaction.drag(
        {
          phase: "cancel",
          viewport: this.kind,
          selection: drag.moveSelection,
          delta: drag.lastDelta,
          movementPlane: drag.lastMovementPlane,
          axisRestriction: drag.lastAxisRestriction,
          duplicate: drag.duplicating,
        },
        drag.planePoint ? [drag.planePoint] : [],
      );
    }
    if (this.canvas.hasPointerCapture(drag.pointerId)) {
      this.canvas.releasePointerCapture(drag.pointerId);
    }
    this.clearInteractionState();
    this.hideTransformReadout();
    delete this.canvas.dataset.faceMagnet;
    this.removeHandleLasso();
  }
}
