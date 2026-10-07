import { describe, expect, it } from "vitest";
import type { MapCompileResult } from "@tea/maps-editor/core";
import type { EditorDiagnosticOverlay } from "@tea/maps-editor/render";
import { createBuildOverlays } from "../editor-build-overlays.ts";

function artifact(kind: "leak-path" | "portal", text: string) {
  return {
    name: kind === "leak-path" ? "test.pts" : "test.prt",
    mediaType: "text/plain",
    kind,
    data: new TextEncoder().encode(text).buffer as ArrayBuffer,
  };
}

function result(artifacts: MapCompileResult["artifacts"]): MapCompileResult {
  return {
    backend: "remote",
    status: "failed",
    buildId: "build-1",
    sourceDocumentRevision: 1,
    diagnostics: [],
    artifacts,
    logs: [],
    elapsedMilliseconds: 10,
  };
}

describe("build diagnostic overlays", () => {
  it("shows a leak immediately and portals only when requested", () => {
    let rendered: readonly EditorDiagnosticOverlay[] = [];
    let state: Record<string, boolean> = {};
    const overlays = createBuildOverlays({
      renderer: () => ({
        setDiagnosticOverlays(value) {
          rendered = value;
        },
      }),
      update(value) {
        state = value;
      },
    });

    overlays.inspect(
      result([
        artifact("leak-path", "1 2 3\n4 5 6"),
        artifact("portal", "PRT1\n1\n3 (0 0 0) (1 0 0) (0 1 0)"),
      ]),
    );
    expect(rendered.map(({ kind }) => kind)).toEqual(["leak-path"]);
    expect(state).toMatchObject({
      leakDisabled: false,
      leakActive: true,
      portalDisabled: false,
      portalActive: false,
    });

    overlays.togglePortals();
    expect(rendered.map(({ kind }) => kind)).toEqual(["leak-path", "portal"]);
    overlays.toggleLeak();
    expect(rendered.map(({ kind }) => kind)).toEqual(["portal"]);
    overlays.clear();
    expect(rendered).toEqual([]);
    expect(state).toMatchObject({ leakDisabled: true, portalDisabled: true });
  });

  it("ignores malformed diagnostic artifacts", () => {
    let rendered: readonly EditorDiagnosticOverlay[] = [];
    let state: Record<string, boolean> = {};
    const overlays = createBuildOverlays({
      renderer: () => ({
        setDiagnosticOverlays(value) {
          rendered = value;
        },
      }),
      update(value) {
        state = value;
      },
    });
    overlays.inspect(result([artifact("leak-path", "invalid point")]));
    overlays.toggleLeak();
    expect(rendered).toEqual([]);
    expect(state).toMatchObject({ leakDisabled: true, leakActive: false });
  });
});
