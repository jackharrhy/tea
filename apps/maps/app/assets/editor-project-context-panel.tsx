import { clientEntry, css, on, type Handle } from "remix/component";
import type { EditorProjectContext } from "./editor-project-context-bridge.ts";

export const EditorProjectContextPanel = clientEntry(
  `${import.meta.url}#EditorProjectContextPanel`,
  function EditorProjectContextPanelComponent(handle: Handle) {
    let context: EditorProjectContext | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-project-context-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-project-context-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-project-context-state",
        (event) => {
          context = (event as CustomEvent<EditorProjectContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-project-context-ready"));
    });

    return () => {
      const state = context?.state;
      return (
        <div mix={css({ display: "contents" })}>
          <label for="project-maps">Project maps</label>
          <select
            id="project-maps"
            disabled={!state?.projectName || state.paths.length === 0}
            value={state?.selectedPath ?? ""}
            mix={on<HTMLSelectElement>("change", (event) => {
              const path = event.currentTarget.value;
              if (path) void context?.openMap(path);
            })}
          >
            <option value="">
              {state?.projectName
                ? `${state.projectName} · choose a map`
                : "No project open"}
            </option>
            {state?.paths.map((path) => (
              <option value={path}>{path}</option>
            ))}
          </select>
          <span id="project-resource-info" role="status">
            {state?.resourceInfo ?? ""}
          </span>
          <details
            id="project-resource-diagnostics"
            hidden={!state || state.diagnostics.length === 0}
          >
            <summary>Project resource messages</summary>
            <ul id="project-resource-messages">
              {state?.diagnostics.map((message) => (
                <li>{message}</li>
              ))}
            </ul>
          </details>
          {state?.standalone && (
            <details>
              <summary>Map resources</summary>
              <div
                mix={css({
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                })}
              >
                <label for="standalone-wads" mix={css({ cursor: "pointer" })}>
                  Add WAD
                </label>
                <input
                  id="standalone-wads"
                  type="file"
                  accept=".wad"
                  multiple
                  mix={[
                    css({ maxWidth: "8rem" }),
                    on<HTMLInputElement>("change", (event) => {
                      const input = event.currentTarget;
                      void context?.addWads([...(input.files ?? [])]);
                      input.value = "";
                    }),
                  ]}
                />
                <label
                  for="standalone-palette"
                  mix={css({ cursor: "pointer" })}
                >
                  Quake palette
                </label>
                <input
                  id="standalone-palette"
                  type="file"
                  accept=".lmp,.pal,.dat"
                  disabled={state.standaloneGame !== "quake"}
                  mix={[
                    css({ maxWidth: "8rem" }),
                    on<HTMLInputElement>("change", (event) => {
                      const input = event.currentTarget;
                      const file = input.files?.[0];
                      if (file) void context?.setPalette(file);
                      input.value = "";
                    }),
                  ]}
                />
                <span role="status">
                  {state.standaloneWadCount} WADs
                  {state.standalonePalette ? " · custom palette" : ""}
                  {state.standaloneMessage
                    ? ` · ${state.standaloneMessage}`
                    : ""}
                </span>
                <button
                  type="button"
                  mix={on("click", () => void context?.clearResources())}
                >
                  Clear resources
                </button>
              </div>
            </details>
          )}
        </div>
      );
    };
  },
);
