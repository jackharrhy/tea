import assert from "node:assert/strict";
import { test } from "vitest";
import { parseOptions, validatePack } from "../publish-policy.mjs";

test("dry run and prerelease tags are explicit", () => {
  assert.deepEqual(parseOptions(["--dry-run"], "0.2.0"), {
    dryRun: true,
    tag: "latest",
  });
  assert.deepEqual(parseOptions(["--tag=next"], "0.3.0-beta.1"), {
    dryRun: false,
    tag: "next",
  });
  for (const args of [[], ["--tag", "latest"]]) {
    assert.throws(() => parseOptions(args, "0.3.0-beta.1"), /Prereleases/);
  }
  for (const args of [
    ["--tag"],
    ["--tag="],
    ["--yes"],
    ["--tag", "--dry-run"],
  ]) {
    assert.throws(() => parseOptions(args, "0.2.0"));
  }
});

test("the release requires a complete bundled CLI package", () => {
  const manifest = {
    name: "artbin",
    version: "0.2.0",
    bin: { artbin: "./dist/index.js" },
  };
  const packed = {
    ...manifest,
    files: [
      "dist/index.js",
      "dist/login.js",
      "package.json",
      "README.md",
      "LICENSE",
    ].map((path) => ({ path })),
  };
  validatePack(packed, manifest);
  assert.throws(
    () => validatePack({ ...packed, version: "0.1.0" }, manifest),
    /unexpected/,
  );
  assert.throws(
    () => validatePack({ ...packed, files: packed.files.slice(1) }, manifest),
    /missing/,
  );
  assert.throws(
    () =>
      validatePack(
        { ...packed, files: [...packed.files, { path: ".env" }] },
        manifest,
      ),
    /Unexpected package files/,
  );
  assert.throws(
    () =>
      validatePack(packed, {
        ...manifest,
        dependencies: { "@tea/artbin-core": "workspace:*" },
      }),
    /bundle/,
  );
});
