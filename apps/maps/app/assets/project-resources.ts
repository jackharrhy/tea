import type { HostedProject } from "@tea/maps-protocol";
import {
  listHostedResources,
  removeHostedResource,
  resourceUploads,
  uploadHostedResource,
} from "./editor-hosted-resources.ts";
import { initHostedArtbin } from "./editor-hosted-artbin.ts";

export async function showProjectResources(project: HostedProject) {
  const status = document.querySelector<HTMLElement>(
    "#project-resource-status",
  )!;
  const list = document.querySelector<HTMLElement>("#project-resource-list")!;
  const upload = document.querySelector<HTMLElement>(
    "#project-resource-upload",
  )!;
  const files = document.querySelector<HTMLInputElement>(
    "#project-resource-files",
  )!;
  const folder = document.querySelector<HTMLInputElement>(
    "#project-resource-folder",
  )!;
  const uploadFiles = document.querySelector<HTMLButtonElement>(
    "#project-resource-upload-button",
  )!;
  const uploadFolder = document.querySelector<HTMLButtonElement>(
    "#project-resource-folder-button",
  )!;
  folder.setAttribute("webkitdirectory", "");
  upload.hidden = project.role !== "owner";

  async function refresh() {
    status.textContent = "Loading project resources";
    const mounts = await listHostedResources(project.id);
    list.replaceChildren();
    const bytes = [
      ...new Map(
        mounts.map((mount) => [mount.expectedSha256, mount.size]),
      ).values(),
    ].reduce((sum, size) => sum + size, 0);
    status.textContent = `${mounts.length} resources · ${Math.ceil(bytes / (1024 * 1024))} / 1024 MiB`;
    if (!mounts.length) list.textContent = "No project resources yet";
    for (const mount of mounts) {
      const row = document.createElement("div");
      row.className = "project-row";
      const link = document.createElement("a");
      link.href = `/api/projects/${encodeURIComponent(project.id)}/resources/${encodeURIComponent(mount.id)}/content`;
      link.download = mount.displayName;
      link.textContent = mount.displayName;
      const detail = document.createElement("small");
      detail.textContent = `${mount.kind} · ${Math.ceil(mount.size / 1024)} KiB`;
      row.append(link, detail);
      if (project.role === "owner") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${mount.displayName}`);
        remove.addEventListener("click", async () => {
          remove.disabled = true;
          try {
            await removeHostedResource(project.id, mount.id);
            await refresh();
          } catch (error) {
            status.textContent =
              error instanceof Error ? error.message : String(error);
            remove.disabled = false;
          }
        });
        row.append(remove);
      }
      list.append(row);
    }
  }

  async function uploadSelected(input: HTMLInputElement, fromFolder: boolean) {
    if (!input.files?.length) return;
    uploadFiles.disabled = uploadFolder.disabled = true;
    try {
      const selected = resourceUploads([...input.files], fromFolder);
      for (const [index, item] of selected.entries()) {
        status.textContent = `Uploading ${index + 1} of ${selected.length}: ${item.name}`;
        await uploadHostedResource(project.id, item);
      }
      input.value = "";
      await refresh();
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      uploadFiles.disabled = uploadFolder.disabled = false;
    }
  }

  uploadFiles.addEventListener(
    "click",
    () => void uploadSelected(files, false),
  );
  uploadFolder.addEventListener(
    "click",
    () => void uploadSelected(folder, true),
  );
  initHostedArtbin({ mounted: async () => refresh() }).setProject(project);
  await refresh();
}
