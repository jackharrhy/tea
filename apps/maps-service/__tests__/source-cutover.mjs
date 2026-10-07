import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const app = fileURLToPath(new URL("..", import.meta.url));
const teaRoot = fileURLToPath(new URL("../../..", import.meta.url));
const { values } = parseArgs({
  options: {
    "source-app": {
      type: "string",
      default: resolve(teaRoot, "../worldview/apps/worldview-service"),
    },
    "keep-state": { type: "boolean", default: false },
  },
});
const state = await mkdtemp(join(tmpdir(), "tea-maps-service-cutover-"));
const sourceRoot = join(state, "source");
const teaRootCopy = join(state, "tea");

try {
  const sourceApp = resolve(values["source-app"]);
  const { WorldviewDatabase: SourceDatabase } = await import(
    pathToFileURL(join(sourceApp, "dist/database.js"))
  );
  const { FileBlobStore: SourceBlobs } = await import(
    pathToFileURL(join(sourceApp, "dist/blob-store.js"))
  );
  const { WorldviewDatabase: TeaDatabase } = await import(
    new URL("../dist/database.js", import.meta.url)
  );
  const { FileBlobStore: TeaBlobs } = await import(
    new URL("../dist/blob-store.js", import.meta.url)
  );

  await mkdir(sourceRoot);
  await mkdir(teaRootCopy);
  const original = new SourceDatabase(join(sourceRoot, "maps.db"));
  const owner = original.upsertUser({
    fourmSub: "cutover-owner",
    username: "owner",
    displayName: "Original owner",
    isAdmin: false,
  });
  const editor = original.upsertUser({
    fourmSub: "cutover-editor",
    username: "editor",
    displayName: "Original editor",
    isAdmin: false,
  });
  const session = original.createSession(owner.id);
  const project = original.createProject(owner.id, "Original project", "quake");
  assert.equal(
    original.setProjectMemberRole(project.id, owner.id, editor.id, "editor"),
    true,
  );
  const map = original.createMap({
    id: original.createMapId(),
    projectId: project.id,
    userId: owner.id,
    name: "original.map",
    format: "quake",
  });
  const bytes = Buffer.from("Original Worldview resource bytes\n");
  const originalBlobs = new SourceBlobs(join(sourceRoot, "blobs"));
  const stored = await originalBlobs.put(bytes);
  const mount = original.createResourceMount({
    projectId: project.id,
    userId: owner.id,
    provider: "upload",
    providerAssetId: stored.sha256,
    expectedSha256: stored.sha256,
    kind: "texture-pack",
    displayName: "original.wad",
    size: stored.size,
    metadata: {},
  });
  assert.ok(mount);
  const build = original.createBuild({
    mapId: map.id,
    userId: owner.id,
    mapVersion: 1,
    profileId: "quake-preview",
    quality: "preview",
  });
  original.updateBuild(build.id, "failed");
  original.close();

  await copyFile(join(sourceRoot, "maps.db"), join(teaRootCopy, "maps.db"));
  const copiedBlob = join(
    teaRootCopy,
    "blobs",
    stored.sha256.slice(0, 2),
    stored.sha256.slice(2),
  );
  await mkdir(join(teaRootCopy, "blobs", stored.sha256.slice(0, 2)), {
    recursive: true,
  });
  await copyFile(
    join(
      sourceRoot,
      "blobs",
      stored.sha256.slice(0, 2),
      stored.sha256.slice(2),
    ),
    copiedBlob,
  );
  const comparison = spawnSync(
    process.execPath,
    [join(app, "scripts/compare-data.mjs"), sourceRoot, teaRootCopy],
    { encoding: "utf8" },
  );
  assert.equal(comparison.status, 0, comparison.stdout || comparison.stderr);
  assert.equal(JSON.parse(comparison.stdout).status, "passed");

  const tea = new TeaDatabase(join(teaRootCopy, "maps.db"));
  assert.equal(tea.sessionUser(session.token)?.id, owner.id);
  assert.deepEqual(
    tea.listProjects(editor.id).map(({ id }) => id),
    [project.id],
  );
  assert.equal(tea.project(project.id, owner.id)?.maps[0]?.id, map.id);
  assert.equal(tea.map(map.id, editor.id)?.role, "editor");
  assert.equal(
    tea.listResourceMounts(project.id, editor.id)?.[0]?.id,
    mount.id,
  );
  assert.equal(tea.build(map.id, build.id, owner.id)?.status, "failed");
  const teaBlobs = new TeaBlobs(join(teaRootCopy, "blobs"));
  assert.deepEqual(await teaBlobs.get(stored.sha256), bytes);

  tea.createMap({
    id: tea.createMapId(),
    projectId: project.id,
    userId: editor.id,
    name: "tea-only.map",
    format: "quake",
  });
  assert.equal(tea.project(project.id, owner.id)?.maps.length, 2);
  tea.close();

  const sourceAgain = new SourceDatabase(join(sourceRoot, "maps.db"));
  assert.equal(sourceAgain.project(project.id, owner.id)?.maps.length, 1);
  sourceAgain.close();
  console.log(
    JSON.stringify({
      status: "passed",
      sourceProjectId: project.id,
      sourceMapId: map.id,
      checks: [
        "original users, membership, project, map, resource and build",
        "stopped database and blob copy compares exactly",
        "Tea reads original IDs, session, roles, resource bytes and build",
        "Tea-only map leaves original source unchanged",
      ],
      state: values["keep-state"] ? state : undefined,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({ status: "failed", state, error: String(error) }),
  );
  process.exitCode = 1;
} finally {
  if (process.exitCode !== 1 && !values["keep-state"])
    await rm(state, { recursive: true, force: true });
}
