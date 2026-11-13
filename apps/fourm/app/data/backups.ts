import type { VerifiedBackupRecord } from "../backup-catalogue.ts";
import { planBackupRetention, backupNameTime } from "../backup-retention.ts";
import { CommunityError } from "./community.ts";
import type { Database, Member } from "./community.ts";

export function backupSchema(db: Database) {
  db.all(`CREATE TABLE IF NOT EXISTS backup_runs (
    name TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    state TEXT NOT NULL CHECK(state IN ('pending','complete','failed')),
    db_size INTEGER,
    file_count INTEGER,
    error TEXT,
    CHECK((state='pending' AND finished_at IS NULL AND db_size IS NULL AND file_count IS NULL AND error IS NULL)
       OR (state='complete' AND finished_at IS NOT NULL AND db_size IS NOT NULL AND file_count IS NOT NULL AND db_size>=0 AND file_count>=0 AND error IS NULL)
       OR (state='failed' AND finished_at IS NOT NULL AND db_size IS NULL AND file_count IS NULL AND error IS NOT NULL))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_pending_backup ON backup_runs(state) WHERE state='pending';`);
}
export function createBackups(db: Database, admin: (id: number) => Member) {
  function authorize(actorId: number | null) {
    if (actorId === null)
      throw new CommunityError(403, "Admin access required");
    admin(actorId);
  }
  function run(name: string) {
    const value = db.all("SELECT * FROM backup_runs WHERE name=?", name)[0];
    if (!value) throw new CommunityError(404, "Backup run not found");
    return value;
  }
  function finish(
    name: string,
    state: "complete" | "failed",
    dbSize: number | null,
    files: number | null,
    error: string | null,
  ) {
    return db.transaction(() => {
      const current = run(name);
      if (current.state !== "pending") {
        if (
          current.state !== state ||
          current.db_size !== dbSize ||
          current.file_count !== files ||
          current.error !== error
        )
          throw new CommunityError(
            409,
            "Backup run already has a different terminal result",
          );
        return current;
      }
      db.all(
        "UPDATE backup_runs SET state=?,finished_at=?,db_size=?,file_count=?,error=? WHERE name=?",
        state,
        Date.now(),
        dbSize,
        files,
        error,
        name,
      );
      return run(name);
    });
  }
  return {
    beginBackup(actorId: number | null) {
      authorize(actorId);
      return db.transaction(() => {
        const pending = db.all(
          "SELECT * FROM backup_runs WHERE state='pending'",
        )[0];
        if (pending) return pending;
        const now = Date.now();
        const name =
          new Date(now).toISOString().replace(/[:.]/g, "") +
          "-" +
          crypto.randomUUID();
        db.all(
          "INSERT INTO backup_runs(name,started_at,state) VALUES(?,?,'pending')",
          name,
          now,
        );
        return run(name);
      });
    },
    completeBackup(name: string, dbSize: number, files: number) {
      if (
        !Number.isSafeInteger(dbSize) ||
        dbSize < 0 ||
        !Number.isSafeInteger(files) ||
        files < 0
      )
        throw new CommunityError(422, "Invalid backup inventory");
      return finish(name, "complete", dbSize, files, null);
    },
    failBackup(name: string, error: string) {
      if (typeof error !== "string" || !error.trim() || error.length > 256)
        throw new CommunityError(422, "Invalid backup failure");
      return finish(name, "failed", null, null, error);
    },
    adoptVerifiedBackups(
      actorId: number | null,
      records: VerifiedBackupRecord[],
    ) {
      authorize(actorId);
      if (
        !Array.isArray(records) ||
        records.some(
          (record) =>
            !record ||
            typeof record.name !== "string" ||
            !/^[A-Za-z0-9-]{1,128}$/.test(record.name) ||
            [
              record.started_at,
              record.finished_at,
              record.db_size,
              record.file_count,
            ].some((value) => !Number.isSafeInteger(value) || value < 0) ||
            (backupNameTime(record.name) !== null &&
              backupNameTime(record.name) !== record.started_at),
        ) ||
        new Set(records.map((record) => record.name)).size !== records.length
      )
        throw new CommunityError(422, "Invalid verified backup catalogue");
      return db.transaction(() => {
        let adopted = 0,
          preserved = 0;
        const conflicts: string[] = [];
        for (const record of records.toSorted(
          (a, b) => a.started_at - b.started_at,
        )) {
          const existing = db.all(
            "SELECT * FROM backup_runs WHERE name=?",
            record.name,
          )[0];
          if (existing) {
            if (
              existing.started_at !== record.started_at ||
              existing.state === "failed" ||
              (existing.state === "complete" &&
                (existing.db_size !== record.db_size ||
                  existing.file_count !== record.file_count))
            ) {
              conflicts.push(record.name);
              continue;
            }
            if (existing.state === "complete") {
              preserved++;
              continue;
            }
            db.all(
              "UPDATE backup_runs SET state='complete',finished_at=?,db_size=?,file_count=? WHERE name=?",
              record.finished_at,
              record.db_size,
              record.file_count,
              record.name,
            );
          } else
            db.all(
              "INSERT INTO backup_runs(name,started_at,finished_at,state,db_size,file_count) VALUES(?,?,?,'complete',?,?)",
              record.name,
              record.started_at,
              record.finished_at,
              record.db_size,
              record.file_count,
            );
          adopted++;
        }
        return {
          state: conflicts.length
            ? ("conflicted" as const)
            : ("complete" as const),
          adopted,
          preserved,
          conflicts,
        };
      });
    },
    backupRetentionPlan(actorId: number | null) {
      authorize(actorId);
      const rows = db.all(
        "SELECT name,started_at FROM backup_runs WHERE state='complete'",
      );
      const managed = rows.filter(
        (row) => backupNameTime(String(row.name)) !== null,
      );
      const plan = planBackupRetention(
        managed.map((row) => ({
          name: String(row.name),
          startedAt: Number(row.started_at),
        })),
      );
      return {
        ...plan,
        keep: [
          ...plan.keep,
          ...rows
            .filter((row) => backupNameTime(String(row.name)) === null)
            .map((row) => String(row.name)),
        ],
      };
    },
    backupStatus(actorId: number | null) {
      authorize(actorId);
      return db.transaction(() => ({
        backups: db.all(
          "SELECT name,started_at,finished_at,db_size,file_count FROM backup_runs WHERE state='complete' ORDER BY started_at DESC,rowid DESC",
        ),
        pending:
          db.all("SELECT * FROM backup_runs WHERE state='pending'")[0] ?? null,
        last:
          db.all(
            "SELECT * FROM backup_runs WHERE state!='pending' ORDER BY finished_at DESC,rowid DESC LIMIT 1",
          )[0] ?? null,
      }));
    },
  };
}
