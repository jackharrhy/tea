import { clientEntry, on, type Handle } from "remix/component";
import {
  currentProjectMapSelector,
  onProjectMapSelectorChange,
  openProjectMapEvent,
  syncProjectMapsEvent,
} from "./editor-project-map-selector.ts";

export const EditorProjectMapSelector = clientEntry(
  `file:///app/assets/editor-project-map-selector-panel.tsx#EditorProjectMapSelector`,
  function EditorProjectMapSelectorComponent(handle: Handle) {
    let state = null as ReturnType<typeof currentProjectMapSelector>;
    let filter = "";

    handle.queueTask(() => {
      onProjectMapSelectorChange(() => {
        state = currentProjectMapSelector();
        filter = "";
        handle.update();
      }, handle.signal);
      state = currentProjectMapSelector();
      handle.update();
    });

    return () => {
      const current = state;
      const query = filter.trim().toLowerCase();
      const visible = current?.paths.filter((path) =>
        path.toLowerCase().includes(query),
      );

      return (
        <section
          id="project-map-selector"
          aria-labelledby="project-map-selector-title"
          hidden={!current}
        >
          <div class="project-map-selector-content">
            <p>Local project</p>
            <h1 id="project-map-selector-title">
              {current?.projectName ?? "Project maps"}
            </h1>
            <p>Choose a map to start editing.</p>
            <div class="project-map-selector-list">
              <div class="project-map-selector-heading">
                <strong id="project-map-selector-count">
                  Maps {current?.paths.length ?? 0}
                </strong>
                <input
                  id="project-map-selector-filter"
                  type="search"
                  aria-label="Filter project maps"
                  placeholder="Filter maps"
                  value={filter}
                  hidden={(current?.paths.length ?? 0) <= 5}
                  mix={on<HTMLInputElement>("input", (event) => {
                    filter = event.currentTarget.value;
                    handle.update();
                  })}
                />
              </div>
              <div id="project-map-selector-rows">
                {current?.paths.length === 0
                  ? "No .map files were found under this project's map roots."
                  : visible?.length === 0
                    ? `No maps match “${filter.trim()}”.`
                    : visible?.map((path) => {
                        const slash = path.lastIndexOf("/");
                        return (
                          <button
                            type="button"
                            class="project-map-selector-row"
                            aria-label={`Open ${path}`}
                            mix={on("click", () => {
                              window.dispatchEvent(
                                new CustomEvent(openProjectMapEvent, {
                                  detail: path,
                                }),
                              );
                            })}
                          >
                            <span>
                              <strong>
                                {slash < 0 ? path : path.slice(slash + 1)}
                              </strong>
                              <small>
                                {slash < 0 ? "." : path.slice(0, slash)}
                              </small>
                            </span>
                            {path === current?.lastPath ? (
                              <span>Last opened</span>
                            ) : null}
                            <span aria-hidden="true">→</span>
                          </button>
                        );
                      })}
              </div>
            </div>
            <button
              id="project-map-selector-sync"
              type="button"
              mix={on("click", () => {
                window.dispatchEvent(new Event(syncProjectMapsEvent));
              })}
            >
              Project sync
            </button>
          </div>
        </section>
      );
    };
  },
);
