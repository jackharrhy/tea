import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import {
  listRecentProjects,
  recentProject,
  rememberRecentProject,
  rememberRecentProjectMap,
} from "../editor-recent-projects.ts";
import type { MapDirectoryHandle } from "../editor-project.ts";

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("tea-maps-recent-projects");
    request.addEventListener("success", () => resolve());
    request.addEventListener("error", () => reject(request.error));
  });
});

it("remembers a project folder and its last opened map", async () => {
  const handle = {
    kind: "directory",
    name: "test-project",
  } as MapDirectoryHandle;
  const stored = await rememberRecentProject(handle, "Test project");
  await rememberRecentProjectMap(stored.id, "maps/start.map");

  expect(await recentProject(stored.id)).toMatchObject({
    name: "Test project",
    handle: { name: "test-project" },
    lastMapPath: "maps/start.map",
  });
  expect((await listRecentProjects()).map((record) => record.id)).toEqual([
    stored.id,
  ]);
});
