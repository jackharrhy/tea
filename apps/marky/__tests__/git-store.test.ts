import * as assert from "remix/assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "remix/test";

import { simpleGit } from "simple-git";

import { GitStore } from "../app/data/git-store.ts";

// Each test runs against a fresh temp repo with a single seed commit so
// that staging operations have meaningful diffs. We use real `git` (the
// binary that ships with the test runner host) via simple-git; this
// matches production where simple-git runs the same way.
async function freshRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "marky-git-test-"));
  const git = simpleGit(dir);
  await git.init();
  await git
    .addConfig("user.name", "Seed", undefined, "local")
    .addConfig("user.email", "seed@example.com", undefined, "local");
  await fs.mkdir(path.join(dir, "content"), { recursive: true });
  await fs.writeFile(path.join(dir, "content", "seed.md"), "seed\n");
  await git.add(["content/seed.md"]);
  await git.commit("seed");
  return dir;
}

function newStore(repoDir: string) {
  return new GitStore({
    repoDir,
    authorName: "marky-bot",
    authorEmail: "marky-bot@test",
  });
}

describe("GitStore", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await freshRepo();
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it("assertRepo succeeds on a real repo", async () => {
    const store = newStore(repoDir);
    await store.assertRepo();
  });

  it("assertRepo throws on a non-repo directory", async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "marky-not-a-repo-"));
    try {
      const store = newStore(empty);
      await assert.rejects(() => store.assertRepo(), /not a git repository/);
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });

  it("stageEdit + commit produces a new HEAD with the right author and message", async () => {
    const store = newStore(repoDir);
    await fs.writeFile(path.join(repoDir, "content", "alpha.md"), "hello\n");
    await store.stageEdit({ path: "content/alpha.md" });
    const result = await store.commit("edit alpha.md by jackharrhy");
    assert.ok(result);
    assert.match(result.sha, /^[0-9a-f]{40}$/);

    const git = simpleGit(repoDir);
    const log = await git.log({ maxCount: 1 });
    assert.equal(log.latest?.message, "edit alpha.md by jackharrhy");
    assert.equal(log.latest?.author_name, "marky-bot");
    assert.equal(log.latest?.author_email, "marky-bot@test");
  });

  it("commit returns null when there is nothing staged", async () => {
    const store = newStore(repoDir);
    const result = await store.commit("edit nothing.md by nobody");
    assert.equal(result, null);
  });

  it("stageRename + commit records the move", async () => {
    const store = newStore(repoDir);
    await store.stageRename({
      oldPath: "content/seed.md",
      newPath: "content/renamed.md",
    });
    await store.commit("rename seed.md to renamed.md by jackharrhy");

    const git = simpleGit(repoDir);
    const summary = await git.raw([
      "diff-tree",
      "--name-status",
      "-r",
      "-M",
      "HEAD",
    ]);
    assert.match(summary, /^R\d+\tcontent\/seed\.md\tcontent\/renamed\.md/m);
  });

  it("stageDelete + commit records the deletion", async () => {
    const store = newStore(repoDir);
    await store.stageDelete({ path: "content/seed.md" });
    await store.commit("delete seed.md by jackharrhy");

    const git = simpleGit(repoDir);
    const summary = await git.raw(["diff-tree", "--name-status", "-r", "HEAD"]);
    assert.match(summary, /^D\tcontent\/seed\.md/m);
  });

  it("does not modify the repo .git/config (per-commit identity flags)", async () => {
    const store = newStore(repoDir);
    await fs.writeFile(path.join(repoDir, "content", "a.md"), "x");
    await store.stageEdit({ path: "content/a.md" });
    await store.commit("edit a.md by jackharrhy");

    const git = simpleGit(repoDir);
    const localName = (
      await git.raw(["config", "--local", "user.name"])
    ).trim();
    const localEmail = (
      await git.raw(["config", "--local", "user.email"])
    ).trim();
    assert.equal(localName, "Seed");
    assert.equal(localEmail, "seed@example.com");
  });

  it("hasUnpushed is true when there are commits without an upstream", async () => {
    const store = newStore(repoDir);
    await fs.writeFile(path.join(repoDir, "content", "a.md"), "x");
    await store.stageEdit({ path: "content/a.md" });
    await store.commit("edit a.md by jackharrhy");
    assert.equal(await store.hasUnpushed(), true);
  });

  it("hasUnpushed is false on a clean repo whose upstream tracks HEAD", async () => {
    // Bare upstream to give the branch something to track.
    const upstream = await fs.mkdtemp(
      path.join(os.tmpdir(), "marky-upstream-"),
    );
    try {
      await simpleGit(upstream).init(true);
      const git = simpleGit(repoDir);
      await git.addRemote("origin", upstream);
      await git.push(["-u", "origin", "HEAD"]);

      const store = newStore(repoDir);
      assert.equal(await store.hasUnpushed(), false);
    } finally {
      await fs.rm(upstream, { recursive: true, force: true });
    }
  });
});
