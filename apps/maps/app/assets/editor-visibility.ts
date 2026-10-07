import {
  deriveEntityLinks,
  EDITOR_SPECIAL_BRUSH_FILTER_INFO,
  entityClassFiltersInDocument,
  selectedEntityIdsForLinks,
  visibleEntityLinks,
  type EditorSpecialBrushFilter,
  type EditorSession,
  type EntityLinkMode,
} from "@tea/maps-editor/core";
import type { EditorSourceRenderer } from "@tea/maps-editor/render";

export function createEditorVisibility(options: {
  readonly root: HTMLElement;
  readonly session: () => EditorSession;
  readonly renderer: () => EditorSourceRenderer | null;
}) {
  const summary = options.root.querySelector<HTMLElement>(
    "#view-filter-summary",
  )!;
  const worldBrushes = options.root.querySelector<HTMLInputElement>(
    "#show-world-brushes",
  )!;
  const special = options.root.querySelector<HTMLElement>(
    "#special-brush-filters",
  )!;
  const search = options.root.querySelector<HTMLInputElement>(
    "#entity-class-search",
  )!;
  const classes = options.root.querySelector<HTMLElement>(
    "#entity-class-filters",
  )!;
  const showAll =
    options.root.querySelector<HTMLButtonElement>("#show-all-classes")!;
  const hideAll =
    options.root.querySelector<HTMLButtonElement>("#hide-all-classes")!;
  const linkMode =
    options.root.querySelector<HTMLSelectElement>("#entity-link-mode")!;
  const linkCount =
    options.root.querySelector<HTMLElement>("#entity-link-count")!;
  let mode: EntityLinkMode = "direct";
  const specialControls = new Map<EditorSpecialBrushFilter, HTMLInputElement>();

  const refresh = () => {
    const session = options.session();
    const filters = session.viewFilters;
    worldBrushes.checked = filters.worldBrushesVisible;
    for (const [type, checkbox] of specialControls) {
      checkbox.checked = !filters.hiddenSpecialBrushTypes.includes(type);
    }
    classes.replaceChildren();
    const terms = search.value
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const available = entityClassFiltersInDocument(session.document);
    for (const entry of available.filter(({ classname }) =>
      terms.every((term) => classname.includes(term)),
    )) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !filters.hiddenEntityClassnames.includes(
        entry.classname,
      );
      checkbox.addEventListener("change", () => {
        session.setEntityClassVisible(entry.classname, checkbox.checked);
        refresh();
      });
      label.append(
        checkbox,
        document.createTextNode(
          `${entry.classname} · ${entry.pointEntityCount} point · ${entry.brushEntityCount} brush`,
        ),
      );
      classes.append(label);
    }
    if (classes.childElementCount === 0) {
      const empty = document.createElement("p");
      empty.textContent = available.length
        ? "No matching classnames"
        : "No entity classes in this map";
      classes.append(empty);
    }
    const filtered = session.filteredObjectIds;
    const hiddenCount = filtered.brushIds.length + filtered.entityIds.length;
    summary.textContent = `View filters · ${hiddenCount} filtered`;
    const links = deriveEntityLinks(session.document);
    const selected = selectedEntityIdsForLinks(
      session.document,
      session.selection,
    );
    linkCount.textContent = `${visibleEntityLinks(links, selected, mode).length} / ${links.length} shown`;
    linkMode.value = mode;
  };

  worldBrushes.addEventListener("change", () => {
    options.session().setWorldBrushesVisible(worldBrushes.checked);
    refresh();
  });
  for (const entry of EDITOR_SPECIAL_BRUSH_FILTER_INFO) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.addEventListener("change", () => {
      options
        .session()
        .setSpecialBrushFilterVisible(entry.type, checkbox.checked);
      refresh();
    });
    label.title = entry.description;
    label.append(checkbox, document.createTextNode(entry.label));
    special.append(label);
    specialControls.set(entry.type, checkbox);
  }
  search.addEventListener("input", refresh);
  showAll.addEventListener("click", () => {
    options.session().setAllEntityClassesVisible(true);
    refresh();
  });
  hideAll.addEventListener("click", () => {
    options.session().setAllEntityClassesVisible(false);
    refresh();
  });
  linkMode.addEventListener("change", () => {
    if (
      linkMode.value !== "all" &&
      linkMode.value !== "transitive" &&
      linkMode.value !== "direct" &&
      linkMode.value !== "none"
    ) {
      return;
    }
    mode = linkMode.value;
    options.renderer()?.setEntityLinkMode(mode);
    refresh();
  });

  return {
    refresh,
    applyRenderer() {
      options.renderer()?.setEntityLinkMode(mode);
    },
  };
}
