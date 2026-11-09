export type SpawnZone = { x: number; y: number; w: number; h: number };

export type WorldBounds = { x: number; y: number; w: number; h: number };

export type ValidationError = {
  field: string;
  message: string;
};

export type SpawnValidationResult =
  | { ok: true; zone: SpawnZone }
  | { ok: false; errors: ValidationError[] };

const intField = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v);

export const validateSpawn = (
  raw: unknown,
  world: WorldBounds,
): SpawnValidationResult => {
  if (typeof raw !== "object" || raw === null) {
    return {
      ok: false,
      errors: [{ field: "root", message: "must be object" }],
    };
  }
  const obj = raw as Record<string, unknown>;

  const errors: ValidationError[] = [];
  for (const k of ["x", "y", "w", "h"] as const) {
    if (!intField(obj[k])) {
      errors.push({ field: k, message: "must be integer" });
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const x = obj.x as number;
  const y = obj.y as number;
  const w = obj.w as number;
  const h = obj.h as number;

  if (w <= 0) errors.push({ field: "w", message: "must be > 0" });
  if (h <= 0) errors.push({ field: "h", message: "must be > 0" });
  if (x < world.x) errors.push({ field: "x", message: "outside world bounds" });
  if (y < world.y) errors.push({ field: "y", message: "outside world bounds" });
  if (x + w > world.x + world.w) {
    errors.push({ field: "w", message: "zone extends past world bounds" });
  }
  if (y + h > world.y + world.h) {
    errors.push({ field: "h", message: "zone extends past world bounds" });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, zone: { x, y, w, h } };
};
