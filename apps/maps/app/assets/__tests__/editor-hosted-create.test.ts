import { createStarterDocument, serializeMap } from "@tea/maps-editor/core";
import { expect, it, vi } from "vitest";
import {
  createHostedMap,
  createHostedProject,
} from "../editor-hosted-create.ts";

it("creates a project and uploads a matching map through the hosted API", async () => {
  const document = createStarterDocument();
  const source = serializeMap(document);
  const fetcher = vi.fn<typeof fetch>(async (path, init) => {
    expect(init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    });
    if (path === "/api/projects") {
      expect(JSON.parse(String(init?.body))).toEqual({
        name: "Tea maps",
        game: "quake",
      });
      return Response.json(
        {
          project: {
            id: "project-1",
            slug: "tea-maps",
            name: "Tea maps",
            game: "quake",
            role: "owner",
            updatedAt: 1,
          },
        },
        { status: 201 },
      );
    }
    expect(path).toBe("/api/projects/project-1/maps");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "first.map",
      format: "valve-220",
      source,
    });
    return Response.json(
      {
        map: {
          id: "map-1",
          slug: "first",
          name: "first.map",
          format: "valve-220",
          updatedAt: 1,
          mapId: "map-1",
          mapVersion: 0,
          document,
          source,
          sourceSha256: "a".repeat(64),
        },
      },
      { status: 201 },
    );
  });

  const project = await createHostedProject("Tea maps", "quake", fetcher);
  const map = await createHostedMap(
    project.id,
    project.game,
    "first.map",
    "valve-220",
    new File([source], "first.map", { type: "text/plain" }),
    fetcher,
  );
  expect(map.id).toBe("map-1");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("rejects incompatible source before creating a hosted map", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const classicSource =
    '{\n"classname" "worldspawn"\n{\n( 0 0 0 ) ( 0 64 0 ) ( 0 0 64 ) STONE 0 0 0 1 1\n}\n}\n';
  await expect(
    createHostedMap(
      "project-1",
      "goldsrc",
      "classic.map",
      "valve-220",
      new File([classicSource], "classic.map"),
      fetcher,
    ),
  ).rejects.toThrow(/face syntax/);
  expect(fetcher).not.toHaveBeenCalled();
});
