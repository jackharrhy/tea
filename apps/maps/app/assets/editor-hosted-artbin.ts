import type { HostedProject } from "@tea/maps-protocol";
import {
  mountHostedAsset,
  searchHostedAssets,
} from "./editor-hosted-resources.ts";

const MAX_RESOURCE_BYTES = 512 * 1024 * 1024;

export function initHostedArtbin(options: {
  mounted(projectId: string): Promise<void>;
}) {
  const panel = document.querySelector<HTMLElement>("#hosted-artbin-import")!;
  const form = document.querySelector<HTMLFormElement>(
    "#hosted-artbin-search",
  )!;
  const query = document.querySelector<HTMLInputElement>(
    "#hosted-artbin-query",
  )!;
  const status = document.querySelector<HTMLElement>("#hosted-artbin-status")!;
  const results = document.querySelector<HTMLUListElement>(
    "#hosted-artbin-results",
  )!;
  const next = document.querySelector<HTMLButtonElement>(
    "#hosted-artbin-next",
  )!;
  let project: HostedProject | null = null;
  let nextCursor: string | null = null;
  let generation = 0;

  async function search(cursor: string | null) {
    const selected = project;
    if (!selected || selected.role !== "owner") return;
    const value = query.value.trim();
    if (!value) {
      status.textContent = "Enter a name to search Artbin";
      return;
    }
    const version = ++generation;
    next.disabled = true;
    status.textContent = "Searching Artbin";
    try {
      const response = await searchHostedAssets(value, cursor);
      if (version !== generation || project?.id !== selected.id) return;
      if (!cursor) results.replaceChildren();
      for (const asset of response.assets) {
        const row = document.createElement("li");
        const name = document.createElement("strong");
        name.textContent = asset.name;
        const detail = document.createElement("small");
        detail.textContent = `${asset.kind} · ${Math.ceil(asset.size / 1024)} KiB`;
        const importButton = document.createElement("button");
        importButton.type = "button";
        importButton.textContent = "Import copy";
        importButton.disabled =
          !asset.sha256 || asset.size > MAX_RESOURCE_BYTES;
        if (importButton.disabled) {
          importButton.title = asset.sha256
            ? "Asset exceeds the 512 MiB project resource limit"
            : "Asset has no stable SHA-256";
        }
        importButton.addEventListener("click", async () => {
          if (project?.id !== selected.id) return;
          importButton.disabled = true;
          status.textContent = `Importing ${asset.name}`;
          try {
            await mountHostedAsset(selected.id, asset.id);
            if (project?.id !== selected.id) return;
            await options.mounted(selected.id);
            status.textContent = `Imported ${asset.name} into this project`;
          } catch (error) {
            status.textContent =
              error instanceof Error ? error.message : String(error);
            importButton.disabled = false;
          }
        });
        row.append(name, detail, importButton);
        results.append(row);
      }
      nextCursor = response.nextCursor;
      next.hidden = !nextCursor;
      next.disabled = !nextCursor;
      status.textContent = response.assets.length
        ? `Showing ${results.children.length} Artbin assets`
        : cursor
          ? "No more Artbin assets"
          : "No Artbin assets match this search";
    } catch (error) {
      if (version !== generation || project?.id !== selected.id) return;
      status.textContent =
        error instanceof Error ? error.message : String(error);
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void search(null);
  });
  next.addEventListener("click", () => {
    if (nextCursor) void search(nextCursor);
  });

  return {
    setProject(value: HostedProject | null) {
      generation++;
      project = value;
      panel.hidden = value?.role !== "owner";
      results.replaceChildren();
      status.textContent = "";
      nextCursor = null;
      next.hidden = true;
    },
  };
}
