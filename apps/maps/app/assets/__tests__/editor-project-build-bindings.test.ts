import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  openProjectBuildBindings,
  type ProjectDirectoryIdentity,
} from "../editor-project-build-bindings.ts";

const databaseName = "tea-maps-project-build-bindings";

class DirectoryHandle implements ProjectDirectoryIdentity {
  readonly kind = "directory";
  readonly name = "maps";

  constructor(readonly identity: string) {}

  async isSameEntry(other: ProjectDirectoryIdentity): Promise<boolean> {
    return (other as DirectoryHandle).identity === this.identity;
  }
}

beforeEach(() => deleteDB(databaseName));
afterEach(() => deleteDB(databaseName));

it("remembers compiler capabilities by directory and logical profile", async () => {
  const first = await openProjectBuildBindings(new DirectoryHandle("first"));
  expect(first).not.toBeNull();
  const beforeBuild = await openProjectBuildBindings(
    new DirectoryHandle("first"),
  );
  expect(beforeBuild?.scopeId).toBe(first?.scopeId);
  await first!.remember("preview", "local-fast");
  await first!.remember("final", "local-quality");

  const reopened = await openProjectBuildBindings(new DirectoryHandle("first"));
  expect(reopened?.preferred("preview")).toBe("local-fast");
  expect(reopened?.preferred("final")).toBe("local-quality");

  const other = await openProjectBuildBindings(new DirectoryHandle("other"));
  expect(other?.preferred("preview")).toBeUndefined();
});
