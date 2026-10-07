import { parseWorldviewProject } from "@tea/maps-editor/core";
import type { HostedProject } from "@tea/maps-protocol";
import { describe, expect, it } from "vitest";
import { validateLinkedLocalProject } from "../project-local.ts";

const project: HostedProject = {
  id: "abcdefghijkl",
  slug: "smoke-project",
  name: "Smoke Project",
  game: "quake",
  role: "owner",
  updatedAt: 0,
  maps: [],
};

function manifest(
  game: string,
  hosted?: { origin: string; projectId: string },
) {
  return parseWorldviewProject(
    JSON.stringify({
      schemaVersion: 1,
      name: "Local Project",
      game,
      mapRoots: ["."],
      resources: {},
      ...(hosted ? { hosted: { ...hosted, maps: [] } } : {}),
    }),
  );
}

describe("hosted project local folder validation", () => {
  it("accepts matching unlinked and linked folders", () => {
    expect(() =>
      validateLinkedLocalProject(
        manifest("quake"),
        project,
        "https://maps.tea.test",
      ),
    ).not.toThrow();
    expect(() =>
      validateLinkedLocalProject(
        manifest("quake", {
          origin: "https://maps.tea.test",
          projectId: project.id,
        }),
        project,
        "https://maps.tea.test",
      ),
    ).not.toThrow();
  });

  it("rejects a different game or hosted identity", () => {
    expect(() =>
      validateLinkedLocalProject(
        manifest("goldsrc"),
        project,
        "https://maps.tea.test",
      ),
    ).toThrow("goldsrc project");
    expect(() =>
      validateLinkedLocalProject(
        manifest("quake", {
          origin: "https://other.tea.test",
          projectId: project.id,
        }),
        project,
        "https://maps.tea.test",
      ),
    ).toThrow("different hosted project or origin");
    expect(() =>
      validateLinkedLocalProject(
        manifest("quake", {
          origin: "https://maps.tea.test",
          projectId: "mnopqrstuvwx",
        }),
        project,
        "https://maps.tea.test",
      ),
    ).toThrow("different hosted project or origin");
  });
});
