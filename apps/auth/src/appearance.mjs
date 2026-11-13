import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  defaultPool,
  validPool,
  dailyDoodle,
  renderDoodle,
} from "./doodles.mjs";

export function dailyArtwork(day = new Date().toISOString().slice(0, 10)) {
  const filename =
    process.env.DOODLE_POOL_FILE ||
    (process.env.RADIO_ENROLLMENT_DB_FILE
      ? join(dirname(process.env.RADIO_ENROLLMENT_DB_FILE), "doodle-pool.json")
      : null);
  let pool = defaultPool,
    settings = {};
  if (filename)
    try {
      const saved = JSON.parse(readFileSync(filename, "utf8"));
      if (validPool(saved.enabled)) pool = saved.enabled;
      settings = saved.settings || {};
    } catch {}
  const id = dailyDoodle(pool, day);
  return renderDoodle(id, day, settings[id]);
}
