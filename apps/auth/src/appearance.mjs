import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  defaultPool,
  validPool,
  dailyDoodle,
  doodleParameters,
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
      const enabled = Array.isArray(saved.enabled)
        ? saved.enabled.filter((id) => id !== "waves")
        : [];
      if (validPool(enabled)) pool = enabled;
      settings = saved.settings || {};
    } catch {}
  const id = dailyDoodle(pool, day);
  const parameters = JSON.stringify(
    doodleParameters(settings[id] || { color: 0 }),
  ).replaceAll('"', "&quot;");
  return `<canvas class="auth-art motion-canvas" aria-hidden="true" data-doodle="${id}" data-day="${day.replace(/[^0-9-]/g, "")}" data-settings="${parameters}"></canvas>`;
}
