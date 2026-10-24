import {
  findBrush,
  selectedPointEntityIds,
  type MapBrush,
} from "../core/index.js";
import { retainSceneContribution } from "./retained-scene-contribution.js";
import { buildRemotePresenceBuffer } from "./remote-presence-buffers.js";
import {
  buildDiagnosticBuffer,
  buildFaceGridBuffer,
  buildToolPreviewBuffers,
  selectedBrushIdsForScene,
} from "./scene-interaction-contributions.js";
import { buildSelectionOverlayBuffers } from "./selection-overlay-buffers.js";
import type {
  LineBuffer,
  LocalPreviewBuffers,
  ObjectLineBuffers,
  ReferenceBuffers,
  RetainedSceneContribution,
  SceneBuffers,
  SceneBuildInput,
  SceneBuildResult,
  SceneContributionName,
  SceneDependencyKeys,
  SelectionBuffers,
  SolidBuffers,
  ToolPreviewBuffers,
} from "./scene-types.js";
import {
  buildObjectLineBuffers,
  buildWorldGeometryBuffers,
  buildWorldSolidBuffers,
  mainDocumentSource,
  referenceDocumentSources,
} from "./scene-world-contributions.js";

export { objectSelectionBounds } from "./scene-interaction-contributions.js";
export {
  boundsCenter,
  scaleHandles,
  scalePivot,
  snappedScaleFactor,
} from "./transform-handles.js";
export { sweepCapsBounds, sweepScaleHandle } from "./scene-tool-overlays.js";
export { scaleOverlayVertices } from "./transform-overlay.js";
export type {
  SceneBuffers,
  SceneBuildInput,
  SceneBuildResult,
} from "./scene-types.js";

function solidBuffers(value: SolidBuffers): readonly GPUBuffer[] {
  return value.solids.map(({ buffer }) => buffer);
}

function objectLineBuffers(value: ObjectLineBuffers): readonly GPUBuffer[] {
  return [value.unbatched.buffer, ...value.batches.map(({ buffer }) => buffer)];
}

function selectionBuffers(value: SelectionBuffers): readonly GPUBuffer[] {
  return [value.lines, ...value.solids.map(({ buffer }) => buffer)];
}

function toolPreviewBuffers(value: ToolPreviewBuffers): readonly GPUBuffer[] {
  return [
    value.lines.buffer,
    value.selectionGuide.buffer,
    value.resizeFace.buffer,
    value.hull.lines.buffer,
    value.hull.grid.buffer,
    value.hull.handles.buffer,
    value.hull.face.buffer,
  ];
}

function referenceBuffers(value: ReferenceBuffers): readonly GPUBuffer[] {
  return [...solidBuffers(value), ...objectLineBuffers(value)];
}

function localPreviewBuffers(value: LocalPreviewBuffers): readonly GPUBuffer[] {
  return [...referenceBuffers(value), ...selectionBuffers(value.selection)];
}

function lineBuffer(value: LineBuffer): readonly GPUBuffer[] {
  return [value.buffer];
}

function recordContributionMeasure(name: string, started: number): void {
  performance.measure(`maps.editor.scene-contribution.${name}`, {
    start: started,
    end: performance.now(),
  });
}

function timed<Value>(name: string, build: () => Value): Value {
  const started = performance.now();
  const value = build();
  recordContributionMeasure(name, started);
  return value;
}

function retainMeasured<Name extends SceneContributionName, Value>(
  name: Name,
  key: readonly unknown[],
  previous: RetainedSceneContribution<Name, Value> | undefined,
  build: (previousValue: Value | undefined) => Value,
  buffers: (value: Value) => readonly GPUBuffer[],
) {
  return retainSceneContribution({
    name,
    key,
    ...(previous ? { previous } : {}),
    build: (previousValue) => timed(name, () => build(previousValue)),
    buffers,
  });
}

function canonicalPreviewObjectIds(input: SceneBuildInput): readonly string[] {
  const entityIds = new Set<string>(
    input.world.document.entities.map((entity) => entity.id),
  );
  return input.localPreview.objectIds.filter(
    (objectId) =>
      findBrush(input.world.document, objectId as MapBrush["id"]) !== null ||
      entityIds.has(objectId),
  );
}

export function sceneContributionKeys(
  input: SceneBuildInput,
): SceneDependencyKeys {
  const activeDocument = input.localPreview.document ?? input.world.document;
  const objectViewStateKey = JSON.stringify([
    input.world.objectViewState.hiddenBrushIds,
    input.world.objectViewState.hiddenEntityIds,
    input.world.objectViewState.lockedBrushIds,
    input.world.objectViewState.lockedEntityIds,
  ]);
  const previewObjectIdsKey = JSON.stringify(input.localPreview.objectIds);
  const previewSelectionObjectIdsKey = JSON.stringify(
    input.localPreview.selectionObjectIds,
  );
  const canonicalPreviewObjectIdsKey = JSON.stringify(
    canonicalPreviewObjectIds(input),
  );
  return {
    worldSolids: [
      input.world.document,
      objectViewStateKey,
      input.world.sprites,
      input.entityDefinitions,
      input.theme,
      canonicalPreviewObjectIdsKey,
    ],
    objectLines: [
      input.world.document,
      objectViewStateKey,
      input.entityDefinitions,
      input.theme,
      canonicalPreviewObjectIdsKey,
    ],
    localPreview: [
      input.localPreview.document,
      previewObjectIdsKey,
      previewSelectionObjectIdsKey,
      input.world.sprites,
      input.entityDefinitions,
      input.theme,
    ],
    localSelection: [
      input.world.document,
      input.selection.current,
      input.entityDefinitions,
      input.theme,
    ],
    toolPreviews: [
      input.localPreview.faceOutlines,
      input.tools.gridSize,
      activeDocument,
      input.selection.current,
      input.selection.hovered,
      objectViewStateKey,
      input.tools.active,
      input.tools.transformPivot,
      input.tools.transformPivotHovered,
      input.tools.transformPivotTrace,
      input.tools.movementTraces,
      input.tools.clipPoints,
      input.tools.hullPoints,
      input.tools.hullPreviewPoints,
      input.tools.sweepCaps,
      input.tools.topologySelection,
      input.tools.topologyHover,
      input.tools.entityLinkMode,
      input.tools.openGroupId,
      input.entityDefinitions,
      input.theme,
    ],
    faceGrid: [
      activeDocument,
      input.selection.current,
      input.selection.hovered,
      input.tools.gridSize,
      input.theme,
    ],
    references: [
      input.references,
      input.world.sprites,
      input.entityDefinitions,
      input.theme,
    ],
    diagnostics: [input.diagnostics, input.theme],
    remotePresence: [input.remotePresence, input.entityDefinitions],
  };
}

/** Builds or structurally retains each independently invalidated GPU scene contribution. */
export function buildSceneBuffers(
  device: GPUDevice,
  input: SceneBuildInput,
  previous?: SceneBuffers,
): SceneBuildResult {
  const keys = sceneContributionKeys(input);
  const activeDocument = input.localPreview.document ?? input.world.document;
  const previewObjectIds = new Set(input.localPreview.objectIds);
  const excludedPreviewObjectIds = new Set(canonicalPreviewObjectIds(input));
  const documentSources = mainDocumentSource(input.world.document);
  const worldOptions = {
    sources: documentSources,
    objectViewState: input.world.objectViewState,
    entityDefinitions: input.entityDefinitions,
    sprites: input.world.sprites,
    theme: input.theme,
    includedObjectIds: null,
    excludedObjectIds: input.localPreview.document
      ? excludedPreviewObjectIds
      : new Set<string>(),
  };
  const rebuilt = new Set<SceneContributionName>();
  const worldSolidsResult = retainMeasured(
    "worldSolids",
    keys.worldSolids,
    previous?.worldSolids,
    (value: SolidBuffers | undefined) =>
      buildWorldSolidBuffers(device, worldOptions, value),
    solidBuffers,
  );
  const objectLinesResult = retainMeasured(
    "objectLines",
    keys.objectLines,
    previous?.objectLines,
    (value: ObjectLineBuffers | undefined) =>
      buildObjectLineBuffers(device, worldOptions, value),
    objectLineBuffers,
  );
  const localPreviewResult = retainMeasured(
    "localPreview",
    keys.localPreview,
    previous?.localPreview,
    (value: LocalPreviewBuffers | undefined) => {
      const geometry = buildWorldGeometryBuffers(
        device,
        {
          ...worldOptions,
          sources: input.localPreview.document
            ? mainDocumentSource(input.localPreview.document)
            : [],
          objectViewState: {
            hiddenBrushIds: [],
            hiddenEntityIds: [],
            lockedBrushIds: [],
            lockedEntityIds: [],
          },
          includedObjectIds: previewObjectIds,
          excludedObjectIds: new Set<string>(),
        },
        value,
      );
      return {
        ...geometry,
        active: input.localPreview.document !== null,
        selection: buildSelectionOverlayBuffers(
          device,
          input.localPreview.document
            ? [
                {
                  key: "local-preview",
                  color: input.theme.edgeSelected,
                  document: input.localPreview.document,
                  objectIds: input.localPreview.selectionObjectIds,
                },
              ]
            : [],
          input.entityDefinitions,
        ),
      };
    },
    localPreviewBuffers,
  );
  const localSelectionResult = retainMeasured(
    "localSelection",
    keys.localSelection,
    previous?.localSelection,
    () => {
      const selection = input.selection.current;
      return buildSelectionOverlayBuffers(
        device,
        selection
          ? [
              {
                key: "local",
                color: input.theme.edgeSelected,
                document: input.world.document,
                objectIds: [
                  ...selectedBrushIdsForScene(selection),
                  ...selectedPointEntityIds(selection),
                ],
              },
            ]
          : [],
        input.entityDefinitions,
      );
    },
    selectionBuffers,
  );
  const toolInput = {
    document: activeDocument,
    selection: input.selection.current,
    hoverSelection: input.selection.hovered,
    faceOutlines: input.localPreview.faceOutlines ?? null,
    objectViewState: input.world.objectViewState,
    tool: input.tools.active,
    transformPivot: input.tools.transformPivot,
    transformPivotHovered: input.tools.transformPivotHovered,
    transformPivotTrace: input.tools.transformPivotTrace,
    movementTraces: input.tools.movementTraces,
    clipPoints: input.tools.clipPoints,
    gridSize: input.tools.gridSize,
    hullPoints: input.tools.hullPoints,
    hullPreviewPoints: input.tools.hullPreviewPoints,
    sweepCaps: input.tools.sweepCaps,
    topologySelection: input.tools.topologySelection,
    topologyHover: input.tools.topologyHover,
    entityLinkMode: input.tools.entityLinkMode,
    openGroupId: input.tools.openGroupId,
    entityDefinitions: input.entityDefinitions,
    theme: input.theme,
  };
  const toolPreviewsResult = retainMeasured(
    "toolPreviews",
    keys.toolPreviews,
    previous?.toolPreviews,
    () => buildToolPreviewBuffers(device, toolInput),
    toolPreviewBuffers,
  );
  const faceGridResult = retainMeasured(
    "faceGrid",
    keys.faceGrid,
    previous?.faceGrid,
    () =>
      buildFaceGridBuffer(device, {
        document: activeDocument,
        selection: input.selection.current,
        hoverSelection: input.selection.hovered,
        gridSize: input.tools.gridSize,
        theme: input.theme,
      }),
    lineBuffer,
  );
  const referencesResult = retainMeasured(
    "references",
    keys.references,
    previous?.references,
    (value: ReferenceBuffers | undefined) =>
      buildWorldGeometryBuffers(
        device,
        {
          ...worldOptions,
          sources: referenceDocumentSources(input.references),
          objectViewState: {
            hiddenBrushIds: [],
            hiddenEntityIds: [],
            lockedBrushIds: [],
            lockedEntityIds: [],
          },
          includedObjectIds: null,
          excludedObjectIds: new Set<string>(),
        },
        value,
      ),
    referenceBuffers,
  );
  const diagnosticsResult = retainMeasured(
    "diagnostics",
    keys.diagnostics,
    previous?.diagnostics,
    () => buildDiagnosticBuffer(device, input.diagnostics, input.theme),
    lineBuffer,
  );
  const remotePresenceResult = retainMeasured(
    "remotePresence",
    keys.remotePresence,
    previous?.remotePresence,
    () =>
      buildRemotePresenceBuffer(
        device,
        input.remotePresence,
        input.entityDefinitions,
      ),
    selectionBuffers,
  );

  const results = [
    worldSolidsResult,
    objectLinesResult,
    localPreviewResult,
    localSelectionResult,
    toolPreviewsResult,
    faceGridResult,
    referencesResult,
    diagnosticsResult,
    remotePresenceResult,
  ] as const;
  for (const result of results) {
    if (result.rebuilt) rebuilt.add(result.contribution.name);
  }
  if (previous && rebuilt.size === 0) {
    return { scene: previous, rebuilt };
  }
  for (const result of results) result.retirePrevious();
  return {
    scene: {
      worldSolids: worldSolidsResult.contribution,
      objectLines: objectLinesResult.contribution,
      localPreview: localPreviewResult.contribution,
      localSelection: localSelectionResult.contribution,
      toolPreviews: toolPreviewsResult.contribution,
      faceGrid: faceGridResult.contribution,
      references: referencesResult.contribution,
      diagnostics: diagnosticsResult.contribution,
      remotePresence: remotePresenceResult.contribution,
    },
    rebuilt,
  };
}

export function disposeSceneBuffers(scene: SceneBuffers): void {
  for (const contribution of Object.values(scene)) contribution.dispose();
}
