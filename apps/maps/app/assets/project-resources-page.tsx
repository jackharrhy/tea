import {
  HostedProjectResponseSchema,
  HostedSessionResponseSchema,
  type HostedAsset,
  type HostedProject,
  type HostedResourceMount,
} from "@tea/maps-protocol";
import { clientEntry, on, type Handle } from "remix/component";
import {
  listHostedResources,
  mountHostedAsset,
  removeHostedResource,
  resourceUploads,
  searchHostedAssets,
  uploadHostedResource,
} from "./editor-hosted-resources.ts";
import { readHostedApi } from "./hosted-api.ts";
import { ProjectDetailHeader } from "./project-detail-header.tsx";

const MAX_RESOURCE_BYTES = 512 * 1024 * 1024;

export const ProjectResources = clientEntry(
  `${import.meta.url}#ProjectResources`,
  function ProjectResourcesComponent(handle: Handle<{ projectId: string }>) {
    let project: HostedProject | null = null;
    let mounts: readonly HostedResourceMount[] = [];
    let assets: readonly HostedAsset[] = [];
    let signInRequired = false;
    let loaded = false;
    let status = "Loading project…";
    let resourceStatus = "Loading project resources";
    let artbinStatus = "";
    let artbinQuery = "";
    let nextCursor: string | null = null;
    let resourceBusy = false;
    let artbinBusy = false;

    handle.queueTask(() => {
      void (async () => {
        try {
          const session = await readHostedApi(
            "/api/session",
            HostedSessionResponseSchema,
          );
          if (!session.user) {
            signInRequired = true;
            status = "Sign in to open this project";
          } else {
            const response = await readHostedApi(
              `/api/projects/${encodeURIComponent(handle.props.projectId)}`,
              HostedProjectResponseSchema,
            );
            project = response.project;
            document.title = `${project.name} · Maps · Tea`;
            status = "";
            handle.update();
            await refresh();
          }
        } catch (cause) {
          status = message(cause);
        }
        handle.update();
      })();
    });

    async function refresh() {
      if (!project) return;
      mounts = await listHostedResources(project.id);
      loaded = true;
      resourceStatus = "";
      handle.update();
    }

    async function remove(mount: HostedResourceMount) {
      if (!project || project.role !== "owner" || resourceBusy) return;
      resourceBusy = true;
      resourceStatus = `Removing ${mount.displayName}`;
      handle.update();
      try {
        await removeHostedResource(project.id, mount.id);
        await refresh();
      } catch (cause) {
        resourceStatus = message(cause);
      } finally {
        resourceBusy = false;
        handle.update();
      }
    }

    async function upload(inputId: string, fromFolder: boolean) {
      if (!project || project.role !== "owner" || resourceBusy) return;
      const input = document.querySelector<HTMLInputElement>(`#${inputId}`);
      if (!input?.files?.length) return;
      resourceBusy = true;
      handle.update();
      try {
        const selected = resourceUploads([...input.files], fromFolder);
        for (const [index, item] of selected.entries()) {
          resourceStatus = `Uploading ${index + 1} of ${selected.length}: ${item.name}`;
          handle.update();
          await uploadHostedResource(project.id, item);
        }
        input.value = "";
        await refresh();
      } catch (cause) {
        resourceStatus = message(cause);
      } finally {
        resourceBusy = false;
        handle.update();
      }
    }

    async function search(cursor: string | null) {
      if (!project || project.role !== "owner" || artbinBusy) return;
      const query = document
        .querySelector<HTMLInputElement>("#hosted-artbin-query")
        ?.value.trim();
      if (!query) {
        artbinStatus = "Enter a name to search Artbin";
        handle.update();
        return;
      }
      artbinBusy = true;
      artbinStatus = "Searching Artbin";
      handle.update();
      try {
        const response = await searchHostedAssets(query, cursor);
        assets = cursor ? [...assets, ...response.assets] : response.assets;
        artbinQuery = query;
        nextCursor = response.nextCursor;
        artbinStatus = response.assets.length
          ? `Showing ${assets.length} Artbin assets`
          : cursor
            ? "No more Artbin assets"
            : "No Artbin assets match this search";
      } catch (cause) {
        artbinStatus = message(cause);
      } finally {
        artbinBusy = false;
        handle.update();
      }
    }

    async function importAsset(asset: HostedAsset) {
      if (!project || project.role !== "owner" || artbinBusy) return;
      artbinBusy = true;
      artbinStatus = `Importing ${asset.name}`;
      handle.update();
      try {
        await mountHostedAsset(project.id, asset.id);
        await refresh();
        artbinStatus = `Imported ${asset.name} into this project`;
      } catch (cause) {
        artbinStatus = message(cause);
      } finally {
        artbinBusy = false;
        handle.update();
      }
    }

    return () => {
      const currentProject = project;
      const bytes = [
        ...new Map(
          mounts.map((mount) => [mount.expectedSha256, mount.size]),
        ).values(),
      ].reduce((sum, size) => sum + size, 0);
      return (
        <section class="project-detail">
          <p id="projects-status" role="status">
            {status}
          </p>
          {signInRequired ? (
            <a
              id="projects-login"
              href={`/auth/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
              data-rmx-document
            >
              Sign in
            </a>
          ) : null}
          {currentProject ? (
            <div>
              <ProjectDetailHeader
                project={currentProject}
                section="resources"
              />
              <h2>Resources</h2>
              <p>Project members can download mounted resources.</p>
              <p id="project-resource-status" role="status">
                {resourceStatus ||
                  `${mounts.length} resources · ${Math.ceil(bytes / (1024 * 1024))} / 1024 MiB`}
              </p>
              <div id="project-resource-list" class="project-list">
                {loaded && mounts.length === 0
                  ? "No project resources yet"
                  : mounts.map((mount) => (
                      <div class="project-row">
                        <a
                          href={`/api/projects/${encodeURIComponent(currentProject.id)}/resources/${encodeURIComponent(mount.id)}/content`}
                          download={mount.displayName}
                          data-rmx-document
                        >
                          {mount.displayName}
                        </a>
                        <small>
                          {mount.kind} · {Math.ceil(mount.size / 1024)} KiB
                        </small>
                        {currentProject.role === "owner" ? (
                          <button
                            type="button"
                            aria-label={`Remove ${mount.displayName}`}
                            disabled={resourceBusy}
                            mix={on("click", () => void remove(mount))}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    ))}
              </div>
              {currentProject.role === "owner" ? (
                <div>
                  <section id="project-resource-upload">
                    <label for="project-resource-files">Upload resources</label>
                    <input
                      id="project-resource-files"
                      type="file"
                      multiple
                      accept=".wad,.lmp,.pcx,.fgd,.def,.ent,.spr"
                    />
                    <button
                      id="project-resource-upload-button"
                      type="button"
                      disabled={resourceBusy}
                      mix={on(
                        "click",
                        () => void upload("project-resource-files", false),
                      )}
                    >
                      Upload files
                    </button>
                    <label for="project-resource-folder">
                      Game asset folder
                    </label>
                    <input
                      id="project-resource-folder"
                      type="file"
                      multiple
                      {...{ webkitdirectory: "" }}
                    />
                    <button
                      id="project-resource-folder-button"
                      type="button"
                      disabled={resourceBusy}
                      mix={on(
                        "click",
                        () => void upload("project-resource-folder", true),
                      )}
                    >
                      Upload folder
                    </button>
                  </section>
                  <section id="hosted-artbin-import" class="project-artbin">
                    <h3>Import from Artbin</h3>
                    <form
                      id="hosted-artbin-search"
                      mix={on<HTMLFormElement>("submit", (event) => {
                        event.preventDefault();
                        void search(null);
                      })}
                    >
                      <label for="hosted-artbin-query">Search assets</label>
                      <input
                        id="hosted-artbin-query"
                        type="search"
                        placeholder="WAD, palette, texture…"
                        defaultValue={artbinQuery}
                      />
                      <button type="submit" disabled={artbinBusy}>
                        Search Artbin
                      </button>
                    </form>
                    <p id="hosted-artbin-status" role="status">
                      {artbinStatus}
                    </p>
                    <ul id="hosted-artbin-results" class="project-list">
                      {assets.map((asset) => (
                        <li>
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
                    {nextCursor ? (
                      <button
                        id="hosted-artbin-next"
                        type="button"
                        disabled={artbinBusy}
                        mix={on("click", () => void search(nextCursor))}
                      >
                        Load more
                      </button>
                    ) : null}
                  </section>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      );
    };
  },
);

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
