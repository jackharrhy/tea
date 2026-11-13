import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { createCommunity } from "../app/data/community.ts";
import type { Row } from "../app/data/community.ts";
import { canonicalTables } from "../app/canonical-tables.ts";
function authority() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  const community = createCommunity({
    all(sql, ...values) {
      if (!values.length && sql.includes(";")) {
        sqlite.exec(sql);
        return [];
      }
      const statement = sqlite.prepare(sql);
      return statement.columns().length
        ? (statement.all(...values) as Row[])
        : (statement.run(...values), []);
    },
    transaction(operation) {
      sqlite.exec("BEGIN");
      try {
        const result = operation();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  });
  return { sqlite, community, close: () => sqlite.close() };
}
function seed(target: ReturnType<typeof authority>) {
  target.community.restore({
    users: [
      {
        id: 41,
        username: "jane",
        display_name: "Jane",
        password_hash: "",
        is_admin: 1,
      },
      { id: 72, username: "sam", display_name: "Sam", password_hash: "" },
    ],
    media: [
      {
        id: 11,
        user_id: 41,
        storage_path: "jane/original.txt",
        size_bytes: 3,
        mime_type: "text/plain",
      },
    ],
  });
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
it("restores operational tables, physical page chunks and sequence high-water without replaying the backup catalog", () => {
  const source = authority(),
    target = authority();
  try {
    seed(source);
    const body = "世界".repeat(550000);
    source.community.savePage(41, "large", {
      title: "Large",
      content: body,
      content_format: "html",
      is_public: "on",
    });
    source.community.createSession("a".repeat(64), 41, Date.now() + 60000);
    source.community.saveLogin(
      "b".repeat(64),
      JSON.stringify({ isolatedFixture: true }),
    );
    source.community.reserveUpload(72, "sam/pending.txt", "text/plain", 3);
    source.community.beginMediaRename(41, 11, "first.txt");
    source.sqlite.exec(
      "DELETE FROM media_move_files; DELETE FROM media_moves; UPDATE sqlite_sequence SET seq=70 WHERE name='media_moves'",
    );
    expect(source.community.beginMediaRename(41, 11, "second.txt")?.id).toBe(
      71,
    );
    source.community.beginOrphanCleanup(41, "jane/orphan.txt");
    source.community.reserveArchiveObject("jane/staged.txt");
    source.community.beginBackup(41);
    const snapshot = source.community.exportRecovery(41);
    expect(snapshot.exclusions).toEqual([
      "backup_runs",
      "_litestream_seq",
      "_litestream_lock",
      "_cf_KV",
      "_cf_ALARM",
      "_cf_METADATA",
      "_cf_FACETS",
      "_cf_WAKE",
    ]);
    expect(Object.keys(snapshot.tables)).toHaveLength(30);
    expect(snapshot.tables.page_content_chunks.length).toBeGreaterThan(1);
    expect(snapshot.tables.pages[0].content).toBe("");
    expect(snapshot.sequences).toEqual([{ name: "media_moves", seq: 71 }]);
    expect(target.community.restoreRecovery(snapshot)).toEqual({
      members: 2,
      tables: 30,
      preserved: false,
    });
    const readback = target.community.exportRecovery(41);
    expect(hash(canonicalTables(readback.tables))).toBe(
      hash(canonicalTables(snapshot.tables)),
    );
    expect(readback.sequences).toEqual(snapshot.sequences);
    expect(target.community.backupStatus(41).pending).toBeNull();
    expect(target.community.session("a".repeat(64))?.id).toBe(41);
    expect(
      hash(String(target.community.exportArchive(41).pages[0].content)),
    ).toBe(hash(body));
    expect(target.community.restoreRecovery(snapshot).preserved).toBe(true);
    expect(target.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    source.close();
    target.close();
  }
});
it("fails closed on unaccounted schema, credentials, field drift and broken ownership without partial writes", () => {
  const source = authority(),
    target = authority();
  try {
    seed(source);
    expect(() => source.community.exportRecovery(72)).toThrow(
      "Admin access required",
    );
    expect(() => source.community.exportRecovery(null)).toThrow(
      "Admin access required",
    );
    const snapshot = source.community.exportRecovery(41);
    const drift = structuredClone(snapshot);
    drift.columns.users.pop();
    expect(() => target.community.restoreRecovery(drift)).toThrow(
      "schema does not match",
    );
    const credentials = structuredClone(snapshot);
    credentials.tables.users[0].password_hash = "not-importable";
    expect(() => target.community.restoreRecovery(credentials)).toThrow(
      "credentials must not be restored",
    );
    const broken = structuredClone(snapshot);
    broken.tables.media[0].user_id = 999;
    expect(() => target.community.restoreRecovery(broken)).toThrow(
      "broken ownership references",
    );
    expect(target.community.members()).toEqual([]);
    const coercion = structuredClone(snapshot);
    coercion.tables.users[1].is_admin = "0";
    expect(() => target.community.restoreRecovery(coercion)).toThrow(
      "changed stored values",
    );
    expect(target.community.members()).toEqual([]);
    target.community.restoreRecovery(snapshot);
    target.sqlite
      .prepare("UPDATE users SET display_name='Changed' WHERE id=72")
      .run();
    expect(() => target.community.restoreRecovery(snapshot)).toThrow(
      "empty authority or unchanged replay",
    );
    source.sqlite.exec(
      "CREATE TABLE future_member_state(id INTEGER PRIMARY KEY)",
    );
    expect(() => source.community.exportRecovery(41)).toThrow(
      "schema inventory is incomplete",
    );
  } finally {
    source.close();
    target.close();
  }
});
