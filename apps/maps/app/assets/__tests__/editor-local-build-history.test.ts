import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { beforeEach, describe, expect, it } from "vitest";
import type { MapCompileResult } from "@tea/maps-editor/core";
import {
  listLocalBuilds,
  recordLocalBuild,
} from "../editor-local-build-history.ts";

function build(id: string): MapCompileResult {
  return {
    backend: "remote",
    status: "succeeded",
    buildId: id,
    sourceDocumentRevision: 4,
    diagnostics: [],
    logs: [],
    elapsedMilliseconds: 8,
    artifacts: [
      {
        name: "test.bsp",
        mediaType: "application/x-quake-bsp",
        kind: "bsp",
        data: Uint8Array.of(1, 2, 3).buffer,
      },
    ],
  };
}

beforeEach(async () => {
  await deleteDB("tea-maps-local-builds");
});

describe("local build history", () => {
  it("retains artifact bytes across database reopen and separates maps", async () => {
    await recordLocalBuild("project:alpha", build("shared-id"));
    await recordLocalBuild("project:beta", build("shared-id"));

    const alpha = await listLocalBuilds("project:alpha");
    expect(alpha).toHaveLength(1);
    expect(alpha[0]?.result.buildId).toBe("shared-id");
    expect(new Uint8Array(alpha[0]!.result.artifacts[0]!.data)).toEqual(
      Uint8Array.of(1, 2, 3),
    );
    expect(await listLocalBuilds("project:beta")).toHaveLength(1);
  });

  it("keeps the newest twenty builds for each map", async () => {
    for (let index = 0; index < 22; index++)
      await recordLocalBuild("project:alpha", build(`build-${index}`));

    const records = await listLocalBuilds("project:alpha");
    expect(records).toHaveLength(20);
    expect(records[0]?.result.buildId).toBe("build-21");
    expect(records.at(-1)?.result.buildId).toBe("build-2");
  });
});
