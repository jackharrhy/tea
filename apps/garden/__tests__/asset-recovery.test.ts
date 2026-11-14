import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { recoverAssetsCommand } from "../scripts/assets.ts";
import { selectPublicAssets } from "../app/content/public-assets.ts";

async function fixture(t: { after(callback: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "garden-recovery-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const assetsPath = path.join(root, "assets");
  await fs.mkdir(assetsPath);
  return {
    root,
    assetsPath,
    env: {
      GARDEN_VAULT_ASSETS_PATH: assetsPath,
      GARDEN_RCLONE_REMOTE: "fixture:bucket",
    },
  };
}

test("missing-local remains a maintenance inventory, independent of publication selection", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.assetsPath, "existing.txt"), "keep");
  const result = await recoverAssetsCommand(
    ["missing-local"],
    f.env,
    (args) => {
      assert.deepEqual(args, [
        "lsjson",
        "fixture:bucket",
        "--files-only",
        "--recursive",
      ]);
      return JSON.stringify([
        { Path: "existing.txt" },
        { Path: "nested/recovered.txt" },
      ]);
    },
  );
  assert.deepEqual(result, {
    remoteFiles: 2,
    missing: ["nested/recovered.txt"],
  });
  assert.deepEqual(await fs.readdir(f.assetsPath), ["existing.txt"]);
});

test("pull-missing is remote-to-scratch-to-local only; dry-run and exclusive writes preserve local data", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.assetsPath, "existing.txt"), "keep");
  for (const dryRun of [true, false]) {
    let received = "";
    await recoverAssetsCommand(
      ["pull-missing", ...(dryRun ? ["--dry-run"] : [])],
      f.env,
      (args) => {
        if (args[0] === "lsjson")
          return JSON.stringify([
            { Path: "existing.txt" },
            { Path: "nested/recovered.txt" },
          ]);
        assert.equal(args[0], "copy");
        assert.equal(args[1], "fixture:bucket");
        received = args[2];
        assert.notEqual(received, f.assetsPath);
        assert.ok(args.includes("--ignore-existing"));
        assert.equal(args.includes("--dry-run"), dryRun);
        assert.equal(
          readFileSync(args[args.indexOf("--files-from-raw") + 1], "utf8"),
          "nested/recovered.txt\n",
        );
        if (!dryRun) {
          mkdirSync(path.join(received, "nested"));
          writeFileSync(
            path.join(received, "nested/recovered.txt"),
            "restored",
          );
        }
        return "";
      },
    );
    await assert.rejects(fs.stat(received), { code: "ENOENT" });
    assert.equal(
      await fs.readFile(path.join(f.assetsPath, "existing.txt"), "utf8"),
      "keep",
    );
    if (dryRun)
      await assert.rejects(fs.stat(path.join(f.assetsPath, "nested")), {
        code: "ENOENT",
      });
    else
      assert.equal(
        await fs.readFile(
          path.join(f.assetsPath, "nested/recovered.txt"),
          "utf8",
        ),
        "restored",
      );
  }
  const vaultPath = path.join(f.root, "notes");
  await fs.mkdir(vaultPath);
  await fs.writeFile(
    path.join(vaultPath, "Home.md"),
    "---\npublic: true\n---\nNo asset references",
  );
  assert.deepEqual(
    (await selectPublicAssets({ vaultPath, assetsPath: f.assetsPath })).assets,
    [],
  );
});

test("a local file created during download is not overwritten, and failed transfers remove scratch", async (t) => {
  const f = await fixture(t);
  let received = "";
  await recoverAssetsCommand(["pull-missing"], f.env, (args) => {
    if (args[0] === "lsjson") return JSON.stringify([{ Path: "new.txt" }]);
    received = args[2];
    writeFileSync(path.join(received, "new.txt"), "download");
    writeFileSync(path.join(f.assetsPath, "new.txt"), "concurrent local");
    return "";
  });
  assert.equal(
    await fs.readFile(path.join(f.assetsPath, "new.txt"), "utf8"),
    "concurrent local",
  );
  await assert.rejects(
    recoverAssetsCommand(["pull-missing"], f.env, (args) => {
      if (args[0] === "lsjson")
        return JSON.stringify([{ Path: "another.txt" }]);
      received = args[2];
      throw new Error("fixture transfer failure");
    }),
    /fixture transfer failure/,
  );
  await assert.rejects(fs.stat(received), { code: "ENOENT" });
});

test("recovery rejects traversal and preexisting symlink escapes before transfer", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "target.txt"), "outside");
  await fs.symlink(outside, path.join(f.assetsPath, "escape"));
  await fs.symlink(
    path.join(outside, "target.txt"),
    path.join(f.assetsPath, "link.txt"),
  );
  for (const remotePath of [
    "../escape.txt",
    "/absolute",
    "bad\\path",
    "bad\npath",
    "escape/new.txt",
    "link.txt",
  ]) {
    for (const command of ["missing-local", "pull-missing"]) {
      await assert.rejects(
        recoverAssetsCommand([command], f.env, (args) => {
          assert.equal(args[0], "lsjson", "must reject before copy");
          return JSON.stringify([{ Path: remotePath }]);
        }),
        /Unsafe remote|symlink/,
      );
    }
  }
  assert.deepEqual(await fs.readdir(outside), ["target.txt"]);
});
