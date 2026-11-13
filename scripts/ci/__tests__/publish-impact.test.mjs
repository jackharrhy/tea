import assert from "node:assert/strict";
import test from "node:test";
import { selectFromCommits, selectPublishedApps } from "../publish-impact.mjs";

const apps = ["ref", "artbin"];
const root = { name: "harrhy", scripts: { "ref:build": "npm run build" } };
const base = {
  packages: {
    "": { devDependencies: { builder: "1" } },
    "apps/ref": { dependencies: { "@harrhy/identity": "*" } },
    "apps/artbin": { dependencies: { art: "1" } },
    "packages/identity": { dependencies: { shared: "1" } },
    "node_modules/@harrhy/identity": {
      link: true,
      resolved: "packages/identity",
    },
    "node_modules/builder": { version: "1" },
    "node_modules/art": { version: "1" },
    "node_modules/shared": {
      version: "1",
      optionalDependencies: { native: "1" },
    },
    "node_modules/native": { version: "1" },
  },
};

function select(paths, afterLock = base, afterRoot = root, dockerfiles = {}) {
  return selectPublishedApps({
    apps,
    paths,
    beforeLock: base,
    afterLock,
    beforeRoot: root,
    afterRoot,
    dockerfiles,
  });
}

test("new unrelated workspace, tooling and root commands publish no existing image", () => {
  const after = structuredClone(base);
  after.packages["apps/auth"] = { devDependencies: { newtool: "1" } };
  after.packages["node_modules/@harrhy/auth"] = {
    link: true,
    resolved: "apps/auth",
  };
  after.packages["node_modules/newtool"] = { version: "1" };
  assert.deepEqual(
    select(
      ["package.json", "package-lock.json", "apps/auth/package.json"],
      after,
      { ...root, scripts: { ...root.scripts, "auth:dev": "node app.mjs" } },
    ),
    [],
  );
});

test("resolved shared and optional transitive changes publish their consumers", () => {
  const changed = structuredClone(base);
  changed.packages["node_modules/shared"].version = "2";
  assert.deepEqual(select(["package-lock.json"], changed), ["ref"]);

  const newlyResolvable = structuredClone(base);
  delete newlyResolvable.packages["node_modules/native"];
  assert.deepEqual(
    selectPublishedApps({
      apps,
      paths: ["package-lock.json"],
      beforeLock: newlyResolvable,
      afterLock: base,
      beforeRoot: root,
      afterRoot: root,
    }),
    ["ref"],
  );
});

test("workspace source and root build inputs select only affected images", () => {
  assert.deepEqual(select(["packages/identity/src/index.ts"]), ["ref"]);
  assert.deepEqual(select([".nvmrc"]), apps);
  assert.deepEqual(
    select(
      ["package.json"],
      base,
      { ...root, scripts: { "ref:build": "npm run build:new" } },
      { ref: "RUN npm run ref:build", artbin: "RUN npm run build" },
    ),
    ["ref"],
  );
  assert.deepEqual(
    select(["package-lock.json"], { ...base, lockfileVersion: 4 }),
    apps,
  );
  assert.deepEqual(
    select(["package.json"], base, { ...root, engines: { node: ">=27" } }),
    apps,
  );
  assert.deepEqual(
    selectFromCommits(apps, "", "HEAD", "workflow_dispatch"),
    apps,
  );
});
