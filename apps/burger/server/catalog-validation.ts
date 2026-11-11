import { TILE_SIZE } from "@harrhy/burger-core";

export type CatalogEntry = {
  id: number;
  type: "floor" | "wall" | "counter";
  src_x: number;
  src_y: number;
  label: string;
};

export type ValidationError = {
  field: string;
  message: string;
};

export type ValidationResult =
  | { ok: true; entries: CatalogEntry[] }
  | { ok: false; errors: ValidationError[] };

const VALID_TYPES = new Set(["floor", "wall", "counter"]);

export const validateCatalog = (
  raw: unknown,
  { atlasW, atlasH }: { atlasW: number; atlasH: number },
): ValidationResult => {
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      errors: [{ field: "root", message: "expected array" }],
    };
  }

  const errors: ValidationError[] = [];
  const seenIds = new Set<number>();
  const seenCoords = new Set<string>();
  const entries: CatalogEntry[] = [];

  for (let i = 0; i < raw.length; i++) {
    const e = raw[i];
    const prefix = `entries[${i}]`;

    if (typeof e !== "object" || e === null) {
      errors.push({ field: prefix, message: "must be object" });
      continue;
    }
    const obj = e as Record<string, unknown>;

    if (!Number.isInteger(obj.id) || (obj.id as number) < 1) {
      errors.push({ field: `${prefix}.id`, message: "must be integer ≥ 1" });
      continue;
    }
    const id = obj.id as number;
    if (seenIds.has(id)) {
      errors.push({ field: `${prefix}.id`, message: `duplicate id ${id}` });
      continue;
    }
    seenIds.add(id);

    if (typeof obj.type !== "string" || !VALID_TYPES.has(obj.type)) {
      errors.push({
        field: `${prefix}.type`,
        message: `must be one of floor, wall, counter`,
      });
      continue;
    }

    if (!Number.isInteger(obj.src_x) || (obj.src_x as number) < 0) {
      errors.push({ field: `${prefix}.src_x`, message: "must be integer ≥ 0" });
      continue;
    }
    if (!Number.isInteger(obj.src_y) || (obj.src_y as number) < 0) {
      errors.push({ field: `${prefix}.src_y`, message: "must be integer ≥ 0" });
      continue;
    }
    const src_x = obj.src_x as number;
    const src_y = obj.src_y as number;
    if (src_x % TILE_SIZE !== 0 || src_y % TILE_SIZE !== 0) {
      errors.push({
        field: `${prefix}.src_x`,
        message: `must be multiple of ${TILE_SIZE}`,
      });
      continue;
    }
    if (src_x + TILE_SIZE > atlasW || src_y + TILE_SIZE > atlasH) {
      errors.push({
        field: `${prefix}.src_x`,
        message: `out of atlas bounds (${atlasW}x${atlasH})`,
      });
      continue;
    }
    const coordKey = `${src_x},${src_y}`;
    if (seenCoords.has(coordKey)) {
      errors.push({
        field: `${prefix}.src_x`,
        message: `duplicate source coords (${src_x},${src_y})`,
      });
      continue;
    }
    seenCoords.add(coordKey);

    if (typeof obj.label !== "string" || obj.label.length === 0) {
      errors.push({
        field: `${prefix}.label`,
        message: "must be non-empty string",
      });
      continue;
    }

    entries.push({
      id,
      type: obj.type as "floor" | "wall" | "counter",
      src_x,
      src_y,
      label: obj.label,
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, entries };
};
