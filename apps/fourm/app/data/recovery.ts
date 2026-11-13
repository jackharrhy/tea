import type { BackupActor } from "./backups.ts";
import { coreTables } from "./schema.ts";
import { CommunityError } from "./community.ts";
import type { Database, Member, Row } from "./community.ts";
import { canonicalTables } from "../canonical-tables.ts";
export const recoveryTables = Object.freeze([
  ...coreTables,
  "browser_sessions",
  "login_transactions",
  "archive_receipts",
  "media_transfers",
  "media_moves",
  "media_move_files",
  "account_cleanup_users",
  "account_cleanup_objects",
  "orphan_cleanup_objects",
  "archive_staging_objects",
  "page_content_chunks",
  "counter_visits",
]);
export const recoveryExclusions = Object.freeze([
  "backup_runs",
  "_litestream_seq",
  "_litestream_lock",
  "_cf_KV",
  "_cf_ALARM",
  "_cf_METADATA",
  "_cf_FACETS",
  "_cf_WAKE",
]);
export interface RecoveryState {
  version: 1;
  tables: Record<string, Row[]>;
  columns: Record<string, string[]>;
  sequences: { name: string; seq: number }[];
  exclusions: string[];
}
export function validateRecoveryState(
  snapshot: RecoveryState,
  columns: Record<string, string[]>,
) {
  if (
    !snapshot ||
    snapshot.version !== 1 ||
    !snapshot.tables ||
    !snapshot.columns ||
    JSON.stringify(snapshot.exclusions) !==
      JSON.stringify(recoveryExclusions) ||
    Object.keys(snapshot.tables).length !== recoveryTables.length ||
    Object.keys(snapshot.columns).length !== recoveryTables.length ||
    !Array.isArray(snapshot.sequences)
  )
    throw new CommunityError(422, "Invalid native recovery inventory");
  for (const table of recoveryTables) {
    if (
      !Array.isArray(snapshot.tables[table]) ||
      JSON.stringify(snapshot.columns[table]) !== JSON.stringify(columns[table])
    )
      throw new CommunityError(422, "Native recovery schema does not match");
    for (const row of snapshot.tables[table]) {
      if (
        !row ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        Object.keys(row).length !== columns[table].length ||
        columns[table].some((column) => !Object.hasOwn(row, column)) ||
        Object.values(row).some(
          (value) =>
            value !== null &&
            typeof value !== "string" &&
            !(typeof value === "number" && Number.isFinite(value)),
        )
      )
        throw new CommunityError(422, "Invalid native recovery row");
    }
  }
  if (snapshot.tables.users.some((user) => user.password_hash !== ""))
    throw new CommunityError(
      422,
      "Local password credentials must not be restored",
    );
  if (
    snapshot.sequences.length > 1 ||
    snapshot.sequences.some(
      (row) =>
        !row ||
        row.name !== "media_moves" ||
        !Number.isSafeInteger(row.seq) ||
        row.seq < 0,
    )
  )
    throw new CommunityError(422, "Invalid native recovery sequence");
  const maxMove = snapshot.tables.media_moves.reduce(
    (maximum, row) => Math.max(maximum, Number(row.id)),
    0,
  );
  if (
    maxMove > 0 &&
    (!snapshot.sequences.length || snapshot.sequences[0].seq < maxMove)
  )
    throw new CommunityError(422, "Native recovery sequence precedes its rows");
}
export function createRecovery(db: Database, admin: (id: number) => Member) {
  function schemaColumns() {
    const known = new Set([...recoveryTables, ...recoveryExclusions]);
    const unknown = db
      .all("SELECT name FROM sqlite_master WHERE type='table'")
      .filter(
        (row) =>
          !String(row.name).startsWith("sqlite_") &&
          !known.has(String(row.name)),
      );
    if (unknown.length)
      throw new CommunityError(
        409,
        "Native backup schema inventory is incomplete: " +
          unknown.map((row) => String(row.name)).join(", "),
      );
    return Object.fromEntries(
      recoveryTables.map((table) => [
        table,
        db.all(`PRAGMA table_info("${table}")`).map((row) => String(row.name)),
      ]),
    );
  }
  function capture(): RecoveryState {
    return {
      version: 1,
      columns: schemaColumns(),
      tables: Object.fromEntries(
        recoveryTables.map((table) => [
          table,
          db.all(`SELECT * FROM "${table}"`),
        ]),
      ),
      sequences: db
        .all("SELECT name,seq FROM sqlite_sequence")
        .map((row) => ({ name: String(row.name), seq: Number(row.seq) })),
      exclusions: [...recoveryExclusions],
    };
  }

  return {
    exportRecovery(actorId: BackupActor) {
      if (actorId === null)
        throw new CommunityError(403, "Admin access required");
      if (actorId !== "scheduler") admin(actorId);
      return db.transaction(() => {
        const snapshot = capture();
        validateRecoveryState(snapshot, snapshot.columns);
        return snapshot;
      });
    },
    restoreRecovery(snapshot: RecoveryState) {
      return db.transaction(() => {
        const current = capture();
        validateRecoveryState(snapshot, current.columns);
        if (
          db.all("SELECT name FROM backup_runs WHERE state='pending' LIMIT 1")
            .length
        )
          throw new CommunityError(
            409,
            "Wait for the active backup before restoring",
          );
        const populated =
          recoveryTables.some((table) => current.tables[table].length > 0) ||
          current.sequences.length > 0;
        if (populated) {
          if (
            canonicalTables(current.tables) !==
              canonicalTables(snapshot.tables) ||
            JSON.stringify(current.sequences) !==
              JSON.stringify(snapshot.sequences)
          )
            throw new CommunityError(
              409,
              "Native recovery requires an empty authority or unchanged replay",
            );
          return {
            members: current.tables.users.length,
            tables: recoveryTables.length,
            preserved: true,
          };
        }
        db.all("PRAGMA defer_foreign_keys=ON");
        for (const table of recoveryTables) {
          const keys = current.columns[table];
          for (const row of snapshot.tables[table])
            db.all(
              `INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
              ...keys.map((key) => row[key]),
            );
        }
        db.all("DELETE FROM sqlite_sequence WHERE name='media_moves'");
        for (const sequence of snapshot.sequences)
          db.all(
            "INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)",
            sequence.name,
            sequence.seq,
          );
        if (db.all("PRAGMA foreign_key_check").length)
          throw new CommunityError(
            422,
            "Native recovery has broken ownership references",
          );
        const restored = capture();
        if (
          canonicalTables(restored.tables) !==
            canonicalTables(snapshot.tables) ||
          JSON.stringify(restored.sequences) !==
            JSON.stringify(snapshot.sequences)
        )
          throw new CommunityError(
            422,
            "Native recovery changed stored values",
          );
        return {
          members: snapshot.tables.users.length,
          tables: recoveryTables.length,
          preserved: false,
        };
      });
    },
  };
}
