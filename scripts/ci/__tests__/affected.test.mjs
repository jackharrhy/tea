import assert from "node:assert/strict";
import { test } from "node:test";
import { selectChecks } from "../affected.mjs";

const workspaces = [
  {
    path: "apps/cms",
    name: "@tea/cms",
    manifest: { dependencies: { "@tea/cms-core": "*" } },
  },
  {
    path: "packages/cms-core",
    name: "@tea/cms-core",
    manifest: {
      dependencies: {
        "@tea/rich-text": "*",
        "@tea/request-body": "0.1.0",
        "@tea/mcp": "0.1.0",
      },
    },
  },
  { path: "packages/rich-text", name: "@tea/rich-text", manifest: {} },
  {
    path: "packages/cms-edge",
    name: "@tea/cms-edge",
    manifest: { dependencies: { "@tea/request-body": "0.1.0" } },
  },
  {
    path: "apps/shell-mcp",
    name: "@tea/shell-mcp",
    manifest: { dependencies: { "@tea/shell-core": "0.1.0" } },
  },
  {
    path: "packages/shell-core",
    name: "@tea/shell-core",
    manifest: { dependencies: { "@tea/mcp": "0.1.0" } },
  },
  { path: "packages/request-body", name: "@tea/request-body", manifest: {} },
  {
    path: "packages/mcp",
    name: "@tea/mcp",
    manifest: { dependencies: { "@tea/request-body": "0.1.0" } },
  },
];

test("a package change reaches its transitive app consumers", () => {
  assert.deepEqual(selectChecks(["packages/rich-text/inline.ts"], workspaces), {
    cms: true,
    edge: false,
    shell: false,
    body: false,
    mcp: false,
  });
});

test("edge and documentation changes do not start CMS checks", () => {
  assert.deepEqual(
    selectChecks(["packages/cms-edge/app/index.tsx"], workspaces),
    {
      cms: false,
      edge: true,
      shell: false,
      body: false,
      mcp: false,
    },
  );
  assert.deepEqual(selectChecks(["docs/architecture.md"], workspaces), {
    cms: false,
    edge: false,
    shell: false,
    body: false,
    mcp: false,
  });
  assert.deepEqual(selectChecks(["apps/shell-mcp/app/config.ts"], workspaces), {
    cms: false,
    edge: false,
    shell: true,
    body: false,
    mcp: false,
  });
  assert.deepEqual(
    selectChecks(["packages/shell-core/router.ts"], workspaces),
    { cms: false, edge: false, shell: true, body: false, mcp: false },
  );
});

test("request body changes reach every consumer", () => {
  assert.deepEqual(
    selectChecks(["packages/request-body/read.ts"], workspaces),
    { cms: true, edge: true, shell: true, body: true, mcp: true },
  );
});

test("MCP changes check both hosts and the package", () => {
  assert.deepEqual(selectChecks(["packages/mcp/src/handler.ts"], workspaces), {
    cms: true,
    edge: false,
    shell: true,
    body: false,
    mcp: true,
  });
});

test("shared configuration and unrecognized files run all known checks", () => {
  assert.deepEqual(selectChecks(["package-lock.json"], workspaces), {
    cms: true,
    edge: true,
    shell: true,
    body: true,
    mcp: true,
  });
  assert.deepEqual(selectChecks(["compose.yml"], workspaces), {
    cms: true,
    edge: true,
    shell: true,
    body: true,
    mcp: true,
  });
  assert.deepEqual(selectChecks(["unexpected/config.ts"], workspaces), {
    cms: true,
    edge: true,
    shell: true,
    body: true,
    mcp: true,
  });
});
