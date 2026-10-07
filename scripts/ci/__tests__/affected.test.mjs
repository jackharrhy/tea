import assert from "node:assert/strict";
import { test } from "node:test";
import { planChecks, selectChecks } from "../affected.mjs";

const workspaces = [
  {
    path: "apps/cms",
    name: "@tea/cms",
    manifest: {
      scripts: { check: "npm test" },
      dependencies: {
        "@tea/rich-text": "*",
        "@tea/request-body": "0.1.0",
        "@tea/mcp": "0.1.0",
        "@tea/json-schema": "0.1.0",
      },
    },
  },
  { path: "packages/rich-text", name: "@tea/rich-text", manifest: {} },
  {
    path: "apps/cms-edge",
    name: "@tea/cms-edge",
    manifest: {
      scripts: { check: "npm test" },
      dependencies: { "@tea/request-body": "0.1.0" },
    },
  },
  {
    path: "apps/shell-mcp",
    name: "@tea/shell-mcp",
    manifest: {
      scripts: { check: "npm test" },
      dependencies: { "@tea/mcp": "0.1.0", "@tea/json-schema": "0.1.0" },
    },
  },
  {
    path: "packages/request-body",
    name: "@tea/request-body",
    manifest: { scripts: { check: "npm test" } },
  },
  {
    path: "packages/mcp",
    name: "@tea/mcp",
    manifest: {
      scripts: { check: "npm test" },
      dependencies: {
        "@tea/request-body": "0.1.0",
        "@tea/json-schema": "0.1.0",
        "@tea/logger": "0.1.0",
        "@tea/result": "0.1.0",
      },
    },
  },
  {
    path: "packages/json-schema",
    name: "@tea/json-schema",
    manifest: {
      scripts: { check: "npm test" },
      dependencies: { "@tea/result": "0.1.0" },
    },
  },
  {
    path: "packages/logger",
    name: "@tea/logger",
    manifest: { scripts: { check: "npm test" } },
  },
  {
    path: "packages/result",
    name: "@tea/result",
    manifest: { scripts: { check: "npm test" } },
  },
];

const checks = (...names) => names.toSorted();

test("a package change reaches its transitive app consumers", () => {
  assert.deepEqual(
    selectChecks(["packages/rich-text/inline.ts"], workspaces),
    checks("@tea/cms"),
  );
});

test("edge and documentation changes do not start CMS checks", () => {
  assert.deepEqual(
    selectChecks(["apps/cms-edge/app/index.tsx"], workspaces),
    checks("@tea/cms-edge"),
  );
  assert.deepEqual(selectChecks(["docs/architecture.md"], workspaces), []);
  assert.deepEqual(
    selectChecks(["apps/shell-mcp/app/router.ts"], workspaces),
    checks("@tea/shell-mcp"),
  );
});

test("request body changes reach every consumer", () => {
  assert.deepEqual(
    selectChecks(["packages/request-body/read.ts"], workspaces),
    checks(
      "@tea/cms",
      "@tea/cms-edge",
      "@tea/shell-mcp",
      "@tea/request-body",
      "@tea/mcp",
    ),
  );
});

test("ported dependency changes reach their consumers", () => {
  assert.deepEqual(
    selectChecks(["packages/result/src/index.ts"], workspaces),
    checks(
      "@tea/cms",
      "@tea/shell-mcp",
      "@tea/mcp",
      "@tea/json-schema",
      "@tea/result",
    ),
  );
  assert.deepEqual(
    selectChecks(["packages/logger/src/index.ts"], workspaces),
    checks("@tea/cms", "@tea/shell-mcp", "@tea/mcp", "@tea/logger"),
  );
});

test("an independently checked workspace is picked up automatically", () => {
  const extra = {
    path: "apps/radio",
    name: "@tea/radio",
    manifest: {
      scripts: { check: "npm test" },
      dependencies: { "@tea/result": "0.1.0" },
    },
  };
  assert.deepEqual(
    selectChecks(["packages/result/src/index.ts"], [...workspaces, extra]),
    checks(
      "@tea/cms",
      "@tea/shell-mcp",
      "@tea/mcp",
      "@tea/json-schema",
      "@tea/result",
      "@tea/radio",
    ),
  );
});

test("shared configuration and unrecognized files run all checks", () => {
  const all = checks(
    ...workspaces
      .filter(({ manifest }) => manifest.scripts?.check)
      .map(({ name }) => name),
  );
  for (const path of [
    "package-lock.json",
    "compose.yml",
    "unexpected/config.ts",
  ])
    assert.deepEqual(selectChecks([path], workspaces), all);
});

test("selected checks build untouched dependencies in dependency order", () => {
  const graph = [
    {
      name: "app",
      manifest: { scripts: { check: "test" }, dependencies: { protocol: "*" } },
    },
    {
      name: "protocol",
      manifest: {
        scripts: { check: "test", build: "build" },
        dependencies: { core: "*" },
      },
    },
    { name: "core", manifest: { scripts: { check: "test", build: "build" } } },
  ];
  assert.deepEqual(planChecks(["app"], graph), [
    { name: "core", script: "build" },
    { name: "protocol", script: "build" },
    { name: "app", script: "check" },
  ]);
  assert.deepEqual(planChecks(["app", "core"], graph), [
    { name: "core", script: "check" },
    { name: "protocol", script: "build" },
    { name: "app", script: "check" },
  ]);
});
