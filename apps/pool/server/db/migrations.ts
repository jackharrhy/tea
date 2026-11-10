import type { Database } from "bun:sqlite";

// Append migrations; never change an applied version. SQL is embedded so bundled
// servers do not depend on a working directory or separately deployed SQL files.
const migrations = [
  `CREATE TABLE IF NOT EXISTS matches (id INTEGER PRIMARY KEY, table_id TEXT, winner TEXT, players TEXT, finished_at INTEGER);`,
  `CREATE TABLE IF NOT EXISTS recorded_games(id TEXT PRIMARY KEY, table_id TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, outcome TEXT);
   CREATE TABLE IF NOT EXISTS recorded_shots(id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES recorded_games(id) ON DELETE CASCADE, started_at INTEGER NOT NULL, finished_at INTEGER, flagged INTEGER NOT NULL DEFAULT 0, header TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS recorded_chunks(shot_id TEXT NOT NULL REFERENCES recorded_shots(id) ON DELETE CASCADE, seq INTEGER NOT NULL, frames INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(shot_id,seq));
   CREATE TABLE IF NOT EXISTS recorded_diagnostics(id INTEGER PRIMARY KEY, received_at INTEGER NOT NULL, kind TEXT NOT NULL, game_id TEXT, shot_id TEXT, data TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS recorded_shots_game ON recorded_shots(game_id,started_at);`,
  `CREATE TABLE recorded_client_traces(id TEXT PRIMARY KEY, shot_id TEXT NOT NULL REFERENCES recorded_shots(id) ON DELETE CASCADE, reporter_id TEXT NOT NULL, reporter_seat INTEGER NOT NULL, received_at INTEGER NOT NULL, server_tick INTEGER NOT NULL, data BLOB NOT NULL);
   CREATE UNIQUE INDEX recorded_client_traces_reporter ON recorded_client_traces(shot_id,reporter_id);
   CREATE INDEX recorded_client_traces_received ON recorded_client_traces(received_at);`,
];

export function migrateDatabase(sqlite: Database) {
  sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite
    .transaction(() => {
      sqlite.exec(
        "CREATE TABLE IF NOT EXISTS app_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
      );
      const applied = sqlite
        .query<{ version: number }, []>(
          "SELECT version FROM app_migrations ORDER BY version",
        )
        .all();
      if (
        applied.some(
          (row) => row.version < 1 || row.version > migrations.length,
        )
      ) {
        throw new Error("Database has an unsupported migration version");
      }
      for (const [index, migration] of migrations.entries()) {
        const version = index + 1;
        if (applied.some((row) => row.version === version)) continue;
        sqlite.exec(migration);
        sqlite.run(
          "INSERT INTO app_migrations(version,applied_at) VALUES(?,?)",
          [version, Date.now()],
        );
      }
    })
    .immediate();
}
