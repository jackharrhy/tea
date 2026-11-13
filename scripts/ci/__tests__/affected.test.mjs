import assert from "node:assert/strict";
import { test } from "node:test";
import { planChecks, selectChecks } from "../affected.mjs";

const workspaces = [
  {
    path: "apps/cms",
    name: "@harrhy/cms",
    manifest: {
      scripts: { check: "npm test" },
      dependencies: {
        "@harrhy/rich-text": "*",
        "@harrhy/request-body": "0.1.0",
        "@harrhy/mcp": "0.1.0",
        "@harrhy/json-schema": "0.1.0",
      },
    },
  },
  { path: "packages/rich-text", name: "@harrhy/rich-text", manifest: {} },
  {
    path: "apps/cms-edge",
    name: "@harrhy/cms-edge",
    manifest: {
      scripts: { check: "npm test" },
      dependencies: { "@harrhy/request-body": "0.1.0" },
    },
  },
  {
    path: "packages/request-body",
    name: "@harrhy/request-body",
    manifest: { scripts: { check: "npm test" } },
  },
  {
    path: "packages/mcp",
    name: "@harrhy/mcp",
    manifest: {
      scripts: { check: "npm test" },
      dependencies: {
        "@harrhy/request-body": "0.1.0",
        "@harrhy/json-schema": "0.1.0",
        "@harrhy/logger": "0.1.0",
        "@harrhy/result": "0.1.0",
      },
    },
  },
  {
    path: "packages/json-schema",
    name: "@harrhy/json-schema",
    manifest: {
      scripts: { check: "npm test" },
      dependencies: { "@harrhy/result": "0.1.0" },
    },
  },
  {
    path: "packages/logger",
    name: "@harrhy/logger",
    manifest: { scripts: { check: "npm test" } },
  },
  {
    path: "packages/result",
    name: "@harrhy/result",
    manifest: { scripts: { check: "npm test" } },
  },
];

const checks = (...names) => names.toSorted((a, b) => a.localeCompare(b));

test("a package change reaches its transitive app consumers", () => {
  assert.deepEqual(
    selectChecks(["packages/rich-text/inline.ts"], workspaces),
    checks("@harrhy/cms"),
  );
});

test("edge and documentation changes do not start CMS checks", () => {
  assert.deepEqual(
    selectChecks(["apps/cms-edge/app/index.tsx"], workspaces),
    checks("@harrhy/cms-edge"),
  );
  assert.deepEqual(selectChecks(["docs/architecture.md"], workspaces), []);
  assert.deepEqual(
    selectChecks(
      [
        ".dockerignore",
        "apps/cms/Dockerfile",
        "scripts/ci/affected.mjs",
        "scripts/ci/__tests__/affected.test.mjs",
        "scripts/ci/publish-impact.mjs",
        "scripts/ci/__tests__/publish-impact.test.mjs",
        ".github/workflows/publish-ref.yml",
      ],
      workspaces,
    ),
    [],
  );
});

test("request body changes reach every consumer", () => {
  assert.deepEqual(
    selectChecks(["packages/request-body/read.ts"], workspaces),
    checks(
      "@harrhy/cms",
      "@harrhy/cms-edge",
      "@harrhy/request-body",
      "@harrhy/mcp",
    ),
  );
});

test("ported dependency changes reach their consumers", () => {
  assert.deepEqual(
    selectChecks(["packages/result/src/index.ts"], workspaces),
    checks(
      "@harrhy/cms",
      "@harrhy/mcp",
      "@harrhy/json-schema",
      "@harrhy/result",
    ),
  );
  assert.deepEqual(
    selectChecks(["packages/logger/src/index.ts"], workspaces),
    checks("@harrhy/cms", "@harrhy/mcp", "@harrhy/logger"),
  );
});

test("an independently checked workspace is picked up automatically", () => {
  const extra = {
    path: "apps/radio",
    name: "@harrhy/radio",
    manifest: {
      scripts: { check: "npm test" },
      dependencies: { "@harrhy/result": "0.1.0" },
    },
  };
  assert.deepEqual(
    selectChecks(["packages/result/src/index.ts"], [...workspaces, extra]),
    checks(
      "@harrhy/cms",
      "@harrhy/mcp",
      "@harrhy/json-schema",
      "@harrhy/result",
      "@harrhy/radio",
    ),
  );
});

test("workflow lint and dependency-update metadata do not run app checks", () => {
  const metadata = [
    ".github/workflows/lint-actions.yml",
    ".github/dependabot.yml",
    ".github/dependabot.yaml",
  ];
  assert.deepEqual(selectChecks(metadata, workspaces), []);
  assert.deepEqual(
    selectChecks([...metadata, "apps/cms/app/router.ts"], workspaces),
    checks("@harrhy/cms"),
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
    ".github/workflows/check.yml",
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
