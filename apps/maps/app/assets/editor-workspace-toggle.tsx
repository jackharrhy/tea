import { clientEntry, css, on, type Handle } from "remix/component";
import type { EditorWorkspaceState } from "./editor-workspace.ts";
import { EditorDocumentSummary, EditorIssues } from "./editor-issues-panel.tsx";
import { EditorProjectResourcesPanel } from "./editor-project-context-panel.tsx";
import { EditorLayers } from "./editor-layers-panel.tsx";
import { EditorVisibility } from "./editor-visibility-panel.tsx";
import { EditorReferences } from "./editor-references-panel.tsx";
import { EditorEntityInspector } from "./editor-entity-inspector-panel.tsx";
import { EditorGroups } from "./editor-groups-panel.tsx";
import { EditorEntityCreation } from "./editor-entity-creation-panel.tsx";
import { EditorGeometry, EditorCsg } from "./editor-geometry-panel.tsx";
import { EditorShapePanel } from "./editor-shape-panel.tsx";
import { EditorClipHull } from "./editor-clip-hull-panel.tsx";
import { EditorSweepPanel } from "./editor-sweep-panel.tsx";
import { EditorTopologyPanel } from "./editor-topology-panel.tsx";
import { EditorTransformToolPanel } from "./editor-transform-tool-panel.tsx";
import { EditorTransforms } from "./editor-transforms-panel.tsx";
import { EditorFaceInspector } from "./editor-face-inspector-panel.tsx";
import { EditorMaterialBrowser } from "./editor-material-browser-panel.tsx";
import { EditorSourcePanel } from "./editor-source-panel.tsx";

function subscribeWorkspace(
  handle: Handle,
  update: (state: EditorWorkspaceState) => void,
) {
  handle.queueTask(() => {
    window.addEventListener(
      "tea-maps-workspace-bridge-ready",
      () => window.dispatchEvent(new Event("tea-maps-workspace-ready")),
      { signal: handle.signal },
    );
    window.addEventListener(
      "tea-maps-workspace-state",
      (event) => update((event as CustomEvent<EditorWorkspaceState>).detail),
      { signal: handle.signal },
    );
    window.dispatchEvent(new Event("tea-maps-workspace-ready"));
  });
}

export const EditorWorkspaceToggle = clientEntry(
  `${import.meta.url}#EditorWorkspaceToggle`,
  function EditorWorkspaceToggleComponent(handle: Handle) {
    let state: EditorWorkspaceState | null = null;

    subscribeWorkspace(handle, (next) => {
      state = next;
      handle.update();
    });

    return () => (
      <button
        id="perspective-only"
        type="button"
        aria-pressed={state?.perspectiveOnly ?? false}
        aria-label={
          state?.perspectiveOnly
            ? "Restore four viewports"
            : "Show Perspective only"
        }
        disabled={!state?.ready}
        mix={on("click", () => state?.toggle())}
      >
        {state?.perspectiveOnly ? "Restore" : "Expand"}
      </button>
    );
  },
);

export const EditorInspectorToggle = clientEntry(
  `${import.meta.url}#EditorInspectorToggle`,
  function EditorInspectorToggleComponent(handle: Handle) {
    let state: EditorWorkspaceState | null = null;
    subscribeWorkspace(handle, (next) => {
      state = next;
      handle.update();
    });
    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-inspector-show-map",
        () => {
          if (state?.inspectorOpen === false) state.toggleInspector();
        },
        { signal: handle.signal },
      );
    });

    return () => (
      <button
        id="toggle-inspector"
        type="button"
        aria-controls="editor-inspector"
        aria-expanded={state?.inspectorOpen ?? true}
        aria-label={
          state?.inspectorOpen === false ? "Show inspector" : "Hide inspector"
        }
        mix={on("click", () => state?.toggleInspector())}
      >
        Inspector
      </button>
    );
  },
);

const inspectorTabs = ["map", "entity", "face", "source"] as const;
type InspectorTab = (typeof inspectorTabs)[number];

export const EditorInspector = clientEntry(
  `${import.meta.url}#EditorInspector`,
  function EditorInspectorComponent(handle: Handle) {
    let active: InspectorTab = "map";

    function select(tab: InspectorTab) {
      active = tab;
      handle.update();
    }

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-inspector-show-map",
        () => select("map"),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-inspector-selection",
        (event) => {
          if (
            document.querySelector<HTMLElement>(".editor-workspace")?.dataset
              .inspectorOpen === "false"
          )
            return;
          select((event as CustomEvent<"entity" | "face">).detail);
        },
        { signal: handle.signal },
      );
    });

    return () => (
      <div mix={css({ display: "contents" })}>
        <div class="inspector-tabs" role="tablist" aria-label="Inspector views">
          {inspectorTabs.map((tab) => (
            <button
              id={`inspector-tab-${tab}`}
              type="button"
              role="tab"
              aria-controls={`inspector-panel-${tab}`}
              aria-selected={active === tab}
              tabIndex={active === tab ? 0 : -1}
              mix={[
                on("click", () => select(tab)),
                on<HTMLButtonElement>("keydown", (event) => {
                  if (!("key" in event)) return;
                  const index = inspectorTabs.indexOf(tab);
                  const next =
                    event.key === "ArrowRight"
                      ? inspectorTabs[(index + 1) % inspectorTabs.length]
                      : event.key === "ArrowLeft"
                        ? inspectorTabs[
                            (index - 1 + inspectorTabs.length) %
                              inspectorTabs.length
                          ]
                        : event.key === "Home"
                          ? inspectorTabs[0]
                          : event.key === "End"
                            ? inspectorTabs[inspectorTabs.length - 1]
                            : null;
                  if (!next) return;
                  event.preventDefault();
                  select(next);
                  document.getElementById(`inspector-tab-${next}`)?.focus();
                }),
              ]}
            >
              {tab[0]!.toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <section
          id="inspector-panel-map"
          role="tabpanel"
          aria-labelledby="inspector-tab-map"
          data-inspector-panel="map"
          hidden={active !== "map"}
        >
          <EditorDocumentSummary />
          <EditorProjectResourcesPanel />
          <EditorLayers />
          <EditorIssues />
          <EditorVisibility />
          <EditorReferences />
        </section>
        <section
          id="inspector-panel-entity"
          role="tabpanel"
          aria-labelledby="inspector-tab-entity"
          data-inspector-panel="entity"
          hidden={active !== "entity"}
        >
          <EditorEntityInspector />
          <EditorGroups />
          <EditorEntityCreation />
          <EditorGeometry />
          <EditorShapePanel />
          <EditorClipHull />
          <EditorSweepPanel />
          <EditorTopologyPanel />
          <EditorTransformToolPanel />
          <EditorTransforms />
          <EditorCsg />
        </section>
        <section
          id="inspector-panel-face"
          role="tabpanel"
          aria-labelledby="inspector-tab-face"
          data-inspector-panel="face"
          hidden={active !== "face"}
        >
          <EditorFaceInspector />
          <EditorMaterialBrowser />
        </section>
        <section
          id="inspector-panel-source"
          role="tabpanel"
          aria-labelledby="inspector-tab-source"
          data-inspector-panel="source"
          hidden={active !== "source"}
        >
          <EditorSourcePanel />
          <p>Apply source edits before using viewport tools.</p>
        </section>
      </div>
    );
  },
);
