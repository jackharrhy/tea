import type { Database } from "bun:sqlite";
import type { CatalogEntry, ValidationError } from "./catalog-validation";

const HEADER = `# Tile catalog. Source of truth for what can be painted.
# id is stable forever — never reuse an id, even if you delete a tile.
# type is one of: floor, wall, counter.

`;

const escape = (s: string) => s.replace(/"/g, '\\"');

export type AtlasMeta = { width: number; height: number };

// serializeCatalog stays available for one-off "dump current catalog as toml"
// scripts, but the running server no longer writes atlas.toml at runtime.
// Bun's --watch on the dev server would otherwise restart the process every
// time admin clicks Save; in prod the DB is the source of truth so the
// on-disk toml is just a bootstrap seed and doesn't need updating.
export const serializeCatalog = (
  entries: CatalogEntry[],
  meta?: AtlasMeta,
): string => {
  const sorted = [...entries].sort((a, b) => a.id - b.id);
  const blocks = sorted.map(
    (e) =>
      `[[tiles]]\nid = ${e.id}\ntype = "${escape(e.type)}"\nsrc_x = ${e.src_x}\nsrc_y = ${e.src_y}\nlabel = "${escape(e.label)}"\n`,
  );
  const metaBlock = meta
    ? `[meta]\n# Atlas image dimensions in pixels. Must match packages/burger-client/public/assets/atlas.png.\n# Update this when you swap in a larger atlas. Width and height should both be multiples of 32.\nwidth = ${meta.width}\nheight = ${meta.height}\n\n`
    : "";
  return HEADER + metaBlock + blocks.join("\n");
};

export type SaveResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };

export const saveCatalog = async ({
  db,
  entries,
  broadcast,
}: {
  db: Database;
  entries: CatalogEntry[];
  broadcast: (catalog: CatalogEntry[]) => void;
}): Promise<SaveResult> => {
  const newIds = new Set(entries.map((e) => e.id));
  const existingIds = (
    db.query("SELECT id FROM tile_catalog").all() as { id: number }[]
  ).map((r) => r.id);
  const removed = existingIds.filter((id) => !newIds.has(id));

  // Reject removals of ids that have active tile references.
  const blocked: { id: number; count: number }[] = [];
  for (const id of removed) {
    const row = db
      .query("SELECT COUNT(*) as c FROM tiles WHERE tile_id = ?")
      .get(id) as { c: number };
    if (row.c > 0) blocked.push({ id, count: row.c });
  }
  if (blocked.length > 0) {
    return {
      ok: false,
      errors: blocked.map(({ id, count }) => ({
        field: `entries.removed[${id}]`,
        message: `cannot delete catalog id ${id}: ${count} tile(s) reference it`,
      })),
    };
  }

  // Apply changes in a transaction.
  const tx = db.transaction(() => {
    // Delete removed ids.
    for (const id of removed) {
      db.run("DELETE FROM tile_catalog WHERE id = ?", [id]);
    }
    // Upsert remaining.
    const upsert = db.prepare(
      "INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET type = excluded.type, src_x = excluded.src_x, src_y = excluded.src_y, label = excluded.label",
    );
    for (const e of entries) {
      upsert.run(e.id, e.type, e.src_x, e.src_y, e.label);
    }
  });
  tx();

  // Broadcast new catalog.
  broadcast(entries);

  return { ok: true };
};
