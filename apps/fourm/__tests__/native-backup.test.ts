import { pruneNativeBackups } from "../app/backup-pruning.ts";
import { runNativeBackup } from "../app/backup-runner.ts";
import { inspectBackupCatalogue } from "../app/backup-catalogue.ts";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { createCommunity } from "../app/data/community.ts";
import type { Row } from "../app/data/community.ts";
import { canonicalTables } from "../app/canonical-tables.ts";
import {
  captureNativeBackup,
  readNativeBackup,
  restoreNativeBackup,
} from "../app/native-backup.ts";
function authority() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const community = createCommunity({
    all(sql, ...values) {
      if (!values.length && sql.includes(";")) {
        db.exec(sql);
        return [];
      }
      const query = db.prepare(sql);
      return query.columns().length
        ? (query.all(...values) as Row[])
        : (query.run(...values), []);
    },
    transaction(fn) {
      db.exec("BEGIN");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  });
  return { db, community };
}
interface ObjectValue {
  bytes: Uint8Array;
  customMetadata: Record<string, string>;
  httpMetadata: R2HTTPMetadata;
  uploaded: Date;
}
function bucket() {
  const objects = new Map<string, ObjectValue>();
  let lostAck = false;
  const info = (key: string) => {
    const file = objects.get(key);
    if (!file) return null;
    const etag = createHash("sha256").update(file.bytes).digest("hex");
    return {
      key,
      size: file.bytes.length,
      etag,
      httpEtag: `"${etag}"`,
      uploaded: file.uploaded,
      customMetadata: file.customMetadata,
      httpMetadata: file.httpMetadata,
    };
  };
  const storage = {
    async head(key: string) {
      return info(key);
    },
    async get(key: string) {
      const value = objects.get(key);
      return value
        ? { ...info(key), arrayBuffer: async () => value.bytes.slice().buffer }
        : null;
    },
    async put(key: string, body: ArrayBuffer, options: R2PutOptions) {
      if (objects.has(key)) return null;
      objects.set(key, {
        bytes: new Uint8Array(body).slice(),
        customMetadata: options.customMetadata ?? {},
        httpMetadata: (options.httpMetadata as R2HTTPMetadata) ?? {},
        uploaded: new Date("2026-11-13T00:00:00Z"),
      });
      if (lostAck && key.startsWith(".backups/native/")) {
        lostAck = false;
        throw Error("Manifest acknowledgment lost");
      }
      return info(key);
    },
    async list(options?: R2ListOptions) {
      const keys = [...objects.keys()]
          .filter((key) => !options?.prefix || key.startsWith(options.prefix))
          .toSorted(),
        start = Number(options?.cursor ?? 0),
        next = start + 2;
      return {
        objects: keys.slice(start, next).map((key) => info(key)),
        truncated: next < keys.length,
        ...(next < keys.length ? { cursor: String(next) } : {}),
      };
    },
  } as Pick<R2Bucket, "get" | "head" | "put" | "list">;
  function add(
    key: string,
    text: string,
    customMetadata: Record<string, string> = {},
  ) {
    objects.set(key, {
      bytes: new TextEncoder().encode(text),
      customMetadata,
      httpMetadata: {
        contentType: "text/plain",
        cacheExpiry: new Date("2030-01-01T00:00:00Z"),
      },
      uploaded: new Date("2026-11-12T01:00:00Z"),
    });
  }
  return {
    storage,
    objects,
    add,
    loseAck: () => {
      lostAck = true;
    },
  };
}
function seed(source: ReturnType<typeof authority>) {
  source.community.restore({
    users: [
      {
        id: 41,
        username: "fixture",
        display_name: "Fixture",
        password_hash: "",
        is_admin: 1,
      },
    ],
    media: [
      {
        id: 1,
        user_id: 41,
        storage_path: "fixture/kept.txt",
        size_bytes: 4,
        mime_type: "text/plain",
      },
      {
        id: 2,
        user_id: 41,
        storage_path: "fixture/already-missing.txt",
        size_bytes: 3,
        mime_type: "text/plain",
      },
    ],
  });
  source.community.createSession("synthetic-session", 41, Date.now() + 60000);
  source.community.reserveArchiveObject("fixture/staged.txt");
}
it("captures SQL state, unreferenced/staged files and absence, then restores into an empty authority", async () => {
  const source = authority(),
    target = authority(),
    r2 = bucket();
  try {
    seed(source);
    r2.add("fixture/kept.txt", "kept");
    r2.add("fixture/orphan.txt", "unreferenced");
    r2.add("fixture/staged.txt", "staged", {
      archive_sha256: "fixture-marker",
    });
    r2.add(".private/member-note", "extra");
    const captured = await captureNativeBackup(
      r2.storage,
      "full-one",
      async () => source.community.exportRecovery(41),
    );
    expect(captured.files).toHaveLength(4);
    expect(captured.recovery.tables.media).toHaveLength(2);
    expect(captured.recovery.tables.browser_sessions).toHaveLength(1);
    expect(
      captured.files.some((file) => file.key === "fixture/already-missing.txt"),
    ).toBe(false);
    // Replay against unchanged live storage must not rewrite original metadata.
    await restoreNativeBackup(r2.storage, "full-one", async () => ({
      preserved: true,
    }));
    for (const key of r2.objects.keys())
      if (!key.startsWith(".backups/")) r2.objects.delete(key);
    const restored = await restoreNativeBackup(
      r2.storage,
      "full-one",
      async (state) => target.community.restoreRecovery(state),
    );
    expect(restored.files).toBe(4);
    expect(restored.state).toMatchObject({ members: 1, tables: 30 });
    expect(canonicalTables(target.community.exportRecovery(41).tables)).toBe(
      canonicalTables(captured.recovery.tables),
    );
    expect(r2.objects.get("fixture/orphan.txt")?.bytes).toEqual(
      new TextEncoder().encode("unreferenced"),
    );
    expect(
      r2.objects.get("fixture/staged.txt")?.customMetadata.archive_sha256,
    ).toBe("fixture-marker");
    expect(
      r2.objects.get("fixture/kept.txt")?.customMetadata.fourm_last_modified,
    ).toBe("Thu, 12 Nov 2026 01:00:00 GMT");
    expect(
      (
        await restoreNativeBackup(r2.storage, "full-one", async (state) =>
          target.community.restoreRecovery(state),
        )
      ).state.preserved,
    ).toBe(true);
  } finally {
    source.db.close();
    target.db.close();
  }
});
it("recovers a lost manifest acknowledgment and refuses to overwrite unrelated target files", async () => {
  const source = authority(),
    r2 = bucket();
  try {
    seed(source);
    r2.add("fixture/kept.txt", "kept");
    r2.loseAck();
    await expect(
      captureNativeBackup(r2.storage, "retry", async () =>
        source.community.exportRecovery(41),
      ),
    ).rejects.toThrow("acknowledgment lost");
    source.db
      .prepare("UPDATE users SET display_name='Later' WHERE id=41")
      .run();
    const original = await captureNativeBackup(r2.storage, "retry", async () =>
      source.community.exportRecovery(41),
    );
    expect(original.recovery.tables.users[0].display_name).not.toBe("Later");
    r2.add("fixture/unique.txt", "must survive");
    let called = false;
    await expect(
      restoreNativeBackup(r2.storage, "retry", async () => {
        called = true;
      }),
    ).rejects.toThrow("unrelated files");
    expect(called).toBe(false);
    expect(r2.objects.has("fixture/unique.txt")).toBe(true);
    r2.objects.delete("fixture/unique.txt");
    const uniqueBytes = new TextEncoder().encode("different live content");
    r2.objects.get("fixture/kept.txt")!.bytes = uniqueBytes;
    await expect(
      restoreNativeBackup(r2.storage, "retry", async () => {
        called = true;
      }),
    ).rejects.toThrow("file differs from snapshot");
    expect(called).toBe(false);
    expect(r2.objects.get("fixture/kept.txt")!.bytes).toEqual(uniqueBytes);
  } finally {
    source.db.close();
  }
});
it("does not publish changed state and rejects corrupt stored file bytes before restoring SQL", async () => {
  const source = authority(),
    r2 = bucket();
  try {
    seed(source);
    r2.add("fixture/kept.txt", "kept");
    let reads = 0;
    await expect(
      captureNativeBackup(r2.storage, "changed", async () => {
        if (reads++)
          source.db
            .prepare("UPDATE users SET display_name='Changed' WHERE id=41")
            .run();
        return source.community.exportRecovery(41);
      }),
    ).rejects.toThrow("Application state changed");
    expect(r2.objects.has(".backups/native/changed.json")).toBe(false);
    const saved = await captureNativeBackup(r2.storage, "corrupt", async () =>
      source.community.exportRecovery(41),
    );
    r2.objects.get(".backups/objects/" + saved.files[0].sha256)!.bytes =
      new Uint8Array([9]);
    await expect(readNativeBackup(r2.storage, "corrupt")).rejects.toThrow(
      "file verification failed",
    );
    let called = false;
    await expect(
      restoreNativeBackup(r2.storage, "corrupt", async () => {
        called = true;
      }),
    ).rejects.toThrow("file verification failed");
    expect(called).toBe(false);
  } finally {
    source.db.close();
  }
});

it("reconstructs only verified catalog entries, resolves pending acknowledgments and leaves corrupt objects untouched", async () => {
  const source = authority(),
    r2 = bucket();
  try {
    seed(source);
    r2.add("fixture/kept.txt", "kept");
    const job = source.community.beginBackup(41);
    const saved = await captureNativeBackup(
      r2.storage,
      String(job.name),
      async () => source.community.exportRecovery(41),
    );
    const catalogue = await inspectBackupCatalogue(r2.storage);
    expect(catalogue.rejected).toEqual([]);
    expect(catalogue.records).toHaveLength(1);
    expect(catalogue.records[0].started_at).toBe(job.started_at);
    expect(
      source.community.adoptVerifiedBackups(41, catalogue.records),
    ).toEqual({ state: "complete", adopted: 1, preserved: 0, conflicts: [] });
    const first = source.community.backupStatus(41).last;
    expect(
      source.community.adoptVerifiedBackups(41, catalogue.records),
    ).toEqual({ state: "complete", adopted: 0, preserved: 1, conflicts: [] });
    expect(source.community.backupStatus(41).last).toEqual(first);
    r2.objects.get(".backups/objects/" + saved.files[0].sha256)!.bytes =
      new Uint8Array([9]);
    r2.add(".backups/native/unrecognized.txt", "keep this evidence");
    const before = [...r2.objects.keys()].toSorted();
    const rejected = await inspectBackupCatalogue(r2.storage);
    expect(rejected.records).toEqual([]);
    expect(rejected.rejected).toHaveLength(2);
    expect([...r2.objects.keys()].toSorted()).toEqual(before);
    expect(source.community.backupStatus(41).last).toEqual(first);
  } finally {
    source.db.close();
  }
});
it("preserves terminal conflicts and protects manually named recovered snapshots from automatic retention", () => {
  const source = authority();
  try {
    seed(source);
    const job = source.community.beginBackup(41);
    source.community.failBackup(String(job.name), "Known failed attempt");
    const facts = {
      name: String(job.name),
      started_at: Number(job.started_at),
      finished_at: Date.now(),
      db_size: 100,
      file_count: 1,
    };
    expect(source.community.adoptVerifiedBackups(41, [facts])).toEqual({
      state: "conflicted",
      adopted: 0,
      preserved: 0,
      conflicts: [job.name],
    });
    expect(source.community.backupStatus(41).last?.state).toBe("failed");
    expect(() => source.community.adoptVerifiedBackups(null, [facts])).toThrow(
      "Admin access required",
    );
    expect(() =>
      source.community.adoptVerifiedBackups(41, [
        null as unknown as typeof facts,
      ]),
    ).toThrow("Invalid verified backup catalogue");
    const manual = { ...facts, name: "manual-preserve", started_at: 0 };
    expect(source.community.adoptVerifiedBackups(41, [manual]).adopted).toBe(1);
    expect(source.community.backupRetentionPlan(41)).toEqual({
      keep: ["manual-preserve"],
      remove: [],
    });
  } finally {
    source.db.close();
  }
});

it("manual backup reports a verified snapshot even when its publication acknowledgment is lost", async () => {
  const source = authority(),
    r2 = bucket();
  try {
    seed(source);
    r2.add("fixture/file.txt", "kept");
    r2.loseAck();
    const result = await runNativeBackup(source.community, r2.storage, 41);
    expect(result.state).toBe("complete");
    expect(result.file_count).toBe(1);
    expect(source.community.backupStatus(41).pending).toBeNull();
    expect(
      await readNativeBackup(r2.storage, String(result.name)),
    ).not.toBeNull();
  } finally {
    source.db.close();
  }
});

it("manual backup preserves an uncertain outcome for retry and records a confirmed pre-publication failure", async () => {
  const source = authority(),
    r2 = bucket();
  try {
    seed(source);
    let unavailable = true;
    const flaky = {
      ...r2.storage,
      async get(key: string) {
        if (unavailable) throw Error("storage unavailable");
        return r2.storage.get(key);
      },
    };
    await expect(
      runNativeBackup(source.community, flaky, 41),
    ).rejects.toMatchObject({ status: 503 });
    const pending = source.community.backupStatus(41).pending;
    expect(pending).not.toBeNull();
    unavailable = false;
    const retry = await runNativeBackup(source.community, flaky, 41);
    expect(retry.name).toBe(pending!.name);
    expect(retry.state).toBe("complete");
    const broken = {
      ...r2.storage,
      async list() {
        throw Error("listing unavailable");
      },
    };
    const failed = await runNativeBackup(source.community, broken, 41);
    expect(failed.state).toBe("failed");
    expect(failed.error).toBe("Backup could not finish. Try again.");
    expect(source.community.backupStatus(41).pending).toBeNull();
    await expect(
      runNativeBackup(source.community, r2.storage, null),
    ).rejects.toMatchObject({ status: 403 });
  } finally {
    source.db.close();
  }
});

it("prunes expired native roots with replay after lost deletion acknowledgment, retaining shared files and manual snapshots", async () => {
  const source = authority(),
    r2 = bucket();
  try {
    seed(source);
    r2.add("fixture/file.txt", "retained bytes");
    const day = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const names = ["01", "02", "03"].map(
      (hour) => `${day}T${hour}0000000Z-11111111-1111-4111-8111-111111111111`,
    );
    for (const name of [...names, "manual-preserve"])
      await captureNativeBackup(r2.storage, name, async () =>
        source.community.exportRecovery(41),
      );
    const verified = await inspectBackupCatalogue(r2.storage);
    expect(verified.rejected).toEqual([]);
    source.community.adoptVerifiedBackups(41, verified.records);
    let lost = true;
    const deleted: string[] = [];
    const storage = {
      ...r2.storage,
      async delete(key: string) {
        deleted.push(key);
        r2.objects.delete(key);
        if (lost) {
          lost = false;
          throw Error("delete acknowledgment lost");
        }
      },
    };
    await expect(
      pruneNativeBackups(source.community, storage, 41),
    ).rejects.toThrow("acknowledgment lost");
    expect(source.community.backupStatus(41).backups).toHaveLength(4);
    expect(await pruneNativeBackups(source.community, storage, 41)).toEqual({
      removed: 2,
    });
    expect(await pruneNativeBackups(source.community, storage, 41)).toEqual({
      removed: 0,
    });
    expect(
      source.community
        .backupStatus(41)
        .backups.map((row) => row.name)
        .toSorted((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(
      [names[2], "manual-preserve"].toSorted((a, b) => a.localeCompare(b)),
    );
    expect(deleted.every((key) => key.startsWith(".backups/native/"))).toBe(
      true,
    );
    expect(await readNativeBackup(r2.storage, names[2])).not.toBeNull();
    expect(
      await readNativeBackup(r2.storage, "manual-preserve"),
    ).not.toBeNull();
    expect(r2.objects.get("fixture/file.txt")!.bytes).toEqual(
      new TextEncoder().encode("retained bytes"),
    );
    expect(() => source.community.forgetPrunedBackup(41, names[2])).toThrow(
      "protected",
    );
    await expect(
      pruneNativeBackups(source.community, storage, null),
    ).rejects.toMatchObject({ status: 403 });
    source.community.beginBackup(41);
    await expect(
      pruneNativeBackups(source.community, storage, 41),
    ).rejects.toMatchObject({ status: 409 });
  } finally {
    source.db.close();
  }
});

it("retains expired snapshot evidence when verification fails", async () => {
  const source = authority(),
    r2 = bucket();
  try {
    seed(source);
    r2.add("fixture/file.txt", "retained bytes");
    const day = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const names = ["01", "02"].map(
      (hour) => `${day}T${hour}0000000Z-11111111-1111-4111-8111-111111111111`,
    );
    for (const name of names)
      await captureNativeBackup(r2.storage, name, async () =>
        source.community.exportRecovery(41),
      );
    source.community.adoptVerifiedBackups(
      41,
      (await inspectBackupCatalogue(r2.storage)).records,
    );
    const key = `.backups/native/${names[0]}.json`;
    r2.objects.get(key)!.bytes = new TextEncoder().encode("damaged manifest");
    let deletes = 0;
    const storage = {
      ...r2.storage,
      async delete() {
        deletes++;
      },
    };
    await expect(
      pruneNativeBackups(source.community, storage, 41),
    ).rejects.toMatchObject({ status: 409 });
    expect(deletes).toBe(0);
    expect(r2.objects.has(key)).toBe(true);
    expect(source.community.backupStatus(41).backups).toHaveLength(2);
  } finally {
    source.db.close();
  }
});
