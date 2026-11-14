import { it as test } from "remix/test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createBackupService, backupConfig } from "../service.ts";
import { restoreSnapshot, validateSnapshot } from "../snapshot.ts";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cms-backup-"));
  const data = join(root, "data"),
    output = join(root, "backups");
  const datasets = ["andrew", "luke", "operator"].map((id) => ({
    id,
    database: `${id}/${id === "operator" ? "operator" : "tea"}.db`,
    trees: id === "operator" ? [] : [`${id}/uploads`, `${id}/public`],
  }));
  const databases: DatabaseSync[] = [];
  for (const dataset of datasets) {
    await mkdir(join(data, dataset.id), { recursive: true });
    const db = new DatabaseSync(join(data, dataset.database));
    db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE sessions(id TEXT); INSERT INTO sessions VALUES(\u0027old-session\u0027); CREATE TABLE users(id INTEGER, auth_subject TEXT); INSERT INTO users VALUES(7,\u0027exact-subject\u0027)",
    );
    if (dataset.id !== "operator") {
      db.exec(
        "CREATE TABLE media(path TEXT); INSERT INTO media VALUES(\u0027original.png\u0027)",
      );
      await mkdir(join(data, dataset.id, "uploads"));
      await mkdir(join(data, dataset.id, "public"));
      await writeFile(
        join(data, dataset.id, "uploads/original.png"),
        "original media",
      );
      await writeFile(
        join(data, dataset.id, "uploads/unlisted.png"),
        "retained history bytes",
      );
      await writeFile(
        join(data, dataset.id, "public/legacy.pdf"),
        "direct public file",
      );
    } else
      db.exec(
        "CREATE TABLE tickets(id TEXT); CREATE TABLE site_sessions(id TEXT); INSERT INTO tickets VALUES(\u0027ticket\u0027)",
      );
    databases.push(db);
  }
  const config = {
    directory: output,
    intervalSeconds: 86400,
    retention: 7,
    reserveBytes: 1048576,
  };
  const service = createBackupService(data, datasets, config, "test-revision");
  async function snapshots() {
    return (await readdir(output)).filter((name) =>
      name.startsWith("snapshot-"),
    );
  }
  return {
    root,
    data,
    output,
    datasets,
    config,
    service,
    databases,
    snapshots,
    async close() {
      await service.close();
      for (const db of databases) db.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
test("verified WAL snapshots include every site, public/unlisted bytes and operator; offline restore invalidates sessions", async () => {
  const f = await fixture();
  try {
    await f.service.run();
    assert.equal(f.service.status().lastError, undefined);
    const snapshot = join(f.output, (await f.snapshots())[0]!);
    const manifest = await validateSnapshot(snapshot);
    assert.equal(manifest.revision, "test-revision");
    assert.equal(manifest.datasets.length, 3);
    assert.equal(manifest.files.length, 9);
    const target = join(f.root, "restored");
    await restoreSnapshot(snapshot, target);
    for (const dataset of f.datasets) {
      const db = new DatabaseSync(join(target, dataset.database));
      try {
        assert.equal(db.prepare("SELECT count(*) n FROM sessions").get()?.n, 0);
        assert.equal(
          db.prepare("SELECT auth_subject FROM users WHERE id=7").get()
            ?.auth_subject,
          "exact-subject",
        );
      } finally {
        db.close();
      }
    }
    assert.equal(
      await readFile(join(target, "luke/public/legacy.pdf"), "utf8"),
      "direct public file",
    );
    assert.equal(
      await readFile(join(target, "andrew/uploads/unlisted.png"), "utf8"),
      "retained history bytes",
    );
    await assert.rejects(restoreSnapshot(snapshot, target), /EEXIST/);
    assert.equal(f.service.status().completed, 1);
  } finally {
    await f.close();
  }
});
test("startup coalesces downtime; restart verifies catalogue and avoids duplicate daily snapshot", async () => {
  const f = await fixture();
  try {
    await f.service.start();
    await f.service.close();
    const restarted = createBackupService(f.data, f.datasets, f.config);
    try {
      await restarted.start();
      assert.equal((await f.snapshots()).length, 1);
      assert.ok(restarted.status().nextDue);
    } finally {
      await restarted.close();
    }
    const manifestPath = join(
      f.output,
      (await f.snapshots())[0]!,
      "manifest.json",
    );
    const old = JSON.parse(await readFile(manifestPath, "utf8"));
    old.createdAt = new Date(Date.now() - 10 * 86400000).toISOString();
    await writeFile(manifestPath, JSON.stringify(old));
    const overdue = createBackupService(f.data, f.datasets, f.config);
    try {
      await overdue.start();
      assert.equal((await f.snapshots()).length, 2); // Ten missed days produce one current checkpoint.
      await overdue.run();
      assert.equal((await f.snapshots()).length, 2);
    } finally {
      await overdue.close();
    }
  } finally {
    await f.close();
  }
});
test("exclusive SQLite lease rejects overlap, releases normally; same-process work coalesces", async () => {
  const f = await fixture();
  try {
    await mkdir(f.output);
    const lock = new DatabaseSync(join(f.output, ".lease.sqlite"));
    lock.exec("BEGIN IMMEDIATE");
    await f.service.run();
    assert.match(f.service.status().lastError!, /lease/);
    assert.equal((await f.snapshots()).length, 0);
    lock.close();
    execFileSync(process.execPath, [
      "--input-type=module",
      "-e",
      `import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(${JSON.stringify(join(f.output, ".lease.sqlite"))}); db.exec('BEGIN IMMEDIATE'); process.exit(0);`,
    ]);
    const a = f.service.run(true),
      b = f.service.run(true);
    assert.equal(a, b);
    await a;
    assert.equal((await f.snapshots()).length, 1);
  } finally {
    await f.close();
  }
});
test("prune only after valid success; keep seven, never legacy/manual/partial artifacts", async () => {
  const f = await fixture();
  try {
    await mkdir(f.output);
    await mkdir(join(f.output, "manual-archive"));
    await mkdir(join(f.output, ".partial-old"));
    for (let i = 0; i < 9; i++) await f.service.run(true);
    assert.equal((await f.snapshots()).length, 7);
    assert.ok((await readdir(f.output)).includes("manual-archive"));
    assert.ok((await readdir(f.output)).includes(".partial-old"));
    const existing = await f.snapshots();
    const bad = createBackupService(f.data, f.datasets, {
      ...f.config,
      reserveBytes: Number.MAX_SAFE_INTEGER,
    });
    await bad.run(true);
    assert.ok(bad.status().lastError);
    assert.deepEqual(await f.snapshots(), existing);
  } finally {
    await f.close();
  }
});
test("missing media fails capture; corrupt completed snapshot blocks pruning; restore rejects corruption", async () => {
  const f = await fixture();
  try {
    await f.service.run();
    const snapshots = await f.snapshots();
    const path = join(f.output, snapshots[0]!, "andrew/uploads/original.png");
    await writeFile(path, "corrupt");
    await assert.rejects(
      validateSnapshot(join(f.output, snapshots[0]!)),
      /checksum/,
    );
    await assert.rejects(
      restoreSnapshot(
        join(f.output, snapshots[0]!),
        join(f.root, "no-restore"),
      ),
      /checksum/,
    );
    await f.service.run(true);
    assert.ok(f.service.status().lastError);
    assert.deepEqual(await f.snapshots(), snapshots);
    // A separate empty destination demonstrates missing referenced bytes cannot become complete.
    await rm(join(f.data, "luke/uploads/original.png"));
    const other = createBackupService(f.data, f.datasets, {
      ...f.config,
      directory: join(f.root, "other-backups"),
    });
    await other.run(true);
    assert.ok(other.status().lastError);
    assert.equal(
      (await readdir(join(f.root, "other-backups"))).filter((s) =>
        s.startsWith("snapshot-"),
      ).length,
      0,
    );
  } finally {
    await f.close();
  }
});
test("reject nested backup roots and symlink dataset files", async () => {
  const f = await fixture();
  try {
    const nested = createBackupService(f.data, f.datasets, {
      ...f.config,
      directory: join(f.data, "backups"),
    });
    await nested.run();
    assert.ok(nested.status().lastError);
    await symlink("/etc/hosts", join(f.data, "andrew/uploads/escape"));
    await f.service.run();
    assert.ok(f.service.status().lastError);
    assert.equal((await f.snapshots()).length, 0);
  } finally {
    await f.close();
  }
});
test("disabled by default, bounded explicit config", () => {
  assert.equal(backupConfig({}), undefined);
  assert.equal(backupConfig({ TEA_BACKUP_DIR: "/backups" })?.retention, 7);
  assert.throws(() =>
    backupConfig({ TEA_BACKUP_DIR: "/backups", TEA_BACKUP_KEEP: "0" }),
  );
  assert.throws(() =>
    backupConfig({
      TEA_BACKUP_DIR: "/backups",
      TEA_BACKUP_INTERVAL_SECONDS: "NaN",
    }),
  );
  assert.equal(createBackupService("/unused", []).status().enabled, false);
});
