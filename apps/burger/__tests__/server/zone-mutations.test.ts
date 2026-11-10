import { expect, test, describe, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../server/db";
import { loadZones } from "../../server/zones";
import {
  createZone,
  renameZone,
  deleteZone,
  mutateZoneCells,
  setZoneMembers,
} from "../../server/zone-mutations";

let db: Database;
let zonesState: ReturnType<typeof loadZones>;
const bounds = { x: 0, y: 0, w: 2048, h: 2048 };

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
  db.run(
    "INSERT INTO users (id, fourm_id, username, display_name, is_admin, created_at) VALUES ('u1', 'fid-u1', 'u1', 'u1', 0, 0)",
  );
  db.run(
    "INSERT INTO users (id, fourm_id, username, display_name, is_admin, created_at) VALUES ('u2', 'fid-u2', 'u2', 'u2', 0, 0)",
  );
  zonesState = loadZones(db);
});

describe("createZone", () => {
  test("inserts a row, returns the new id, mirrors to state", () => {
    const r = createZone(db, zonesState, "kitchen");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.id).toBeGreaterThan(0);
    expect(r.name).toBe("kitchen");
    const row = db.query("SELECT name FROM zones WHERE id = ?").get(r.id) as {
      name: string;
    } | null;
    expect(row?.name).toBe("kitchen");
    expect(zonesState.zones.get(r.id)?.name).toBe("kitchen");
  });

  test("rejects duplicate name with conflict result", () => {
    createZone(db, zonesState, "kitchen");
    const r2 = createZone(db, zonesState, "kitchen");
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.error).toBe("name_taken");
  });

  test("rejects invalid name", () => {
    const r = createZone(db, zonesState, "");
    expect(r.ok).toBe(false);
  });
});

describe("renameZone", () => {
  test("updates DB and state", () => {
    const c = createZone(db, zonesState, "kitchen");
    if (!c.ok) throw new Error("setup failed");
    const r = renameZone(db, zonesState, c.id, "bar");
    expect(r.ok).toBe(true);
    expect(zonesState.zones.get(c.id)?.name).toBe("bar");
    const row = db.query("SELECT name FROM zones WHERE id = ?").get(c.id) as {
      name: string;
    } | null;
    expect(row?.name).toBe("bar");
  });

  test("returns not_found for unknown id", () => {
    const r = renameZone(db, zonesState, 999, "x");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("not_found");
  });

  test("rejects duplicate name", () => {
    const a = createZone(db, zonesState, "a");
    const b = createZone(db, zonesState, "b");
    if (!a.ok || !b.ok) throw new Error("setup failed");
    const r = renameZone(db, zonesState, b.id, "a");
    expect(r.ok).toBe(false);
  });
});

describe("deleteZone", () => {
  test("cascades to cells + members; mirror is cleared; returns affected user ids", () => {
    const c = createZone(db, zonesState, "z");
    if (!c.ok) throw new Error("setup failed");
    mutateZoneCells(
      db,
      zonesState,
      c.id,
      { add: [[16, 16]], remove: [] },
      bounds,
    );
    setZoneMembers(db, zonesState, c.id, ["u1", "u2"]);

    const r = deleteZone(db, zonesState, c.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.affectedUserIds.toSorted()).toEqual(["u1", "u2"]);
    expect(zonesState.zones.has(c.id)).toBe(false);
    expect(zonesState.cellToZone.has("16,16")).toBe(false);
    const cellRows = db
      .query("SELECT * FROM zone_cells WHERE zone_id = ?")
      .all(c.id);
    expect(cellRows.length).toBe(0);
  });

  test("returns not_found for unknown id", () => {
    const r = deleteZone(db, zonesState, 999);
    expect(r.ok).toBe(false);
  });
});

describe("mutateZoneCells", () => {
  test("adds cells; updates state and DB", () => {
    const c = createZone(db, zonesState, "z");
    if (!c.ok) throw new Error("setup failed");
    const r = mutateZoneCells(
      db,
      zonesState,
      c.id,
      {
        add: [
          [16, 16],
          [48, 16],
        ],
        remove: [],
      },
      bounds,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.added).toBe(2);
    expect(zonesState.zones.get(c.id)?.cells.size).toBe(2);
    expect(zonesState.cellToZone.get("16,16")).toBe(c.id);
  });

  test("removes cells; updates state and DB", () => {
    const c = createZone(db, zonesState, "z");
    if (!c.ok) throw new Error("setup failed");
    mutateZoneCells(
      db,
      zonesState,
      c.id,
      {
        add: [
          [16, 16],
          [48, 16],
        ],
        remove: [],
      },
      bounds,
    );
    const r = mutateZoneCells(
      db,
      zonesState,
      c.id,
      { add: [], remove: [[16, 16]] },
      bounds,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBe(1);
    expect(zonesState.cellToZone.has("16,16")).toBe(false);
    expect(zonesState.cellToZone.get("48,16")).toBe(c.id);
  });

  test("overlap: adding cell already in another zone reassigns it (last-write-wins)", () => {
    const a = createZone(db, zonesState, "a");
    const b = createZone(db, zonesState, "b");
    if (!a.ok || !b.ok) throw new Error("setup failed");
    mutateZoneCells(
      db,
      zonesState,
      a.id,
      { add: [[16, 16]], remove: [] },
      bounds,
    );
    const r = mutateZoneCells(
      db,
      zonesState,
      b.id,
      { add: [[16, 16]], remove: [] },
      bounds,
    );
    expect(r.ok).toBe(true);
    expect(zonesState.cellToZone.get("16,16")).toBe(b.id);
    expect(zonesState.zones.get(a.id)?.cells.has("16,16")).toBe(false);
    expect(zonesState.zones.get(b.id)?.cells.has("16,16")).toBe(true);
  });

  test("dropped count includes invalid coords", () => {
    const c = createZone(db, zonesState, "z");
    if (!c.ok) throw new Error("setup failed");
    const r = mutateZoneCells(
      db,
      zonesState,
      c.id,
      {
        add: [
          [16, 16],
          [15, 16],
        ],
        remove: [],
      },
      bounds,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.added).toBe(1);
    expect(r.dropped).toBe(1);
  });

  test("not_found for unknown zone", () => {
    const r = mutateZoneCells(
      db,
      zonesState,
      999,
      { add: [], remove: [] },
      bounds,
    );
    expect(r.ok).toBe(false);
  });
});

describe("setZoneMembers", () => {
  test("replaces membership; returns affected user ids (added+removed); dropped count for unknown ids", () => {
    const c = createZone(db, zonesState, "z");
    if (!c.ok) throw new Error("setup failed");
    setZoneMembers(db, zonesState, c.id, ["u1"]);
    const r = setZoneMembers(db, zonesState, c.id, ["u2", "ghost"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.memberUserIds.toSorted()).toEqual(["u2"]);
    expect(r.dropped).toBe(1);
    expect(r.affectedUserIds.toSorted()).toEqual(["u1", "u2"]);
    expect(zonesState.zones.get(c.id)?.members.has("u1")).toBe(false);
    expect(zonesState.zones.get(c.id)?.members.has("u2")).toBe(true);
  });

  test("idempotent on no-op", () => {
    const c = createZone(db, zonesState, "z");
    if (!c.ok) throw new Error("setup failed");
    setZoneMembers(db, zonesState, c.id, ["u1"]);
    const r = setZoneMembers(db, zonesState, c.id, ["u1"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.affectedUserIds).toEqual([]);
  });
});
