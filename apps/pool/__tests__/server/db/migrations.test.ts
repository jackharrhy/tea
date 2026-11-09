import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import {
  database,
  matches,
  migrateDatabase,
  recordedClientTraces,
  recordedChunks,
  recordedDiagnostics,
  recordedGames,
  recordedShots,
} from "../../../server/db/index";

// The pre-migration schema is a fixture, independent of the migration under test.
const legacy = `
CREATE TABLE matches (id INTEGER PRIMARY KEY, table_id TEXT, winner TEXT, players TEXT, finished_at INTEGER);
CREATE TABLE recorded_games(id TEXT PRIMARY KEY, table_id TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, outcome TEXT);
CREATE TABLE recorded_shots(id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES recorded_games(id) ON DELETE CASCADE, started_at INTEGER NOT NULL, finished_at INTEGER, flagged INTEGER NOT NULL DEFAULT 0, header TEXT NOT NULL);
CREATE TABLE recorded_chunks(shot_id TEXT NOT NULL REFERENCES recorded_shots(id) ON DELETE CASCADE, seq INTEGER NOT NULL, frames INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(shot_id,seq));
CREATE TABLE recorded_diagnostics(id INTEGER PRIMARY KEY, received_at INTEGER NOT NULL, kind TEXT NOT NULL, game_id TEXT, shot_id TEXT, data TEXT NOT NULL);
CREATE INDEX recorded_shots_game ON recorded_shots(game_id,started_at);`;

test("fresh and matches-only databases migrate idempotently without tightening legacy nullability", () => {
  for (const old of [false, true]) {
    const sqlite = new Database(":memory:");
    try {
      if (old) {
        sqlite.exec(legacy.split("CREATE TABLE recorded_games")[0]);
        sqlite.run("INSERT INTO matches(id,table_id) VALUES(7,'2')");
      }
      migrateDatabase(sqlite);
      const db = database(sqlite);
      if (old)
        expect(db.select().from(matches).all()).toEqual([
          {
            id: 7,
            tableId: "2",
            winner: null,
            players: null,
            finishedAt: null,
          },
        ]);
      const versions = sqlite.query("SELECT * FROM app_migrations").all();
      migrateDatabase(sqlite);
      expect(sqlite.query("SELECT * FROM app_migrations").all()).toEqual(
        versions,
      );
      expect(versions).toHaveLength(3);
      db.insert(matches).values({ tableId: null }).run();
      expect(db.select().from(recordedShots).all()).toEqual([]);
    } finally {
      sqlite.close();
    }
  }
});

test("adopting existing recordings preserves every row and compressed byte", () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec(legacy);
    sqlite.run(
      "INSERT INTO matches VALUES(1,'1','winner','[\"a\",\"b\"]',123)",
    );
    sqlite.run("INSERT INTO recorded_games VALUES('g','1',100,200,'won')");
    sqlite.run("INSERT INTO recorded_shots VALUES('s','g',110,190,1,?)", [
      JSON.stringify({ flags: ["old"], events: [] }),
    ]);
    const compressed = Bun.gzipSync('[{"tick":1}]');
    sqlite.run("INSERT INTO recorded_chunks VALUES('s',0,1,?)", [compressed]);
    sqlite.run(
      "INSERT INTO recorded_diagnostics VALUES(42,120,'admin','g','s','{\"event\":\"owner_action\"}')",
    );
    sqlite.exec(
      "CREATE TABLE app_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL); INSERT INTO app_migrations VALUES(1,10),(2,20)",
    );
    const before = [
      "matches",
      "recorded_games",
      "recorded_shots",
      "recorded_chunks",
      "recorded_diagnostics",
    ].map((table) => sqlite.query(`SELECT * FROM ${table}`).all());
    migrateDatabase(sqlite);
    migrateDatabase(sqlite);
    const after = [
      "matches",
      "recorded_games",
      "recorded_shots",
      "recorded_chunks",
      "recorded_diagnostics",
    ].map((table) => sqlite.query(`SELECT * FROM ${table}`).all());
    expect(after).toEqual(before);
    const db = database(sqlite);
    expect(db.select().from(recordedClientTraces).all()).toEqual([]);
    expect(
      sqlite.query("SELECT version FROM app_migrations ORDER BY version").all(),
    ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
    expect(db.select().from(recordedChunks).get()!.data).toEqual(
      Buffer.from(compressed),
    );
    expect(db.select().from(recordedDiagnostics).get()!.data.event).toBe(
      "owner_action",
    );
    expect(db.select().from(recordedGames).get()!.outcome).toBe("won");
    db.delete(recordedGames).run();
    expect(db.select().from(recordedShots).all()).toEqual([]);
    expect(db.select().from(recordedChunks).all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});

test("failed migration rolls back its ledger and additive DDL", () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec("CREATE TABLE recorded_shots(id TEXT PRIMARY KEY)");
    expect(() => migrateDatabase(sqlite)).toThrow();
    expect(
      sqlite
        .query(
          "SELECT name FROM sqlite_master WHERE name IN ('matches','app_migrations','recorded_games')",
        )
        .all(),
    ).toEqual([]);
    expect(sqlite.query("SELECT * FROM recorded_shots").all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});
