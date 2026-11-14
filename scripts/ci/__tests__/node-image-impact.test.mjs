import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  nodeImageApps,
  selectNodeImages,
  selectNodeImagesFromCommits,
} from "../node-image-impact.mjs";

const broad = ["cms", "maps-service", "maps-compiler"];
function fixture() {
  const packages = Object.fromEntries([
    ["", {}],
    ...nodeImageApps.map((app) => [`apps/${app}`, {}]),
    ["apps/unrelated", {}],
    ["packages/shared", {}],
    ["packages/bridge", { dependencies: { shared: "*" } }],
    ["packages/extra-copy", {}],
    ["node_modules/shared", { link: true, resolved: "packages/shared" }],
    ["node_modules/bridge", { link: true, resolved: "packages/bridge" }],
  ]);
  packages["apps/auth"] = { dependencies: { bridge: "*" } };
  const beforeLock = { packages };
  return {
    beforeLock,
    afterLock: structuredClone(beforeLock),
    dockerfiles: Object.fromEntries(
      nodeImageApps.map((app) => [
        app,
        broad.includes(app) ? "COPY . ." : `COPY apps/${app} ./apps/${app}`,
      ]),
    ),
  };
}
const ordered = (...apps) => nodeImageApps.filter((app) => apps.includes(app));

test("app-only changes avoid unrelated narrow images but retain whole-context images", () => {
  assert.deepEqual(
    selectNodeImages({ ...fixture(), paths: ["apps/8mb/server.ts"] }),
    ordered(...broad, "8mb"),
  );
  assert.deepEqual(
    selectNodeImages({ ...fixture(), paths: ["apps/unrelated/source.ts"] }),
    broad,
  );
});

test("shared source reaches transitive consumers from either lock revision", () => {
  for (const removed of [false, true]) {
    const f = fixture();
    if (removed) f.afterLock.packages["apps/auth"] = {};
    else f.beforeLock.packages["apps/auth"] = {};
    assert.deepEqual(
      selectNodeImages({ ...f, paths: ["packages/shared/index.ts"] }),
      ordered(...broad, "auth"),
    );
  }
});

test("mixed inputs union consumers, while empty diffs select no images", () => {
  assert.deepEqual(
    selectNodeImages({
      ...fixture(),
      paths: ["packages/shared/index.ts", "apps/rotund/src/server.ts"],
    }),
    ordered(...broad, "auth", "rotund"),
  );
  assert.deepEqual(selectNodeImages({ paths: [] }), []);
});

test("root runtime, bootstrap, configuration and unknown inputs check every image", () => {
  for (const path of [
    ".nvmrc",
    ".dockerignore",
    "package.json",
    "package-lock.json",
    "tsconfig.base.json",
    "scripts/tooling/ensure-worker-types.mjs",
    "scripts/ci/node-image-impact.mjs",
    "scripts/ci/publish-impact.mjs",
    "scripts/ci/node-image-smoke.mjs",
    ".github/workflows/node-images.yml",
    "new-root-input",
    "apps/new-unknown/source.ts",
  ])
    assert.deepEqual(
      selectNodeImages({ ...fixture(), paths: [path] }),
      nodeImageApps,
      path,
    );
});

test("explicit Docker COPY outside the lock graph is an image input", () => {
  const f = fixture();
  f.dockerfiles.marky += "\nCOPY packages/extra-copy ./extra";
  assert.deepEqual(
    selectNodeImages({ ...f, paths: ["packages/extra-copy/file.ts"] }),
    ordered(...broad, "marky"),
  );
  for (const copy of [
    'COPY ["packages/extra-copy", "./extra"]',
    "COPY ${EXTRA} ./extra",
    "COPY packages/* ./packages",
  ]) {
    f.dockerfiles.marky = copy;
    assert.deepEqual(
      selectNodeImages({ ...f, paths: ["apps/unrelated/file.ts"] }),
      ordered(...broad, "marky"),
    );
  }
});

test("comparison reads both Dockerfile revisions and falls back on errors", () => {
  const f = fixture();
  const reads = [];
  const read = (args) => {
    reads.push(args);
    if (args[0] === "diff") return "apps/unrelated/file.ts\0";
    const [commit, path] = args[1].split(":");
    if (path === "package-lock.json") return JSON.stringify(f.beforeLock);
    const app = path.split("/")[1];
    return app === "marky" && commit === "base"
      ? "COPY . ."
      : f.dockerfiles[app];
  };
  assert.deepEqual(
    selectNodeImagesFromCommits({ before: "base", head: "head", read }),
    ordered(...broad, "marky"),
  );
  assert.ok(
    reads.some((args) => args.includes("--no-renames") && args.includes("-z")),
  );
  for (const failingRead of [
    () => {
      throw new Error("missing base");
    },
    () => "not json",
  ]) {
    const warnings = [];
    assert.deepEqual(
      selectNodeImagesFromCommits({
        before: "base",
        read: failingRead,
        warn: (text) => warnings.push(text),
      }),
      nodeImageApps,
    );
    assert.equal(warnings.length, 1);
  }
});

function unexpectedRead() {
  throw new Error("must not read");
}

function malformedLockRead(args) {
  return args[0] === "diff"
    ? "apps/auth/src/server.mjs\0"
    : args[1].endsWith("package-lock.json")
      ? "{}"
      : "COPY apps/auth ./app";
}

test("manual, missing and zero bases check all without comparing; no diff is a noop", () => {
  for (const args of [
    { event: "workflow_dispatch", before: "base" },
    {},
    { before: "0000" },
  ])
    assert.deepEqual(
      selectNodeImagesFromCommits({ ...args, read: unexpectedRead }),
      nodeImageApps,
    );
  assert.deepEqual(
    selectNodeImagesFromCommits({ before: "base", read: () => "" }),
    [],
  );
});

test("malformed lock data conservatively checks every image through the entry point", () => {
  assert.deepEqual(
    selectNodeImagesFromCommits({
      before: "base",
      read: malformedLockRead,
      warn: () => {},
    }),
    nodeImageApps,
  );
});

test("repository Dockerfiles and lock preserve whole-context inputs and actual UI consumers", () => {
  const root = new URL("../../../", import.meta.url);
  const lock = JSON.parse(
    readFileSync(new URL("package-lock.json", root), "utf8"),
  );
  const dockerfiles = Object.fromEntries(
    nodeImageApps.map((app) => [
      app,
      readFileSync(new URL(`apps/${app}/Dockerfile`, root), "utf8"),
    ]),
  );
  const select = (paths) =>
    selectNodeImages({ paths, beforeLock: lock, afterLock: lock, dockerfiles });
  assert.deepEqual(
    select(["apps/auth/src/server.mjs"]),
    ordered(...broad, "auth"),
  );
  assert.deepEqual(
    select(["packages/ui/styles.ts"]),
    ordered(...broad, "auth"),
  );
  assert.deepEqual(select(["apps/8mb/server.ts"]), ordered(...broad, "8mb"));
});
