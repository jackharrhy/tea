import {
  deriveEntityLinks,
  EDITOR_SPECIAL_BRUSH_FILTER_INFO,
  entityClassFiltersInDocument,
  selectedEntityIdsForLinks,
  visibleEntityLinks,
  type EntityLinkMode,
} from "@tea/maps-editor/core";
import { clientEntry, css, on, type Handle } from "remix/component";
import type { EditorVisibilityState } from "./editor-visibility.ts";

export const EditorVisibility = clientEntry(
  `${import.meta.url}#EditorVisibility`,
  function EditorVisibilityComponent(handle: Handle) {
    let state: EditorVisibilityState | null = null;
    let search = "";

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-visibility-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-visibility-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-visibility-state",
        (event) => {
          state = (event as CustomEvent<EditorVisibilityState>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-visibility-ready"));
    });

    return () => {
      const session = state?.session();
      const filters = session?.viewFilters;
      const available = session
        ? entityClassFiltersInDocument(session.document)
        : [];
      const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const classes = available.filter(({ classname }) =>
        terms.every((term) => classname.includes(term)),
      );
      const filtered = session?.filteredObjectIds;
      const hiddenCount =
        (filtered?.brushIds.length ?? 0) + (filtered?.entityIds.length ?? 0);
      const links = session ? deriveEntityLinks(session.document) : [];
      const selected = session
        ? selectedEntityIdsForLinks(session.document, session.selection)
        : [];
      const mode = state?.mode ?? "direct";

      return (
        <div mix={css({ display: "contents" })}>
          <details id="view-filters">
            <summary id="view-filter-summary">
              View filters · {hiddenCount} filtered
            </summary>
            <p>Local view only · map source stays unchanged</p>
            <label for="show-world-brushes">
              <input
                id="show-world-brushes"
                type="checkbox"
                checked={filters?.worldBrushesVisible ?? true}
                mix={on<HTMLInputElement>("change", (event) => {
                  state
                    ?.session()
                    .setWorldBrushesVisible(event.currentTarget.checked);
                  handle.update();
                })}
              />{" "}
              World brushes
            </label>
            <h2>Special brushes</h2>
            <div id="special-brush-filters">
              {EDITOR_SPECIAL_BRUSH_FILTER_INFO.map((entry) => (
                <label title={entry.description}>
                  <input
                    type="checkbox"
                    checked={
                      !filters?.hiddenSpecialBrushTypes.includes(entry.type)
                    }
                    mix={on<HTMLInputElement>("change", (event) => {
                      state
                        ?.session()
                        .setSpecialBrushFilterVisible(
                          entry.type,
                          event.currentTarget.checked,
                        );
                      handle.update();
                    })}
                  />
                  {entry.label}
                </label>
              ))}
            </div>
            <h2>Entity classes</h2>
            <label for="entity-class-search">Find classname</label>
            <input
              id="entity-class-search"
              type="search"
              value={search}
              mix={on<HTMLInputElement>("input", (event) => {
                search = event.currentTarget.value;
                handle.update();
              })}
            />
            <div class="filter-actions">
              <button
                id="show-all-classes"
                type="button"
                mix={on("click", () => {
                  state?.session().setAllEntityClassesVisible(true);
                  handle.update();
                })}
              >
                All
              </button>
              <button
                id="hide-all-classes"
                type="button"
                mix={on("click", () => {
                  state?.session().setAllEntityClassesVisible(false);
                  handle.update();
                })}
              >
                None
              </button>
            </div>
            <div id="entity-class-filters">
              {classes.length ? (
                classes.map((entry) => (
                  <label>
                    <input
                      type="checkbox"
                      checked={
                        !filters?.hiddenEntityClassnames.includes(
                          entry.classname,
                        )
                      }
                      mix={on<HTMLInputElement>("change", (event) => {
                        state
                          ?.session()
                          .setEntityClassVisible(
                            entry.classname,
                            event.currentTarget.checked,
                          );
                        handle.update();
                      })}
                    />
                    {entry.classname} · {entry.pointEntityCount} point ·{" "}
                    {entry.brushEntityCount} brush
                  </label>
                ))
              ) : (
                <p>
                  {available.length
                    ? "No matching classnames"
                    : "No entity classes in this map"}
                </p>
              )}
            </div>
          </details>
          <details id="entity-links">
            <summary>Entity links</summary>
            <label for="entity-link-mode">Visibility</label>
            <select
              id="entity-link-mode"
              value={mode}
              mix={on<HTMLSelectElement>("change", (event) => {
                const next = event.currentTarget.value;
                if (
                  next === "all" ||
                  next === "transitive" ||
                  next === "direct" ||
                  next === "none"
                )
                  state?.setLinkMode(next as EntityLinkMode);
              })}
            >
              <option value="all">All</option>
              <option value="transitive">Transitive selected</option>
              <option value="direct">Direct selected</option>
              <option value="none">None</option>
            </select>
            <span id="entity-link-count">
              {visibleEntityLinks(links, selected, mode).length} /{" "}
              {links.length} shown
            </span>
          </details>
        </div>
      );
    };
  },
);
