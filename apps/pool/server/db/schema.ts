import {
  blob,
  index,
  integer,
  primaryKey,
  uniqueIndex,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import type { RecordedShot } from "@tea/pool/recording";

export const matches = sqliteTable("matches", {
  id: integer("id").primaryKey(),
  tableId: text("table_id"),
  winner: text("winner"),
  players: text("players"),
  finishedAt: integer("finished_at"),
});
export const recordedGames = sqliteTable("recorded_games", {
  id: text("id").primaryKey(),
  tableId: text("table_id").notNull(),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  outcome: text("outcome"),
});
export const recordedShots = sqliteTable(
  "recorded_shots",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => recordedGames.id, { onDelete: "cascade" }),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
    flagged: integer("flagged").notNull().default(0),
    header: text("header", { mode: "json" }).$type<RecordedShot>().notNull(),
  },
  (table) => [index("recorded_shots_game").on(table.gameId, table.startedAt)],
);
export const recordedChunks = sqliteTable(
  "recorded_chunks",
  {
    shotId: text("shot_id")
      .notNull()
      .references(() => recordedShots.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    frames: integer("frames").notNull(),
    data: blob("data", { mode: "buffer" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.shotId, table.seq] })],
);
export const recordedDiagnostics = sqliteTable("recorded_diagnostics", {
  id: integer("id").primaryKey(),
  receivedAt: integer("received_at").notNull(),
  kind: text("kind").notNull(),
  gameId: text("game_id"),
  shotId: text("shot_id"),
  data: text("data", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull(),
});

export const recordedClientTraces = sqliteTable(
  "recorded_client_traces",
  {
    id: text("id").primaryKey(),
    shotId: text("shot_id")
      .notNull()
      .references(() => recordedShots.id, { onDelete: "cascade" }),
    reporterId: text("reporter_id").notNull(),
    reporterSeat: integer("reporter_seat").notNull(),
    receivedAt: integer("received_at").notNull(),
    serverTick: integer("server_tick").notNull(),
    data: blob("data", { mode: "buffer" }).notNull(),
  },
  (table) => [
    uniqueIndex("recorded_client_traces_reporter").on(
      table.shotId,
      table.reporterId,
    ),
    index("recorded_client_traces_received").on(table.receivedAt),
  ],
);
