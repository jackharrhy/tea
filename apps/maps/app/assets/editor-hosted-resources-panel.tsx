import {
  type HostedAsset,
  type HostedProject,
  type HostedResourceMount,
} from "@tea/maps-protocol";
import { clientEntry, on, ref, type Handle } from "remix/component";
import {
  listHostedResources,
  mountHostedAsset,
  removeHostedResource,
  resourceUploads,
  searchHostedAssets,
  uploadHostedResource,
} from "./editor-hosted-resources.ts";
import type { EditorHostedResourcesContext } from "./editor-hosted-resources-bridge.ts";

const MAX_RESOURCE_BYTES = 512 * 1024 * 1024;

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

export const EditorHostedResources = clientEntry(
  `${import.meta.url}#EditorHostedResources`,
  function EditorHostedResourcesComponent(handle: Handle) {
    let context: EditorHostedResourcesContext | null = null;
    let project: HostedProject | null = null;
    let mounts: readonly HostedResourceMount[] = [];
    let assets: readonly HostedAsset[] = [];
    let loaded = false;
    let resourceStatus = "";
    let artbinStatus = "";
    let query = "";
    let nextCursor: string | null = null;
    let resourceBusy = false;
    let artbinBusy = false;
    let generation = 0;
    let searchGeneration = 0;
    let filesInput: HTMLInputElement | null = null;
    let folderInput: HTMLInputElement | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-hosted-resources-bridge-ready",
        () =>
          window.dispatchEvent(new Event("tea-maps-hosted-resources-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-hosted-resources-state",
        (event) => {
          const next = (event as CustomEvent<EditorHostedResourcesContext>)
            .detail;
          context = next;
          if (project?.id === next.project?.id) {
            project = next.project;
            handle.update();
            if (project && !resourceBusy && !artbinBusy)
              void refresh(project, ++generation);
            return;
          }
          project = next.project;
          const request = ++generation;
          searchGeneration++;
          mounts = [];
          assets = [];
          loaded = false;
          resourceStatus = "";
          artbinStatus = "";
          nextCursor = null;
          resourceBusy = false;
          artbinBusy = false;
          handle.update();
          if (project) void refresh(project, request);
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-hosted-resources-ready"));
    });

    async function refresh(selected: HostedProject, request = generation) {
      resourceStatus = "Loading project resources";
      handle.update();
      try {
        const next = await listHostedResources(
          selected.id,
          fetch,
          handle.signal,
        );
        if (request !== generation || handle.signal.aborted) return;
        mounts = next;
        loaded = true;
        resourceStatus = "";
      } catch (cause) {
        if (request === generation && !handle.signal.aborted)
          resourceStatus = message(cause);
      }
      if (request === generation && !handle.signal.aborted) handle.update();
    }

    async function upload(folder: boolean) {
      const selected = project;
      const input = folder ? folderInput : filesInput;
      if (!selected || selected.role !== "owner" || !input || resourceBusy)
        return;
      const files = [...(input.files ?? [])];
      if (!files.length) return;
      let uploads: ReturnType<typeof resourceUploads>;
      try {
        uploads = resourceUploads(files, folder);
      } catch (cause) {
        resourceStatus = message(cause);
        handle.update();
        return;
      }
      const request = generation;
      resourceBusy = true;
      handle.update();
      try {
        for (const [index, item] of uploads.entries()) {
          resourceStatus = `Uploading ${index + 1} of ${uploads.length}: ${item.name}`;
          handle.update();
          await uploadHostedResource(selected.id, item);
        }
        input.value = "";
        context?.resourcesChanged(selected.id);
        if (request === generation) {
          await refresh(selected, request);
          if (!handle.signal.aborted)
            resourceStatus += ` · uploaded ${uploads.length}`;
        }
      } catch (cause) {
        if (request === generation) resourceStatus = message(cause);
      } finally {
        if (request === generation && !handle.signal.aborted) {
          resourceBusy = false;
          handle.update();
        }
      }
    }

    async function remove(mount: HostedResourceMount) {
      const selected = project;
      if (!selected || selected.role !== "owner" || resourceBusy) return;
      const request = generation;
      resourceBusy = true;
      handle.update();
      try {
        await removeHostedResource(selected.id, mount.id);
        context?.resourcesChanged(selected.id);
        if (request === generation) await refresh(selected, request);
      } catch (cause) {
        if (request === generation) resourceStatus = message(cause);
      } finally {
        if (request === generation && !handle.signal.aborted) {
          resourceBusy = false;
          handle.update();
        }
      }
    }

    async function search(cursor: string | null) {
      const selected = project;
      const value = query.trim();
      if (!selected || selected.role !== "owner" || artbinBusy) return;
      if (!value) {
        artbinStatus = "Enter a name to search Artbin";
        handle.update();
        return;
      }
      const request = ++searchGeneration;
      artbinBusy = true;
      artbinStatus = "Searching Artbin";
      handle.update();
      try {
        const result = await searchHostedAssets(value, cursor);
        if (
          request !== searchGeneration ||
          project?.id !== selected.id ||
          handle.signal.aborted
        )
          return;
        assets = cursor ? [...assets, ...result.assets] : result.assets;
        nextCursor = result.nextCursor;
        artbinStatus = result.assets.length
          ? `Showing ${assets.length} Artbin assets`
          : cursor
            ? "No more Artbin assets"
            : "No Artbin assets match this search";
      } catch (cause) {
        if (request === searchGeneration) artbinStatus = message(cause);
      } finally {
        if (request === searchGeneration && !handle.signal.aborted) {
          artbinBusy = false;
          handle.update();
        }
      }
    }

    async function importAsset(asset: HostedAsset) {
      const selected = project;
      if (!selected || selected.role !== "owner" || artbinBusy) return;
      const request = generation;
      artbinBusy = true;
      artbinStatus = `Importing ${asset.name}`;
      handle.update();
      try {
        await mountHostedAsset(selected.id, asset.id);
        context?.resourcesChanged(selected.id);
        if (request === generation) {
          await refresh(selected, request);
          artbinStatus = `Imported ${asset.name} into this project`;
        }
      } catch (cause) {
        if (request === generation) artbinStatus = message(cause);
      } finally {
        if (request === generation && !handle.signal.aborted) {
          artbinBusy = false;
          handle.update();
        }
      }
    }

    return () => {
      const currentProject = project;
      const uniqueBytes = new Map(
        mounts.map((mount) => [mount.expectedSha256, mount.size]),
      );
      const totalBytes = [...uniqueBytes.values()].reduce(
        (sum, size) => sum + size,
        0,
      );
      return (
        <details id="hosted-project-resources" hidden={!currentProject}>
          <summary>Project resources</summary>
          <p id="hosted-resource-status" role="status">
            {resourceStatus ||
              `${mounts.length} resources · ${Math.ceil(totalBytes / (1024 * 1024))} / 1024 MiB`}
          </p>
          <ul id="hosted-resource-list">
            {loaded && mounts.length === 0 ? (
              <li>No project resources yet</li>
            ) : (
              mounts.map((mount) => (
                <li key={mount.id}>
                  <a
                    href={`/api/projects/${encodeURIComponent(currentProject!.id)}/resources/${encodeURIComponent(mount.id)}/content`}
                    download={mount.displayName}
                    data-rmx-document
                  >
                    {mount.displayName}
                  </a>
                  <small>
                    {mount.kind} · {Math.ceil(mount.size / 1024)} KiB
                  </small>
                  {currentProject?.role === "owner" && (
                    <button
                      type="button"
                      aria-label={`Remove ${mount.displayName}`}
                      disabled={resourceBusy}
                      mix={on("click", () => void remove(mount))}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))
            )}
          </ul>
          <div
            id="hosted-resource-upload"
            hidden={currentProject?.role !== "owner"}
          >
            <label for="hosted-resource-files">Upload project files</label>
            <input
              id="hosted-resource-files"
              type="file"
              multiple
              accept=".wad,.lmp,.pcx,.fgd,.def,.ent,.spr"
              mix={ref((node: HTMLInputElement) => {
                filesInput = node;
              })}
            />
            <button
              id="hosted-resource-upload-button"
              type="button"
              disabled={resourceBusy}
              mix={on("click", () => void upload(false))}
            >
              Upload files
            </button>
            <label for="hosted-resource-folder">Game asset folder</label>
            <input
              id="hosted-resource-folder"
              type="file"
              multiple
              mix={ref((node: HTMLInputElement) => {
                folderInput = node;
                node.setAttribute("webkitdirectory", "");
              })}
            />
            <button
              id="hosted-resource-folder-button"
              type="button"
              disabled={resourceBusy}
              mix={on("click", () => void upload(true))}
            >
              Upload folder assets
            </button>
            <small>
              Up to 512 MiB per file. Files are copied into this project.
            </small>
          </div>
          <div
            id="hosted-artbin-import"
            hidden={currentProject?.role !== "owner"}
          >
            <form
              id="hosted-artbin-search"
              mix={on<HTMLFormElement>("submit", (event) => {
                event.preventDefault();
                void search(null);
              })}
            >
              <label for="hosted-artbin-query">Import from Artbin</label>
              <input
                id="hosted-artbin-query"
                type="search"
                placeholder="WAD, palette, texture…"
                value={query}
                mix={on<HTMLInputElement>("input", (event) => {
                  query = event.currentTarget.value;
                })}
              />
              <button type="submit" disabled={artbinBusy}>
                Search Artbin
              </button>
            </form>
            <p id="hosted-artbin-status" role="status">
              {artbinStatus}
            </p>
            <ul id="hosted-artbin-results">
              {assets.map((asset) => (
                <li key={asset.id}>
                  <strong>{asset.name}</strong>
                  <small>
                    {asset.kind} · {Math.ceil(asset.size / 1024)} KiB
                  </small>
                  <button
                    type="button"
                    disabled={
                      artbinBusy ||
                      !asset.sha256 ||
                      asset.size > MAX_RESOURCE_BYTES
                    }
                    title={
                      !asset.sha256
                        ? "Asset has no stable SHA-256"
                        : asset.size > MAX_RESOURCE_BYTES
                          ? "Asset exceeds the 512 MiB project resource limit"
                          : undefined
                    }
                    mix={on("click", () => void importAsset(asset))}
                  >
                    Import copy
                  </button>
                </li>
              ))}
            </ul>
            <button
              id="hosted-artbin-next"
              type="button"
              hidden={!nextCursor}
              disabled={!nextCursor || artbinBusy}
              mix={on("click", () => void search(nextCursor))}
            >
              More results
            </button>
          </div>
        </details>
      );
    };
  },
);
