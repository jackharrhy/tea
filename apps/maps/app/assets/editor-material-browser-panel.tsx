import {
  findBrush,
  materialUsageInDocument,
  selectedBrushIds,
  selectedFaceReferences,
  type EditorMaterial,
} from "@tea/maps-editor/core";
import { clientEntry, on, ref, type Handle } from "remix/component";
import type { MaterialBrowserContext } from "./editor-material-browser.ts";

const PAGE_SIZE = 90;
const THUMBNAIL_SIZE = 72;

function drawThumbnail(canvas: HTMLCanvasElement, material: EditorMaterial) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const image = context.createImageData(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
  for (let y = 0; y < THUMBNAIL_SIZE; y++) {
    for (let x = 0; x < THUMBNAIL_SIZE; x++) {
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
}

export const EditorMaterialBrowser = clientEntry(
  `${import.meta.url}#EditorMaterialBrowser`,
  function EditorMaterialBrowserComponent(handle: Handle) {
    let context: MaterialBrowserContext | null = null;
    let filter = "";
    let sort = "name";
    let source = "all";
    let usedOnly = false;
    let current = "DEV_FLOOR";
    let replaceSource = "";
    let replaceTarget = "";
    let visibleLimit = PAGE_SIZE;
    let revision = -1;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-material-browser-bridge-ready",
        () =>
          window.dispatchEvent(new Event("tea-maps-material-browser-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-material-browser-state",
        (event) => {
          const next = (event as CustomEvent<MaterialBrowserContext>).detail;
          if (next.revision !== revision) {
            revision = next.revision;
            visibleLimit = PAGE_SIZE;
          }
          context = next;
          current = next.current;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-material-browser-ready"));
    });

    function select(name: string) {
      current = name;
      context?.activate(name);
      handle.update();
    }

    function perform(action: (state: MaterialBrowserContext) => void) {
      if (!context || !context.prepare()) return;
      try {
        action(context);
      } catch (cause) {
        context.status(cause instanceof Error ? cause.message : String(cause));
      }
    }

    function sample() {
      if (!context) return;
      const session = context.session();
      const face = selectedFaceReferences(session.selection)[0];
      const brushId = face?.brushId ?? selectedBrushIds(session.selection)[0];
      const material = findBrush(session.document, brushId ?? "")?.faces.find(
        (candidate) => !face || candidate.id === face.faceId,
      )?.material;
      if (material) select(material);
      else context.status("Select a brush or face to sample its material");
    }

    function selectUses(kind: "faces" | "brushes") {
      if (!context || !current.trim()) return;
      const selection =
        kind === "faces"
          ? context.session().selectFacesUsingMaterial(current.trim())
          : context.session().selectBrushesUsingMaterial(current.trim());
      const selectedCount =
        kind === "faces"
          ? selectedFaceReferences(selection).length
          : selectedBrushIds(selection).length;
      if (selectedCount) context.tool(kind === "faces" ? "face" : "select");
      context.status(
        selectedCount
          ? `Selected ${selectedCount} ${kind} using ${current.trim()}`
          : `No visible, editable ${kind} use ${current.trim()}`,
      );
    }

    async function copyName() {
      if (!context || !current.trim()) return;
      try {
        await navigator.clipboard.writeText(current.trim());
        context.status(`Copied material name ${current.trim()}`);
      } catch (cause) {
        context.status(cause instanceof Error ? cause.message : String(cause));
      }
    }

    return () => {
      const materials = context?.materials ?? [];
      const usages = context
        ? materialUsageInDocument(context.session().document)
        : [];
      const byName = new Map(
        usages.map((usage) => [usage.material.toLowerCase(), usage]),
      );
      const loaded = new Set(
        materials.map((material) => material.name.toLowerCase()),
      );
      const missing = usages.filter(
        (usage) => !loaded.has(usage.material.toLowerCase()),
      );
      const sources = [
        ...new Set(
          materials.map((material) => material.sourceName).filter(Boolean),
        ),
      ].toSorted();
      if (!sources.includes(source)) source = "all";
      const tokens = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const visible = materials
        .filter((material) => {
          const name = material.name.toLowerCase();
          return (
            tokens.every((token) => name.includes(token)) &&
            (!usedOnly || byName.has(name)) &&
            (source === "all" || material.sourceName === source)
          );
        })
        .toSorted((left, right) => {
          if (sort === "usage") {
            const difference =
              (byName.get(right.name.toLowerCase())?.faceCount ?? 0) -
              (byName.get(left.name.toLowerCase())?.faceCount ?? 0);
            if (difference) return difference;
          }
          return left.name.localeCompare(right.name);
        });
      const canReplace =
        Boolean(replaceSource.trim() && replaceTarget.trim()) &&
        replaceSource.trim().toLowerCase() !==
          replaceTarget.trim().toLowerCase();
      const selection = context?.session().selection;
      const selectedFaces = selection ? selectedFaceReferences(selection) : [];
      const selectedBrushes = selection ? selectedBrushIds(selection) : [];
      const replaceScope = selectedFaces.length
        ? `${selectedFaces.length} selected ${selectedFaces.length === 1 ? "face" : "faces"}. Replacement selects changed faces.`
        : selectedBrushes.length
          ? `${selectedBrushes.length} selected ${selectedBrushes.length === 1 ? "brush" : "brushes"}. Replacement affects matching faces.`
          : selection
            ? "Selection has no brush faces to replace."
            : "No selection. Replacement affects the whole map and selects changed faces.";

      return (
        <details id="material-browser" open>
          <summary>
            Material browser ·{" "}
            <span id="material-count">
              {materials.length} loaded · {usages.length} in use
            </span>
          </summary>
          <p id="material-coverage" role="status" hidden={!missing.length}>
            {missing.length
              ? `Missing ${missing.length} map materials: ${missing
                  .slice(0, 8)
                  .map((usage) => usage.material)
                  .join(
                    ", ",
                  )}${missing.length > 8 ? `, +${missing.length - 8} more` : ""}. Add their source to the project.`
              : ""}
          </p>
          <div class="material-browser-controls">
            <label for="material-filter">Search</label>
            <input
              id="material-filter"
              type="search"
              placeholder="Material name"
              value={filter}
              mix={on<HTMLInputElement>("input", (event) => {
                filter = event.currentTarget.value;
                visibleLimit = PAGE_SIZE;
                handle.update();
              })}
            />
            <label for="material-sort">Sort</label>
            <select
              id="material-sort"
              value={sort}
              mix={on<HTMLSelectElement>("change", (event) => {
                sort = event.currentTarget.value;
                visibleLimit = PAGE_SIZE;
                handle.update();
              })}
            >
              <option value="name">Name</option>
              <option value="usage">Usage</option>
            </select>
            <label for="material-source">Source</label>
            <select
              id="material-source"
              value={source}
              mix={on<HTMLSelectElement>("change", (event) => {
                source = event.currentTarget.value;
                visibleLimit = PAGE_SIZE;
                handle.update();
              })}
            >
              <option value="all">All sources</option>
              {sources.map((name) => (
                <option value={name}>{name}</option>
              ))}
            </select>
            <label for="material-used-only">
              <input
                id="material-used-only"
                type="checkbox"
                checked={usedOnly}
                mix={on<HTMLInputElement>("change", (event) => {
                  usedOnly = event.currentTarget.checked;
                  visibleLimit = PAGE_SIZE;
                  handle.update();
                })}
              />{" "}
              Used only
            </label>
          </div>
          <div
            id="material-grid"
            class="material-grid"
            aria-label="Loaded materials"
          >
            {visible.slice(0, visibleLimit).map((material) => {
              const usage = byName.get(material.name.toLowerCase());
              return (
                <button
                  key={`${revision}:${material.name}`}
                  type="button"
                  class="material-tile"
                  aria-pressed={
                    material.name.toLowerCase() === current.toLowerCase()
                  }
                  aria-label={material.name}
                  title={`${material.logicalWidth ?? material.width}×${material.logicalHeight ?? material.height} · ${usage ? `${usage.faceCount} faces in ${usage.brushCount} brushes` : "Unused"} · ${material.sourceName}`}
                  mix={on("click", () => select(material.name))}
                >
                  <canvas
                    width={THUMBNAIL_SIZE}
                    height={THUMBNAIL_SIZE}
                    mix={ref((node: HTMLCanvasElement) =>
                      drawThumbnail(node, material),
                    )}
                  />
                  <span>{material.name}</span>
                </button>
              );
            })}
            {!visible.length && (
              <p>
                {materials.length
                  ? "No materials match this view"
                  : "Open a project to load materials"}
              </p>
            )}
          </div>
          <button
            id="material-more"
            type="button"
            hidden={visible.length <= visibleLimit}
            mix={on("click", () => {
              visibleLimit += PAGE_SIZE;
              handle.update();
            })}
          >
            Show more materials ({Math.max(0, visible.length - visibleLimit)}{" "}
            remaining)
          </button>
          <div class="material-browser-actions">
            <label for="material-current">Current material</label>
            <input
              id="material-current"
              type="text"
              list="material-choices"
              value={current}
              mix={on<HTMLInputElement>("input", (event) =>
                select(event.currentTarget.value),
              )}
            />
            <button
              id="material-apply"
              type="button"
              mix={on("click", () =>
                perform((state) => {
                  if (!current.trim() || !state.session().selection) {
                    state.status(
                      "Select a brush or face and choose a material first",
                    );
                    return;
                  }
                  if (!state.session().applyMaterial(current.trim()))
                    state.status(`Selection already uses ${current.trim()}`);
                }),
              )}
            >
              Apply
            </button>
            <button
              id="material-sample"
              type="button"
              mix={on("click", sample)}
            >
              Sample selection
            </button>
            <button
              id="material-select-faces"
              type="button"
              mix={on("click", () => selectUses("faces"))}
            >
              Select faces
            </button>
            <button
              id="material-select-brushes"
              type="button"
              mix={on("click", () => selectUses("brushes"))}
            >
              Select brushes
            </button>
            <button
              id="material-copy-name"
              type="button"
              mix={on("click", () => void copyName())}
            >
              Copy name
            </button>
          </div>
          <div class="material-replace-controls">
            <p id="material-replace-scope">{replaceScope}</p>
            <label for="material-replace-source">Find</label>
            <input
              id="material-replace-source"
              type="text"
              list="material-choices"
              value={replaceSource}
              mix={on<HTMLInputElement>("input", (event) => {
                replaceSource = event.currentTarget.value;
                handle.update();
              })}
            />
            <label for="material-replace-target">Replace with</label>
            <input
              id="material-replace-target"
              type="text"
              list="material-choices"
              value={replaceTarget}
              mix={on<HTMLInputElement>("input", (event) => {
                replaceTarget = event.currentTarget.value;
                handle.update();
              })}
            />
            <button
              id="material-replace"
              type="button"
              disabled={!canReplace}
              mix={on("click", () =>
                perform((state) => {
                  const from = replaceSource.trim();
                  const to = replaceTarget.trim();
                  if (!from || !to || from.toLowerCase() === to.toLowerCase())
                    return;
                  const changed = state.session().replaceMaterial(from, to);
                  state.status(
                    changed
                      ? `Replaced ${changed} faces using ${from} with ${to}`
                      : `No ${from} faces match the replacement scope`,
                  );
                }),
              )}
            >
              Replace material uses
            </button>
          </div>
        </details>
      );
    };
  },
);
