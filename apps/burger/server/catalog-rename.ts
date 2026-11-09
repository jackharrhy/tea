import type { Database } from "bun:sqlite";
import type { ValidationError } from "./catalog-validation";

export type RenameResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };

export const renameCatalogId = (
  db: Database,
  { from, to }: { from: number; to: number },
): RenameResult => {
  if (!Number.isInteger(from) || from < 1) {
    return {
      ok: false,
      errors: [{ field: "from", message: "must be integer ≥ 1" }],
    };
  }
  if (!Number.isInteger(to) || to < 1) {
    return {
      ok: false,
      errors: [{ field: "to", message: "must be integer ≥ 1" }],
    };
  }
  if (from === to) {
    return {
      ok: false,
      errors: [{ field: "to", message: "must differ from `from`" }],
    };
  }

  const fromExists =
    (
      db
        .query("SELECT COUNT(*) as c FROM tile_catalog WHERE id = ?")
        .get(from) as { c: number }
    ).c > 0;
  if (!fromExists) {
    return {
      ok: false,
      errors: [{ field: "from", message: `id ${from} not found` }],
    };
  }
  const toExists =
    (
      db
        .query("SELECT COUNT(*) as c FROM tile_catalog WHERE id = ?")
        .get(to) as { c: number }
    ).c > 0;
  if (toExists) {
    return {
      ok: false,
      errors: [{ field: "to", message: `id ${to} already in use` }],
    };
  }

  const tx = db.transaction(() => {
    // Defer FK checks until commit: tiles.tile_id REFERENCES tile_catalog(id),
    // so we can't update tiles before tile_catalog (or vice versa) without this.
    db.run("PRAGMA defer_foreign_keys = ON");
    db.run("UPDATE tile_edits SET old_tile_id = ? WHERE old_tile_id = ?", [
      to,
      from,
    ]);
    db.run("UPDATE tile_edits SET new_tile_id = ? WHERE new_tile_id = ?", [
      to,
      from,
    ]);
    db.run("UPDATE tiles SET tile_id = ? WHERE tile_id = ?", [to, from]);
    db.run("UPDATE tile_catalog SET id = ? WHERE id = ?", [to, from]);
  });
  tx();

  return { ok: true };
};
