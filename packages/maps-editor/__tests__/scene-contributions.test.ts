import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  EditorSession,
  brushesInDocument,
  createBoxBrush,
  createFaceSelection,
  createObjectSelection,
  createSequentialIdFactory,
  createStarterDocument,
  replaceBrush,
  translateBrush,
} from "../src/core/index.js";
import {
  buildSceneBuffers,
  disposeSceneBuffers,
  sceneContributionKeys,
} from "../src/render/scene-buffers.js";
import { sceneDependencyKeysEqual } from "../src/render/retained-scene-contribution.js";
import type { SceneBuildInput } from "../src/render/scene-types.js";
import { DEFAULT_EDITOR_RENDER_THEME } from "../src/render/theme.js";

beforeAll(() => {
  Object.assign(globalThis, { GPUBufferUsage: { VERTEX: 1, COPY_DST: 2 } });
});

function gpu() {
  const buffers: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  const device = {
    createBuffer: () => {
      const created = { destroy: vi.fn() };
      buffers.push(created);
      return created;
    },
    queue: { writeBuffer: vi.fn() },
  } as unknown as GPUDevice;
  return { device, buffers };
}

function input(overrides: Partial<SceneBuildInput> = {}): SceneBuildInput {
  const document = createStarterDocument();
  return {
    world: {
      document,
      objectViewState: {
        hiddenBrushIds: [],
        hiddenEntityIds: [],
        lockedBrushIds: [],
        lockedEntityIds: [],
      },
      sprites: [],
    },
    localPreview: { document: null, objectIds: [], selectionObjectIds: [] },
    selection: { current: null, hovered: null },
    tools: {
      active: "select",
      gridSize: 16,
      transformPivot: null,
      transformPivotHovered: false,
      transformPivotTrace: null,
      movementTraces: [],
      clipPoints: [],
      hullPoints: [],
      hullPreviewPoints: [],
      sweepCaps: [],
      topologySelection: [],
      topologyHover: null,
      entityLinkMode: "direct",
      openGroupId: null,
    },
    references: [],
    diagnostics: [],
    remotePresence: [],
    entityDefinitions: undefined,
    theme: DEFAULT_EDITOR_RENDER_THEME,
    ...overrides,
  };
}

function changedKeys(
  before: SceneBuildInput,
  after: SceneBuildInput,
): readonly string[] {
  const previous = sceneContributionKeys(before);
  const next = sceneContributionKeys(after);
  return Object.keys(previous).filter(
    (name) =>
      !sceneDependencyKeysEqual(
        previous[name as keyof typeof previous],
        next[name as keyof typeof next],
      ),
  );
}

describe("retained scene contribution invalidation", () => {
  it("isolates local selection and remote preview dependencies from world geometry", () => {
    const initial = input();
    const brush = brushesInDocument(initial.world.document)[0]!;
    const selected = {
      ...initial,
      selection: {
        ...initial.selection,
        current: createObjectSelection([brush.id], []),
      },
    };
    expect(changedKeys(initial, selected)).toEqual([
      "localSelection",
      "toolPreviews",
      "faceGrid",
    ]);

    const remote = {
      ...initial,
      remotePresence: [
        {
          actorId: "remote",
          color: [0.2, 0.4, 0.8] as const,
          document: initial.world.document,
          selectedObjectIds: [],
          previewObjectIds: [],
        },
      ],
    };
    expect(changedKeys(initial, remote)).toEqual(["remotePresence"]);
    const diagnostics = {
      ...initial,
      diagnostics: [{ id: "portal", kind: "portal" as const, points: [] }],
    };
    expect(changedKeys(initial, diagnostics)).toEqual(["diagnostics"]);

    const equivalentViewState = {
      ...initial,
      world: {
        ...initial.world,
        objectViewState: {
          hiddenBrushIds: [...initial.world.objectViewState.hiddenBrushIds],
          hiddenEntityIds: [...initial.world.objectViewState.hiddenEntityIds],
          lockedBrushIds: [...initial.world.objectViewState.lockedBrushIds],
          lockedEntityIds: [...initial.world.objectViewState.lockedEntityIds],
        },
      },
    };
    expect(changedKeys(initial, equivalentViewState)).toEqual([]);

    const drag = {
      ...initial,
      tools: {
        ...initial.tools,
        movementTraces: [
          {
            start: [0, 0, 0] as const,
            end: [16, 0, 0] as const,
            axisRestriction: 0 as const,
          },
        ],
      },
    };
    expect(changedKeys(initial, drag)).toEqual(["toolPreviews"]);

    const replacementDocument = input().world.document;
    expect(
      changedKeys(initial, {
        ...initial,
        world: { ...initial.world, document: replacementDocument },
      }),
    ).toEqual([
      "worldSolids",
      "objectLines",
      "localSelection",
      "toolPreviews",
      "faceGrid",
    ]);
  });

  it("retains world GPU owners across selection-only rebuilds", () => {
    const { device } = gpu();
    const initialInput = input();
    const initial = buildSceneBuffers(device, initialInput);
    const brush = brushesInDocument(initialInput.world.document)[0]!;
    const selection = createObjectSelection([brush.id], []);
    const changed = buildSceneBuffers(
      device,
      { ...initialInput, selection: { current: selection, hovered: null } },
      initial.scene,
    );

    expect([...changed.rebuilt]).toEqual([
      "localSelection",
      "toolPreviews",
      "faceGrid",
    ]);
    expect(changed.scene.worldSolids).toBe(initial.scene.worldSolids);
    expect(changed.scene.objectLines).toBe(initial.scene.objectLines);
    expect(changed.scene.references).toBe(initial.scene.references);
    disposeSceneBuffers(changed.scene);
  });

  it("rebuilds remote, reference, and face-grid resources independently", () => {
    const { device } = gpu();
    const initialInput = input();
    const initial = buildSceneBuffers(device, initialInput);
    const brush = brushesInDocument(initialInput.world.document)[0]!;
    const remoteInput: SceneBuildInput = {
      ...initialInput,
      remotePresence: [
        {
          actorId: "remote",
          color: [0.2, 0.4, 0.8],
          document: initialInput.world.document,
          selectedObjectIds: [brush.id],
          previewObjectIds: [],
        },
      ],
    };
    const remote = buildSceneBuffers(device, remoteInput, initial.scene);
    expect([...remote.rebuilt]).toEqual(["remotePresence"]);
    expect(remote.scene.remotePresence.value.lineCount).toBeGreaterThan(0);
    expect(remote.scene.remotePresence.value.solids.length).toBeGreaterThan(0);

    const referenceInput: SceneBuildInput = {
      ...remoteInput,
      references: [
        {
          id: "reference",
          label: "Reference",
          document: initialInput.world.document,
          offset: [256, 0, 0],
          visible: true,
        },
      ],
    };
    const reference = buildSceneBuffers(device, referenceInput, remote.scene);
    expect([...reference.rebuilt]).toEqual(["references"]);
    expect(reference.scene.references.value.solids.length).toBeGreaterThan(0);
    expect(reference.scene.references.value.batches.length).toBeGreaterThan(0);

    const face = brush.faces[0]!;
    const faceGrid = buildSceneBuffers(
      device,
      {
        ...referenceInput,
        selection: {
          current: createFaceSelection([
            { brushId: brush.id, faceId: face.id },
          ]),
          hovered: null,
        },
      },
      reference.scene,
    );
    expect(faceGrid.scene.faceGrid.value.count).toBeGreaterThan(0);
    expect(faceGrid.scene.localSelection.value.solids.length).toBeGreaterThan(
      0,
    );
    expect(faceGrid.scene.toolPreviews.value.lines.count).toBeGreaterThan(0);
    disposeSceneBuffers(faceGrid.scene);
  });

  it("uploads replacement solid colors when the render theme changes", () => {
    const { device } = gpu();
    const initialInput = input();
    const initial = buildSceneBuffers(device, initialInput);
    const initialSolid = initial.scene.worldSolids.value.solids[0]?.buffer;
    expect(initialSolid).toBeDefined();

    const themed = buildSceneBuffers(
      device,
      {
        ...initialInput,
        theme: { ...initialInput.theme, material: [0.15, 0.25, 0.35] },
      },
      initial.scene,
    );

    expect(themed.rebuilt).toContain("worldSolids");
    expect(themed.scene.worldSolids.value.solids[0]?.buffer).not.toBe(
      initialSolid,
    );
    disposeSceneBuffers(themed.scene);
  });

  it("keeps the committed world retained between local drag preview frames", () => {
    const { device } = gpu();
    const base = input();
    const brush = brushesInDocument(base.world.document)[0]!;
    const selection = createObjectSelection([brush.id], []);
    const selectedInput: SceneBuildInput = {
      ...base,
      selection: { current: selection, hovered: null },
    };
    const initial = buildSceneBuffers(device, selectedInput);
    const previewIds = [brush.id];
    const firstPreviewDocument = replaceBrush(
      base.world.document,
      translateBrush(brush, [16, 0, 0]),
    );
    const firstPreview = buildSceneBuffers(
      device,
      {
        ...selectedInput,
        localPreview: {
          document: firstPreviewDocument,
          objectIds: previewIds,
          selectionObjectIds: previewIds,
        },
      },
      initial.scene,
    );
    expect(firstPreview.scene.worldSolids.value.solids.length).toBeLessThan(
      initial.scene.worldSolids.value.solids.length,
    );
    expect(
      firstPreview.scene.worldSolids.value.solids
        .flatMap((batch) => batch.sources)
        .some((source) => source.key.includes(brush.id)),
    ).toBe(false);
    expect(firstPreview.scene.localPreview.value.solids.length).toBeGreaterThan(
      0,
    );
    expect(
      firstPreview.scene.localPreview.value.selection.solids.length,
    ).toBeGreaterThan(0);

    const secondPreviewDocument = replaceBrush(
      base.world.document,
      translateBrush(brush, [32, 0, 0]),
    );
    const secondPreview = buildSceneBuffers(
      device,
      {
        ...selectedInput,
        localPreview: {
          document: secondPreviewDocument,
          objectIds: [...previewIds],
          selectionObjectIds: [...previewIds],
        },
      },
      firstPreview.scene,
    );
    expect([...secondPreview.rebuilt]).toEqual([
      "localPreview",
      "toolPreviews",
      "faceGrid",
    ]);
    expect(secondPreview.scene.worldSolids).toBe(
      firstPreview.scene.worldSolids,
    );
    expect(secondPreview.scene.objectLines).toBe(
      firstPreview.scene.objectLines,
    );
    expect(secondPreview.scene.localSelection).toBe(
      firstPreview.scene.localSelection,
    );
    disposeSceneBuffers(secondPreview.scene);
  });

  it("keeps the canonical world intact for new-only preview geometry", () => {
    const { device } = gpu();
    const base = input();
    const sourceBrush = brushesInDocument(base.world.document)[0]!;
    const session = new EditorSession(base.world.document);
    const candidate = session.createBrushesCandidate(
      [
        createBoxBrush(
          [256, 256, 0],
          [288, 288, 32],
          "PREVIEW",
          createSequentialIdFactory("new-only-preview"),
        ),
      ],
      "Preview brush",
    );
    const initial = buildSceneBuffers(device, base);
    const preview = buildSceneBuffers(
      device,
      {
        ...base,
        localPreview: {
          document: candidate.document,
          objectIds: candidate.selectionAfter,
          selectionObjectIds: [sourceBrush.id, ...candidate.selectionAfter],
        },
      },
      initial.scene,
    );

    expect(preview.scene.worldSolids).toBe(initial.scene.worldSolids);
    expect(preview.scene.objectLines).toBe(initial.scene.objectLines);
    expect(preview.scene.localPreview.value.solids).toHaveLength(1);
    expect(preview.scene.localPreview.value.selection.solids).toHaveLength(2);
    disposeSceneBuffers(preview.scene);
  });
});
