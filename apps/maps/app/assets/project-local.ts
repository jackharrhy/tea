import {
  parseWorldviewProject,
  type WorldviewProjectManifest,
} from "@tea/maps-editor/core";
import type { HostedProject } from "@tea/maps-protocol";
import { pickProjectDirectory, projectFile } from "./editor-project.ts";
import { rememberRecentProject } from "./editor-recent-projects.ts";

export function validateLinkedLocalProject(
  manifest: WorldviewProjectManifest,
  project: HostedProject,
  origin: string,
) {
  if (manifest.game !== project.game)
    throw new Error(
      `This folder is a ${manifest.game} project; ${project.name} uses ${project.game}.`,
    );
  if (
    manifest.hosted &&
    (manifest.hosted.projectId !== project.id ||
      manifest.hosted.origin !== origin)
  )
    throw new Error(
      "This folder is linked to a different hosted project or origin.",
    );
}

export async function openLinkedLocalProject(
  project: HostedProject,
): Promise<string | null> {
  if (!("showDirectoryPicker" in window))
    throw new Error("Project folders require Chromium File System Access");
  let handle;
  try {
    handle = await pickProjectDirectory();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      return null;
    throw error;
  }
  if (!handle) return null;
  const manifest = parseWorldviewProject(
    await (await projectFile(handle, "worldview.project.json")).text(),
  );
  validateLinkedLocalProject(manifest, project, location.origin);
  return (await rememberRecentProject(handle, manifest.name)).id;
}
