import type { ProjectMap } from "./editor-project.ts";

export function initProjectMapSelector(options: {
  openMap(path: string): void;
  openSync(): void;
}) {
  const workspace = document.querySelector<HTMLElement>(".editor-workspace")!;
  const panel = document.querySelector<HTMLElement>("#project-map-selector")!;
  const title = document.querySelector<HTMLElement>(
    "#project-map-selector-title",
  )!;
  const count = document.querySelector<HTMLElement>(
    "#project-map-selector-count",
  )!;
  const filter = document.querySelector<HTMLInputElement>(
    "#project-map-selector-filter",
  )!;
  const rows = document.querySelector<HTMLElement>(
    "#project-map-selector-rows",
  )!;
  const sync = document.querySelector<HTMLButtonElement>(
    "#project-map-selector-sync",
  )!;
  let maps: readonly ProjectMap[] = [];
  let lastPath: string | null = null;

  function render() {
    const query = filter.value.trim().toLowerCase();
    const visible = maps.filter((map) =>
      map.path.toLowerCase().includes(query),
    );
    rows.replaceChildren();
    if (!maps.length) {
      rows.textContent =
        "No .map files were found under this project's map roots.";
      return;
    }
    if (!visible.length) {
      rows.textContent = `No maps match “${filter.value.trim()}”.`;
      return;
    }
    for (const map of visible) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "project-map-selector-row";
      row.setAttribute("aria-label", `Open ${map.path}`);
      const slash = map.path.lastIndexOf("/");
      const name = document.createElement("strong");
      name.textContent = slash < 0 ? map.path : map.path.slice(slash + 1);
      const folder = document.createElement("small");
      folder.textContent = slash < 0 ? "." : map.path.slice(0, slash);
      const label = document.createElement("span");
      label.append(name, folder);
      row.append(label);
      if (map.path === lastPath) {
        const badge = document.createElement("span");
        badge.textContent = "Last opened";
        row.append(badge);
      }
      const arrow = document.createElement("span");
      arrow.textContent = "→";
      arrow.setAttribute("aria-hidden", "true");
      row.append(arrow);
      row.addEventListener("click", () => options.openMap(map.path));
      rows.append(row);
    }
  }

  filter.addEventListener("input", render);
  sync.addEventListener("click", options.openSync);

  return {
    show(
      projectName: string,
      projectMaps: readonly ProjectMap[],
      lastMapPath?: string,
    ) {
      title.textContent = projectName;
      count.textContent = `Maps ${projectMaps.length}`;
      maps = projectMaps;
      lastPath = lastMapPath ?? null;
      filter.value = "";
      filter.hidden = maps.length <= 5;
      render();
      panel.hidden = false;
      workspace.dataset.choosingMap = "true";
    },
    hide() {
      panel.hidden = true;
      delete workspace.dataset.choosingMap;
    },
  };
}
