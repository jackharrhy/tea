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
    manifest: { dependencies: { "@tea/rich-text": "*" } },
  },
  { path: "packages/rich-text", name: "@tea/rich-text", manifest: {} },
  { path: "packages/cms-edge", name: "@tea/cms-edge", manifest: {} },
  {
    path: "apps/shell-mcp",
    name: "@tea/shell-mcp",
    manifest: { dependencies: { "@tea/shell-core": "0.1.0" } },
  },
  { path: "packages/shell-core", name: "@tea/shell-core", manifest: {} },
];

test("a package change reaches its transitive app consumers", () => {
  assert.deepEqual(selectChecks(["packages/rich-text/inline.ts"], workspaces), {
    cms: true,
    edge: false,
    shell: false,
  });
});

test("edge and documentation changes do not start CMS checks", () => {
  assert.deepEqual(
    selectChecks(["packages/cms-edge/app/index.tsx"], workspaces),
    {
      cms: false,
      edge: true,
      shell: false,
    },
  );
  assert.deepEqual(selectChecks(["docs/architecture.md"], workspaces), {
    cms: false,
    edge: false,
    shell: false,
  });
  assert.deepEqual(selectChecks(["apps/shell-mcp/app/config.ts"], workspaces), {
    cms: false,
    edge: false,
    shell: true,
  });
  assert.deepEqual(
    selectChecks(["packages/shell-core/router.ts"], workspaces),
    { cms: false, edge: false, shell: true },
  );
});

test("shared configuration and unrecognized files run all known checks", () => {
  assert.deepEqual(selectChecks(["package-lock.json"], workspaces), {
    cms: true,
    edge: true,
    shell: true,
  });
  assert.deepEqual(selectChecks(["compose.yml"], workspaces), {
    cms: true,
    edge: true,
    shell: true,
  });
  assert.deepEqual(selectChecks(["unexpected/config.ts"], workspaces), {
    cms: true,
    edge: true,
    shell: true,
  });
});
