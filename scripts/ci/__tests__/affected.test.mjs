import assert from "node:assert/strict";
import { test } from "node:test";
import { selectChecks } from "../affected.mjs";

const workspaces = [
  {
    path: "apps/cms",
    name: "@tea/cms",
    manifest: {
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
    path: "packages/cms-edge",
    name: "@tea/cms-edge",
    manifest: {
      dependencies: { "@tea/request-body": "0.1.0" },
    },
  },
  {
    path: "apps/shell-mcp",
    name: "@tea/shell-mcp",
    manifest: {
      dependencies: { "@tea/mcp": "0.1.0", "@tea/json-schema": "0.1.0" },
    },
  },
  { path: "packages/request-body", name: "@tea/request-body", manifest: {} },
  {
    path: "packages/mcp",
    name: "@tea/mcp",
    manifest: {
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
    manifest: { dependencies: { "@tea/result": "0.1.0" } },
  },
  { path: "packages/logger", name: "@tea/logger", manifest: {} },
  { path: "packages/result", name: "@tea/result", manifest: {} },
];

function checks(changed = {}) {
  return {
    cms: false,
    edge: false,
    shell: false,
    body: false,
    mcp: false,
    schema: false,
    logger: false,
    result: false,
    ...changed,
  };
}

test("a package change reaches its transitive app consumers", () => {
  assert.deepEqual(
    selectChecks(["packages/rich-text/inline.ts"], workspaces),
    checks({ cms: true }),
  );
});

test("edge and documentation changes do not start CMS checks", () => {
  assert.deepEqual(
    selectChecks(["packages/cms-edge/app/index.tsx"], workspaces),
    checks({ edge: true }),
  );
  assert.deepEqual(
    selectChecks(["docs/architecture.md"], workspaces),
    checks(),
  );
  assert.deepEqual(
    selectChecks(["apps/shell-mcp/app/config.ts"], workspaces),
    checks({ shell: true }),
  );
  assert.deepEqual(
    selectChecks(["apps/cms/scripts/seed-users.ts"], workspaces),
    checks({ cms: true }),
  );
  assert.deepEqual(
    selectChecks(["apps/shell-mcp/app/router.ts"], workspaces),
    checks({ shell: true }),
  );
});

test("request body changes reach every consumer", () => {
  assert.deepEqual(
    selectChecks(["packages/request-body/read.ts"], workspaces),
    checks({
      cms: true,
      edge: true,
      shell: true,
      body: true,
      mcp: true,
    }),
  );
});

test("ported dependency changes reach their consumers", () => {
  assert.deepEqual(
    selectChecks(["packages/result/src/index.ts"], workspaces),
    checks({
      cms: true,
      shell: true,
      mcp: true,
      schema: true,
      result: true,
    }),
  );
  assert.deepEqual(
    selectChecks(["packages/json-schema/src/checks.ts"], workspaces),
    checks({
      cms: true,
      shell: true,
      mcp: true,
      schema: true,
    }),
  );
  assert.deepEqual(
    selectChecks(["packages/logger/src/log.ts"], workspaces),
    checks({
      cms: true,
      shell: true,
      mcp: true,
      logger: true,
    }),
  );
});

test("MCP changes check both hosts and the package", () => {
  assert.deepEqual(
    selectChecks(["packages/mcp/src/handler.ts"], workspaces),
    checks({
      cms: true,
      shell: true,
      mcp: true,
    }),
  );
});

test("shared configuration and unrecognized files run all known checks", () => {
  const all = checks({
    cms: true,
    edge: true,
    shell: true,
    body: true,
    mcp: true,
    schema: true,
    logger: true,
    result: true,
  });
  for (const path of [
    "package-lock.json",
    "compose.yml",
    "unexpected/config.ts",
  ])
    assert.deepEqual(selectChecks([path], workspaces), all);
});
