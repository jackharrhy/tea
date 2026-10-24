import {
  isFaceSelected,
  type BrushId,
  type EditorSelection,
  type EntityId,
  type FaceAttributeTransferMode,
  type Vec3,
} from "../core/index.js";
import type { EditorFaceDragEvent } from "./types.js";
import {
  constructionPlane,
  normalize,
  pointsFormPolygonOnPlane,
  rayPlaneIntersection,
} from "./viewport-geometry.js";

import {
  isBrushRayHit,
  preferredResizeFace,
  selectionForHit,
  selectionContainsHit,
  type PointerDrag,
} from "./viewport-common.js";
import { ViewportTools } from "./viewport-tools.js";
export abstract class ViewportPointerDown extends ViewportTools {
  protected connectPointerDown(): void {
    this.canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (this.dragState) this.cancelDrag();
        this.canvas.focus({ preventScroll: true });
        this.canvas.setPointerCapture(event.pointerId);
        const pointerPosition = this.pointerPositionAt(
          event.clientX,
          event.clientY,
        );
        if (pointerPosition) this.interaction.pointerPosition(pointerPosition);
        const ray = this.rayAt(event.clientX, event.clientY);
        const cameraMode: PointerDrag["cameraMode"] =
          event.button === 1
            ? "pan"
            : event.button === 2
              ? this.kind === "perspective"
                ? event.altKey
                  ? "orbit"
                  : "look"
                : "pan"
              : null;
        const cameraEye =
          this.kind === "perspective" ? this.perspectiveEye() : null;
        let cameraOrbit: PointerDrag["cameraOrbit"] = null;
        if (cameraMode === "orbit" && cameraEye) {
          const orbitPoint = this.interaction.hitTest(
            ray.origin,
            ray.direction,
          )?.point;
          if (orbitPoint) {
            const direction: Vec3 = [
              orbitPoint[0] - cameraEye[0],
              orbitPoint[1] - cameraEye[1],
              orbitPoint[2] - cameraEye[2],
            ];
            const distance = Math.hypot(...direction);
            if (distance > 1) {
              const forward = normalize(direction);
              cameraOrbit = {
                center: [...orbitPoint] as Vec3,
                distance,
                yaw: Math.atan2(forward[1], forward[0]),
                pitch: Math.asin(Math.max(-1, Math.min(1, forward[2]))),
              };
            }
          }
        }
        const tool = this.interaction.currentTool();
        const currentSelection = this.interaction.currentSelection();
        const defaultCreating =
          event.button === 0 &&
          tool === "select" &&
          !currentSelection &&
          !event.ctrlKey &&
          !event.metaKey;
        const creating =
          (event.button === 0 && tool === "create") || defaultCreating;
        const placingEntity = event.button === 0 && tool === "entity";
        const hullBuilding = event.button === 0 && tool === "hull";
        const sweep =
          event.button === 0 && tool === "sweep" && this.kind === "perspective"
            ? this.sweepGestureAt(event.clientX, event.clientY)
            : null;
        const clipping = event.button === 0 && tool === "clip";
        const clipPointIndex = clipping
          ? this.clipPointIndexAt(event.clientX, event.clientY)
          : null;
        const topologyKind = tool === "vertex" || tool === "edge" ? tool : null;
        const existingTopologyHandle =
          event.button === 0 && topologyKind
            ? this.topologyHandleAt(topologyKind, event.clientX, event.clientY)
            : null;
        const insertionTopologyHandle =
          event.button === 0 &&
          topologyKind === "vertex" &&
          event.shiftKey &&
          !existingTopologyHandle
            ? this.prospectiveVertexHandleAt(event.clientX, event.clientY)
            : null;
        const selectedTopologyHandles =
          this.interaction.selectedTopologyHandles();
        const topologySnapTarget =
          event.button === 0 &&
          topologyKind === "vertex" &&
          event.shiftKey &&
          event.altKey &&
          existingTopologyHandle &&
          selectedTopologyHandles.length > 0 &&
          !selectedTopologyHandles.some(
            (handle) => handle.key === existingTopologyHandle.key,
          )
            ? existingTopologyHandle
            : null;
        const hitTopologyHandle =
          existingTopologyHandle ?? insertionTopologyHandle;
        const topologyHandles =
          event.button === 0 && topologyKind
            ? topologySnapTarget
              ? selectedTopologyHandles
              : insertionTopologyHandle
                ? [insertionTopologyHandle]
                : existingTopologyHandle
                  ? this.interaction.selectTopology(
                      existingTopologyHandle,
                      event.ctrlKey || event.metaKey,
                    )
                  : this.interaction.selectedTopologyHandles()
            : [];
        const topologyHandle =
          topologySnapTarget ??
          (hitTopologyHandle &&
          topologyHandles.some((handle) => handle.key === hitTopologyHandle.key)
            ? hitTopologyHandle
            : null);
        const facePainting =
          event.button === 0 &&
          tool === "face" &&
          !event.altKey &&
          event.shiftKey &&
          (event.ctrlKey || event.metaKey);
        const hitFaceHandle =
          event.button === 0 && tool === "face" && !facePainting
            ? this.faceHandleAt(event.clientX, event.clientY)
            : null;
        const stampRequested = Boolean(
          hitFaceHandle &&
          event.altKey &&
          (event.ctrlKey || event.metaKey) &&
          this.kind === "perspective",
        );
        const creationSurfaceHit =
          creating && this.kind === "perspective"
            ? this.interaction
                .hitTests(ray.origin, ray.direction)
                .find(isBrushRayHit)
            : null;
        const needsBrushHit =
          tool !== "select" ||
          event.shiftKey ||
          Boolean(
            this.kind === "perspective" &&
            event.altKey &&
            currentSelection?.faceId,
          );
        const hit =
          event.button === 0 &&
          (!creating || defaultCreating) &&
          !placingEntity &&
          !topologyHandle &&
          !sweep
            ? needsBrushHit
              ? (this.interaction
                  .hitTests(ray.origin, ray.direction)
                  .find(isBrushRayHit) ?? null)
              : this.selectionHitAt(event.clientX, event.clientY)
            : null;
        const creationReferenceBounds =
          creating && currentSelection
            ? this.interaction.brushBounds(currentSelection)
            : null;
        const supportsFaceTransfer =
          event.button === 0 &&
          this.kind === "perspective" &&
          event.altKey &&
          !stampRequested &&
          (tool === "select" || tool === "face");
        if (!supportsFaceTransfer) {
          if (this.faceTransferSequenceReset !== null) {
            window.clearTimeout(this.faceTransferSequenceReset);
            this.faceTransferSequenceReset = null;
          }
          this.faceTransferSequenceSource = undefined;
        } else {
          if (this.faceTransferSequenceReset === null) {
            this.faceTransferSequenceSource = currentSelection?.faceId
              ? {
                  brushId: currentSelection.brushId,
                  faceId: currentSelection.faceId,
                }
              : null;
          } else {
            window.clearTimeout(this.faceTransferSequenceReset);
          }
          this.faceTransferSequenceReset = window.setTimeout(() => {
            this.faceTransferSequenceReset = null;
            this.faceTransferSequenceSource = undefined;
          }, 350);
        }
        const visibleFaceSelection =
          hit && isBrushRayHit(hit)
            ? { brushId: hit.brushId, faceId: hit.faceId }
            : null;
        const proximateFaceSelection =
          event.shiftKey &&
          tool === "select" &&
          currentSelection &&
          !currentSelection.faceId
            ? (this.proximateSelectedFaceAt(event.clientX, event.clientY)
                ?.selection ?? null)
            : null;
        const selectedHit =
          event.shiftKey && tool === "select"
            ? this.interaction
                .hitTests(ray.origin, ray.direction)
                .find(
                  (candidate) =>
                    isBrushRayHit(candidate) &&
                    selectionContainsHit(currentSelection, candidate),
                )
            : hit;
        const selectedVisibleFaceSelection =
          selectedHit &&
          isBrushRayHit(selectedHit) &&
          selectionContainsHit(currentSelection, selectedHit)
            ? { brushId: selectedHit.brushId, faceId: selectedHit.faceId }
            : null;
        const togglingSelectedVisibleFace =
          event.shiftKey &&
          visibleFaceSelection &&
          isFaceSelected(
            currentSelection,
            visibleFaceSelection.brushId,
            visibleFaceSelection.faceId,
          );
        const rawFaceSelection: EditorFaceDragEvent["selection"] | null =
          togglingSelectedVisibleFace
            ? visibleFaceSelection
            : preferredResizeFace(
                hitFaceHandle?.selection ?? null,
                selectedVisibleFaceSelection,
                proximateFaceSelection,
                visibleFaceSelection,
              );
        if (event.shiftKey && tool === "select" && rawFaceSelection)
          this.interaction.hover(rawFaceSelection);
        const faceTransferMode: FaceAttributeTransferMode | null =
          supportsFaceTransfer && this.faceTransferSequenceSource
            ? event.ctrlKey || event.metaKey
              ? "material"
              : event.shiftKey
                ? "rotate"
                : "project"
            : null;
        const faceTransferSource =
          faceTransferMode && this.faceTransferSequenceSource
            ? this.faceTransferSequenceSource
            : null;
        const hitSelection: EditorSelection | null = rawFaceSelection
          ? tool === "clip" ||
            tool === "hull" ||
            tool === "sweep" ||
            faceTransferMode
            ? null
            : tool === "face" || event.shiftKey
              ? rawFaceSelection
              : { brushId: rawFaceSelection.brushId }
          : hit && tool === "select"
            ? selectionForHit(hit)
            : null;
        const permanentFaceSelection =
          event.button === 0 &&
          tool === "select" &&
          event.shiftKey &&
          rawFaceSelection &&
          currentSelection &&
          !currentSelection.faceId &&
          ((hit && selectionContainsHit(currentSelection, hit)) ||
            Boolean(proximateFaceSelection))
            ? rawFaceSelection
            : null;
        const moveSelection =
          tool === "select" &&
          !permanentFaceSelection &&
          hit &&
          hitSelection &&
          !currentSelection?.faceId &&
          selectionContainsHit(currentSelection, hit)
            ? currentSelection
            : null;
        const duplicating = Boolean(
          event.button === 0 &&
          moveSelection &&
          (event.ctrlKey || event.metaKey),
        );
        const objectPainting = Boolean(
          event.button === 0 &&
          tool === "select" &&
          hitSelection &&
          !hitSelection.faceId &&
          !moveSelection &&
          (event.ctrlKey || event.metaKey),
        );
        const transformTool =
          tool === "rotate" || tool === "scale" || tool === "shear"
            ? tool
            : null;
        const transformBounds =
          transformTool && currentSelection && !currentSelection.faceId
            ? this.interaction.brushBounds(currentSelection)
            : null;
        const transform =
          transformTool &&
          currentSelection &&
          !currentSelection.faceId &&
          (transformTool === "rotate" || currentSelection.brushId) &&
          transformBounds
            ? this.createTransformGesture(
                transformTool,
                currentSelection,
                transformBounds,
                event.clientX,
                event.clientY,
              )
            : null;
        const paintedFaceKeys = new Set<string>();
        if (facePainting && rawFaceSelection) {
          paintedFaceKeys.add(
            `${rawFaceSelection.brushId}\u0000${rawFaceSelection.faceId}`,
          );
          if (
            !isFaceSelected(
              currentSelection,
              rawFaceSelection.brushId,
              rawFaceSelection.faceId,
            )
          ) {
            this.interaction.pick(rawFaceSelection, this.kind, {
              additive: true,
              expansion: "single",
              paint: true,
            });
          }
        }
        const faceSelection =
          !facePainting && !faceTransferMode
            ? tool === "face"
              ? rawFaceSelection
              : permanentFaceSelection
            : null;
        const faceSplitting = Boolean(
          faceSelection && !event.altKey && (event.ctrlKey || event.metaKey),
        );
        const faceStamping = Boolean(
          faceSelection &&
          event.altKey &&
          (event.ctrlKey || event.metaKey) &&
          this.kind === "perspective",
        );
        const faceTranslating = Boolean(
          faceSelection && event.altKey && !faceStamping,
        );
        const faceLassoEligible =
          event.button === 0 &&
          tool === "face" &&
          !facePainting &&
          !rawFaceSelection;
        const faceHandle = faceSelection
          ? this.interaction.faceHandle(faceSelection)
          : null;
        const hullFace =
          hullBuilding && this.kind === "perspective" ? rawFaceSelection : null;
        const hullFaceHandle = hullFace
          ? this.interaction.faceHandle(hullFace)
          : null;
        const hullPoint =
          hullBuilding &&
          this.kind === "perspective" &&
          hit &&
          isBrushRayHit(hit)
            ? this.interaction.snapClipHit(hit, this.gridSize)
            : null;
        const hullDuplicating = Boolean(
          event.shiftKey &&
          hullFaceHandle &&
          pointsFormPolygonOnPlane(
            this.interaction.hullPoints(),
            hullFaceHandle.center,
            hullFaceHandle.normal,
          ),
        );
        const hullMapping =
          hullDuplicating && hullFaceHandle
            ? this.faceDragMapping(hullFaceHandle.center, hullFaceHandle.normal)
            : null;
        const faceMapping =
          faceHandle && !faceTranslating
            ? this.faceDragMapping(faceHandle.center, faceHandle.normal)
            : null;
        const clipPoint = clipping
          ? clipPointIndex === null
            ? this.clipPointAt(event.clientX, event.clientY)
            : (this.interaction.clipPoints()[clipPointIndex] ?? null)
          : null;
        if (
          faceSelection &&
          !event.shiftKey &&
          !isFaceSelected(
            currentSelection,
            faceSelection.brushId,
            faceSelection.faceId,
          )
        ) {
          this.interaction.pick(faceSelection, this.kind, {
            additive: false,
            expansion: "single",
          });
        }
        const creationCoordinate =
          this.kind === "perspective"
            ? Math.round(
                (creationSurfaceHit?.point[2] ??
                  creationReferenceBounds?.max[2] ??
                  0) / this.gridSize,
              ) * this.gridSize
            : 0;
        const createPlane = creating
          ? constructionPlane(this.kind, creationCoordinate)
          : null;
        const planePoint =
          createPlane?.point ??
          (sweep?.mode === "translate" ? sweep.pivot : null) ??
          (transform?.tool === "pivot" ? transform.pivot : null) ??
          hullFaceHandle?.center ??
          topologyHandle?.center ??
          (faceTranslating ? faceHandle?.center : null) ??
          (moveSelection ? this.interaction.brushCenter(moveSelection) : null);
        const planeNormal =
          createPlane?.normal ??
          hullFaceHandle?.normal ??
          (this.kind === "perspective" &&
          (topologyHandle ||
            moveSelection ||
            sweep?.mode === "translate" ||
            transform?.tool === "pivot") &&
          !faceTranslating
            ? ([0, 0, 1] as const)
            : this.viewDirection());
        this.dragState = {
          button: event.button,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          x: event.clientX,
          y: event.clientY,
          moved: 0,
          hit: transform || sweep ? null : hitSelection,
          moveSelection,
          duplicating,
          objectPainting,
          paintedBrushIds: new Set<BrushId>(),
          paintedEntityIds: new Set<EntityId>(),
          faceSelection,
          facePainting,
          faceSplitting,
          faceStamping,
          faceTranslating,
          faceLassoEligible,
          faceLassoEnsureSelected: event.shiftKey,
          paintedFaceKeys,
          faceScreenDirection:
            faceMapping?.direction ?? hullMapping?.direction ?? null,
          facePixelsPerWorld:
            faceMapping?.pixelsPerWorld ?? hullMapping?.pixelsPerWorld ?? 1,
          planePoint,
          planeNormal,
          creating,
          placingEntity,
          creationReferenceBounds,
          hullBuilding,
          hullPoint,
          hullFace,
          hullDuplicating,
          faceTransferMode,
          faceTransferSource,
          faceTransferTargets:
            faceTransferSource &&
            rawFaceSelection &&
            (faceTransferSource.brushId !== rawFaceSelection.brushId ||
              faceTransferSource.faceId !== rawFaceSelection.faceId)
              ? [rawFaceSelection]
              : [],
          clipping,
          clipPoint,
          clipPointIndex,
          transform,
          sweep,
          topologyKind,
          topologyHandle,
          topologyHandles,
          topologySnapTarget,
          topologySelection:
            topologyHandle &&
            currentSelection?.brushId &&
            !currentSelection.faceId
              ? currentSelection
              : null,
          topologyOperation: topologySnapTarget
            ? "snap"
            : insertionTopologyHandle
              ? "insert"
              : "move",
          topologyLassoAdditive:
            (event.ctrlKey || event.metaKey) && !insertionTopologyHandle,
          cameraMode,
          cameraEye,
          cameraOrbit,
          cameraOrbitInitialized: false,
          anchor: planePoint
            ? rayPlaneIntersection(
                ray.origin,
                ray.direction,
                planePoint,
                planeNormal,
              )
            : null,
          moving: false,
          faceMoving: false,
          faceLasso: false,
          transformMoving: false,
          pivotMoving: false,
          sweepMoving: false,
          topologyMoving: false,
          topologyLasso: false,
          clipMoving: false,
          hullMoving: false,
          faceTransferMoving: false,
          lastTopologySnapMode: "relative",
          lastMovementPlane: this.kind === "perspective" ? "xy" : "viewport",
          lastAxisRestriction: null,
          lastDelta: [0, 0, 0],
          lastFaceDistance: 0,
          faceSource: faceHandle,
          faceMagnet: null,
          faceAlignment: [],
          lastBounds: null,
          lastCreationConstraint: "none",
          lastClipPoint: null,
          lastHullPoints: [],
          lastTransform: null,
          lastPivot: null,
          lastSweep: null,
        };
      },
      { signal: this.inputSignal },
    );
  }
}
