import {
  findBrush,
  materialUsageInDocument,
  selectedBrushIds,
  selectedFaceReferences,
  type EditorMaterial,
  type EditorSession,
} from "@tea/maps-editor/core";

const PAGE_SIZE = 90;
const THUMBNAIL_SIZE = 72;

function thumbnail(material: EditorMaterial): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = THUMBNAIL_SIZE;
  canvas.height = THUMBNAIL_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const image = context.createImageData(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
  for (let y = 0; y < THUMBNAIL_SIZE; y += 1) {
    for (let x = 0; x < THUMBNAIL_SIZE; x += 1) {
      const sourceX = Math.min(
        material.width - 1,
        Math.floor((x * material.width) / THUMBNAIL_SIZE),
      );
      const sourceY = Math.min(
        material.height - 1,
        Math.floor((y * material.height) / THUMBNAIL_SIZE),
      );
      const source = (sourceY * material.width + sourceX) * 4;
      const target = (y * THUMBNAIL_SIZE + x) * 4;
      image.data[target] = material.rgba[source]!;
      image.data[target + 1] = material.rgba[source + 1]!;
      image.data[target + 2] = material.rgba[source + 2]!;
      image.data[target + 3] = material.rgba[source + 3]!;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

export function initEditorMaterialBrowser(options: {
  readonly session: () => EditorSession;
  readonly prepare: () => boolean;
  readonly activate: (name: string) => void;
  readonly tool: (tool: "select" | "face") => void;
  readonly status: (message: string) => void;
}) {
  const count = document.querySelector<HTMLElement>("#material-count")!;
  const coverage = document.querySelector<HTMLElement>("#material-coverage")!;
  const grid = document.querySelector<HTMLElement>("#material-grid")!;
  const more = document.querySelector<HTMLButtonElement>("#material-more")!;
  const filter = document.querySelector<HTMLInputElement>("#material-filter")!;
  const sort = document.querySelector<HTMLSelectElement>("#material-sort")!;
  const source = document.querySelector<HTMLSelectElement>("#material-source")!;
  const usedOnly = document.querySelector<HTMLInputElement>(
    "#material-used-only",
  )!;
  const current =
    document.querySelector<HTMLInputElement>("#material-current")!;
  const replaceSource = document.querySelector<HTMLInputElement>(
    "#material-replace-source",
  )!;
  const replaceTarget = document.querySelector<HTMLInputElement>(
    "#material-replace-target",
  )!;
  const replace =
    document.querySelector<HTMLButtonElement>("#material-replace")!;
  const thumbnails = new WeakMap<EditorMaterial, HTMLCanvasElement>();
  let materials: readonly EditorMaterial[] = [];
  let visibleLimit = PAGE_SIZE;

  function active(): string {
    return current.value.trim();
  }

  function refresh() {
    const usages = materialUsageInDocument(options.session().document);
    const byName = new Map(
      usages.map((usage) => [usage.material.toLowerCase(), usage]),
    );
    const loaded = new Set(
      materials.map((material) => material.name.toLowerCase()),
    );
    const missing = usages.filter(
      (usage) => !loaded.has(usage.material.toLowerCase()),
    );
    count.textContent = `${materials.length} loaded · ${usages.length} in use`;
    coverage.hidden = missing.length === 0;
    coverage.textContent = missing.length
      ? `Missing ${missing.length} map materials: ${missing
          .slice(0, 8)
          .map((usage) => usage.material)
          .join(
            ", ",
          )}${missing.length > 8 ? `, +${missing.length - 8} more` : ""}. Add their source to the project.`
      : "";
    const sources = [
      ...new Set(
        materials.map((material) => material.sourceName).filter(Boolean),
      ),
    ].toSorted();
    const selectedSource = sources.includes(source.value)
      ? source.value
      : "all";
    source.replaceChildren(
      new Option("All sources", "all"),
      ...sources.map((name) => new Option(name, name)),
    );
    source.value = selectedSource;
    const tokens = filter.value
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const visible = materials
      .filter((material) => {
        const name = material.name.toLowerCase();
        return (
          tokens.every((token) => name.includes(token)) &&
          (!usedOnly.checked || byName.has(name)) &&
          (selectedSource === "all" || material.sourceName === selectedSource)
        );
      })
      .toSorted((left, right) => {
        if (sort.value === "usage") {
          const difference =
            (byName.get(right.name.toLowerCase())?.faceCount ?? 0) -
            (byName.get(left.name.toLowerCase())?.faceCount ?? 0);
          if (difference) return difference;
        }
        return left.name.localeCompare(right.name);
      });
    grid.replaceChildren();
    for (const material of visible.slice(0, visibleLimit)) {
      const usage = byName.get(material.name.toLowerCase());
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "material-tile";
      tile.dataset.materialName = material.name;
      tile.setAttribute(
        "aria-pressed",
        String(material.name.toLowerCase() === active().toLowerCase()),
      );
      tile.setAttribute("aria-label", material.name);
      tile.title = `${material.logicalWidth ?? material.width}×${material.logicalHeight ?? material.height} · ${usage ? `${usage.faceCount} faces in ${usage.brushCount} brushes` : "Unused"} · ${material.sourceName}`;
      let canvas = thumbnails.get(material);
      if (!canvas) {
        canvas = thumbnail(material);
        thumbnails.set(material, canvas);
      }
      const label = document.createElement("span");
      label.textContent = material.name;
      tile.append(canvas, label);
      tile.addEventListener("click", () => setCurrent(material.name));
      grid.append(tile);
    }
    if (visible.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = materials.length
        ? "No materials match this view"
        : "Open a project to load materials";
      grid.append(empty);
    }
    more.hidden = visible.length <= visibleLimit;
    more.textContent = `Show more materials (${visible.length - visibleLimit} remaining)`;
    replace.disabled =
      !replaceSource.value.trim() ||
      !replaceTarget.value.trim() ||
      replaceSource.value.trim().toLowerCase() ===
        replaceTarget.value.trim().toLowerCase();
  }

  function setCurrent(name: string) {
    current.value = name;
    options.activate(name);
    for (const tile of grid.querySelectorAll<HTMLButtonElement>(
      ".material-tile",
    ))
      tile.setAttribute(
        "aria-pressed",
        String(tile.dataset.materialName?.toLowerCase() === name.toLowerCase()),
      );
  }

  function perform(action: () => void) {
    if (!options.prepare()) return;
    try {
      action();
    } catch (error) {
      options.status(error instanceof Error ? error.message : String(error));
    }
  }

  for (const control of [filter, sort, source, usedOnly]) {
    control.addEventListener(control === filter ? "input" : "change", () => {
      visibleLimit = PAGE_SIZE;
      refresh();
    });
  }
  more.addEventListener("click", () => {
    visibleLimit += PAGE_SIZE;
    refresh();
  });
  current.addEventListener("input", () => {
    options.activate(current.value);
    for (const tile of grid.querySelectorAll<HTMLButtonElement>(
      ".material-tile",
    ))
      tile.setAttribute(
        "aria-pressed",
        String(
          tile.dataset.materialName?.toLowerCase() ===
            current.value.toLowerCase(),
        ),
      );
  });
  document
    .querySelector<HTMLButtonElement>("#material-apply")!
    .addEventListener("click", () =>
      perform(() => {
        if (!active() || !options.session().selection) {
          options.status("Select a brush or face and choose a material first");
          return;
        }
        if (!options.session().applyMaterial(active()))
          options.status(`Selection already uses ${active()}`);
      }),
    );
  document
    .querySelector<HTMLButtonElement>("#material-sample")!
    .addEventListener("click", () => {
      const session = options.session();
      const face = selectedFaceReferences(session.selection)[0];
      const brushId = face?.brushId ?? selectedBrushIds(session.selection)[0];
      const material = findBrush(session.document, brushId ?? "")?.faces.find(
        (candidate) => !face || candidate.id === face.faceId,
      )?.material;
      if (material) setCurrent(material);
      else options.status("Select a brush or face to sample its material");
    });
  document
    .querySelector<HTMLButtonElement>("#material-select-faces")!
    .addEventListener("click", () => {
      if (!active()) return;
      const selection = options.session().selectFacesUsingMaterial(active());
      const selectedCount = selectedFaceReferences(selection).length;
      if (selectedCount) options.tool("face");
      options.status(
        selectedCount
          ? `Selected ${selectedCount} faces using ${active()}`
          : `No visible, editable faces use ${active()}`,
      );
    });
  document
    .querySelector<HTMLButtonElement>("#material-select-brushes")!
    .addEventListener("click", () => {
      if (!active()) return;
      const selection = options.session().selectBrushesUsingMaterial(active());
      const selectedCount = selectedBrushIds(selection).length;
      if (selectedCount) options.tool("select");
      options.status(
        selectedCount
          ? `Selected ${selectedCount} brushes using ${active()}`
          : `No visible, editable brushes use ${active()}`,
      );
    });
  document
    .querySelector<HTMLButtonElement>("#material-copy-name")!
    .addEventListener("click", async () => {
      if (!active()) return;
      try {
        await navigator.clipboard.writeText(active());
        options.status(`Copied material name ${active()}`);
      } catch (error) {
        options.status(error instanceof Error ? error.message : String(error));
      }
    });
  for (const input of [replaceSource, replaceTarget])
    input.addEventListener("input", refresh);
  replace.addEventListener("click", () =>
    perform(() => {
      const from = replaceSource.value.trim();
      const to = replaceTarget.value.trim();
      if (!from || !to || from.toLowerCase() === to.toLowerCase()) return;
      const changed = options.session().replaceMaterial(from, to);
      options.status(
        changed
          ? `Replaced ${changed} faces using ${from} with ${to}`
          : `No ${from} faces match the replacement scope`,
      );
    }),
  );
  refresh();
  return {
    setMaterials(next: readonly EditorMaterial[]) {
      materials = next;
      visibleLimit = PAGE_SIZE;
      if (
        materials.length > 0 &&
        !materials.some(
          (material) => material.name.toLowerCase() === active().toLowerCase(),
        )
      ) {
        setCurrent(
          materials.find((material) => material.name === "DEV_FLOOR")?.name ??
            materials[0]!.name,
        );
      }
      options.activate(active());
      refresh();
    },
    refresh,
    setCurrent,
  };
}
