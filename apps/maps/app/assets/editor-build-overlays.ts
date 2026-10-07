import {
  parseLeakPath,
  parsePortalFile,
  type MapCompileResult,
} from "@tea/maps-editor/core";
import type {
  EditorDiagnosticOverlay,
  EditorSourceRenderer,
} from "@tea/maps-editor/render";
import type { EditorBuildControlState } from "./editor-build-controls-bridge.ts";

type OverlayState = Pick<
  EditorBuildControlState,
  "leakDisabled" | "leakActive" | "portalDisabled" | "portalActive"
>;

export function createBuildOverlays(options: {
  readonly renderer: () => Pick<
    EditorSourceRenderer,
    "setDiagnosticOverlays"
  > | null;
  readonly update: (state: OverlayState) => void;
}) {
  let overlays: readonly EditorDiagnosticOverlay[] = [];
  let leakVisible = false;
  let portalsVisible = false;

  function apply() {
    options
      .renderer()
      ?.setDiagnosticOverlays(
        overlays.filter(
          (overlay) =>
            (overlay.kind === "leak-path" && leakVisible) ||
            (overlay.kind === "portal" && portalsVisible),
        ),
      );
    options.update({
      leakDisabled: !overlays.some((overlay) => overlay.kind === "leak-path"),
      leakActive: leakVisible,
      portalDisabled: !overlays.some((overlay) => overlay.kind === "portal"),
      portalActive: portalsVisible,
    });
  }

  return {
    apply,
    clear() {
      overlays = [];
      leakVisible = false;
      portalsVisible = false;
      apply();
    },
    inspect(result: MapCompileResult) {
      const decoder = new TextDecoder();
      const leak = result.artifacts.find(
        (artifact) => artifact.kind === "leak-path",
      );
      const portal = result.artifacts.find(
        (artifact) => artifact.kind === "portal",
      );
      const leakPoints = leak
        ? parseLeakPath(decoder.decode(leak.data)).points
        : [];
      const portalPolygons = portal
        ? parsePortalFile(decoder.decode(portal.data)).polygons
        : [];
      overlays = [
        ...(leakPoints.length > 1
          ? [
              {
                id: `${result.buildId}:leak`,
                kind: "leak-path" as const,
                points: leakPoints,
              },
            ]
          : []),
        ...portalPolygons.map((points, index) => ({
          id: `${result.buildId}:portal:${index}`,
          kind: "portal" as const,
          points,
        })),
      ];
      leakVisible = leakPoints.length > 1;
      portalsVisible = false;
      apply();
    },
    toggleLeak() {
      if (!overlays.some((overlay) => overlay.kind === "leak-path")) return;
      leakVisible = !leakVisible;
      apply();
    },
    togglePortals() {
      if (!overlays.some((overlay) => overlay.kind === "portal")) return;
      portalsVisible = !portalsVisible;
      apply();
    },
  };
}
