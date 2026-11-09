import type { Database } from "bun:sqlite";

export const PALETTE_MAX_SIZE = 9;

export type ValidationError = { field: string; message: string };

export type PaletteValidationResult =
  | { ok: true; ids: number[] }
  | { ok: false; errors: ValidationError[] };

export const validatePaletteIds = (raw: unknown): PaletteValidationResult => {
  if (!Array.isArray(raw)) {
    return { ok: false, errors: [{ field: "root", message: "must be array" }] };
  }
  if (raw.length > PALETTE_MAX_SIZE) {
    return {
      ok: false,
      errors: [
        {
          field: "root",
          message: `palette can hold at most ${PALETTE_MAX_SIZE} ids`,
        },
      ],
    };
  }
  const seen = new Set<number>();
  const ids: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (!Number.isInteger(v) || (v as number) < 1) {
      return {
        ok: false,
        errors: [{ field: `[${i}]`, message: "must be integer ≥ 1" }],
      };
    }
    const id = v as number;
    if (seen.has(id)) {
      return {
        ok: false,
        errors: [{ field: `[${i}]`, message: `duplicate id ${id}` }],
      };
    }
    seen.add(id);
    ids.push(id);
  }
  return { ok: true, ids };
};

export const getPalette = (db: Database, userId: string): number[] => {
  const row = db
    .query("SELECT tile_ids FROM palettes WHERE user_id = ?")
    .get(userId) as { tile_ids: string } | null;
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.tile_ids);
    return Array.isArray(parsed) ? parsed.filter(Number.isInteger) : [];
  } catch {
    return [];
  }
};

export const setPalette = (
  db: Database,
  userId: string,
  ids: number[],
): void => {
  db.run(
    "INSERT INTO palettes (user_id, tile_ids, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET tile_ids = excluded.tile_ids, updated_at = excluded.updated_at",
    [userId, JSON.stringify(ids), Date.now()],
  );
};
