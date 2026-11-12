import { expect, it, vi } from "vitest";
import {
  hostedBuildArtifactPath,
  listHostedBuilds,
  queueHostedBuild,
  waitForHostedBuild,
} from "../editor-hosted-builds.ts";

const queued = {
  id: "build-1",
  mapVersion: 4,
  profileId: "default",
  quality: "preview" as const,
  status: "queued" as const,
  sourceSha256: "a".repeat(64),
  result: null,
  createdAt: 1,
  updatedAt: 1,
};

it("queues the reviewed map version and watches its hosted build to completion", async () => {
  let polls = 0;
  const succeeded = {
    ...queued,
    status: "succeeded" as const,
    updatedAt: 3,
    result: {
      elapsedMilliseconds: 2000,
      artifacts: [
        {
          name: "first.bsp",
          kind: "bsp",
          mediaType: "application/octet-stream",
          sha256: "b".repeat(64),
          size: 128,
        },
      ],
    },
  };
  const fetcher = vi.fn<typeof fetch>(async (path, init) => {
    expect(path).toBe("/api/maps/map-1/builds");
    expect(init?.credentials).toBe("same-origin");
    if (init?.method === "POST") {
      expect(JSON.parse(String(init.body))).toEqual({
        quality: "preview",
        expectedMapVersion: 4,
      });
      return Response.json({ build: queued }, { status: 202 });
    }
    polls++;
    return Response.json({
      builds: [
        polls === 1
          ? { ...queued, status: "running", updatedAt: 2 }
          : succeeded,
      ],
      capability: { profileId: "default" },
    });
  });

  const created = await queueHostedBuild("map-1", "preview", 4, fetcher);
  const updates: string[] = [];
  const completed = await waitForHostedBuild("map-1", created, {
    fetcher,
    signal: new AbortController().signal,
    pollIntervalMilliseconds: 1,
    onUpdate(build) {
      updates.push(build.status);
    },
  });
  expect(completed.status).toBe("succeeded");
  expect(updates).toEqual(["running", "succeeded"]);
  expect(hostedBuildArtifactPath("map-1", completed.id, "b".repeat(64))).toBe(
    `/api/maps/map-1/builds/build-1/artifacts/${"b".repeat(64)}`,
  );
  expect((await listHostedBuilds("map-1", fetcher)).capability).toMatchObject({
    profileId: "default",
  });
});

it("stops polling when the map changes", async () => {
  const controller = new AbortController();
  controller.abort(new Error("Map changed"));
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    waitForHostedBuild("map-1", queued, {
      fetcher,
      signal: controller.signal,
      pollIntervalMilliseconds: 1,
    }),
  ).rejects.toThrow("Map changed");
  expect(fetcher).not.toHaveBeenCalled();
});
