import { clientEntry, on, type Handle } from "remix/component";
import type { EditorWorkspaceState } from "./editor-workspace.ts";

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

export const EditorInspectorTabs = clientEntry(
  `${import.meta.url}#EditorInspectorTabs`,
  function EditorInspectorTabsComponent(handle: Handle) {
    let active: InspectorTab = "map";

    function select(tab: InspectorTab) {
      active = tab;
      for (const panel of document.querySelectorAll<HTMLElement>(
        "[data-inspector-panel]",
      )) {
        panel.hidden = panel.dataset.inspectorPanel !== tab;
      }
      handle.update();
    }

    handle.queueTask(() => {
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
    );
  },
);
