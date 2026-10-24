import {
  parseMapsProject,
  type MapsProjectManifest,
} from "@tea/maps-editor/core";
import type { HostedProject } from "@tea/maps-protocol";
import {
  pickProjectDirectory,
  projectManifestFile,
  type MapDirectoryHandle,
} from "./editor-project.ts";
import { rememberRecentProject } from "./editor-recent-projects.ts";

async function pickLocalProject(): Promise<{
  handle: MapDirectoryHandle;
  manifest: MapsProjectManifest;
} | null> {
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
  const manifest = parseMapsProject(
    await (await projectManifestFile(handle)).file.text(),
  );
  return { handle, manifest };
}

export async function openLocalProject(): Promise<string | null> {
  const picked = await pickLocalProject();
  if (!picked) return null;
  return (await rememberRecentProject(picked.handle, picked.manifest.name)).id;
}

export function validateLinkedLocalProject(
  manifest: MapsProjectManifest,
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
  const picked = await pickLocalProject();
  if (!picked) return null;
  validateLinkedLocalProject(picked.manifest, project, location.origin);
  return (await rememberRecentProject(picked.handle, picked.manifest.name)).id;
}
