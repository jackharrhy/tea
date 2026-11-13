import test from "node:test";
import assert from "node:assert/strict";
import {
  doodles,
  renderDoodle,
  dailyDoodle,
  validPool,
} from "../src/doodles.mjs";
test("each doodle is deterministic for a UTC day and changes the next day without active markup", () => {
  for (const { id } of doodles) {
    const first = renderDoodle(id, "2026-11-12");
    assert.equal(first, renderDoodle(id, "2026-11-12"));
    assert.notEqual(first, renderDoodle(id, "2026-11-13"));
    assert(!/<script|foreignObject|onload=|href=/i.test(first));
  }
});
test("daily selection stays within selected pool, advances daily, rejects empty or arbitrary targets", () => {
  const pool = ["silk", "caustics", "waves"];
  const days = ["2026-11-12", "2026-11-13", "2026-11-14"];
  assert.equal(new Set(days.map((day) => dailyDoodle(pool, day))).size, 3);
  assert.equal(validPool([]), false);
  assert.equal(validPool(["unknown"]), false);
  assert.equal(validPool(["silk", "silk"]), false);
  assert.equal(validPool(pool), true);
  assert.equal(dailyDoodle([]), "waves");
});

test("the date selects a shared palette which is stable and changes the following day", async () => {
  const { paletteForDay } = await import("../src/doodles.mjs");
  assert.deepEqual(paletteForDay("2026-11-12"), paletteForDay("2026-11-12"));
  assert.notEqual(
    paletteForDay("2026-11-12").id,
    paletteForDay("2026-11-13").id,
  );
});

test("style settings reject unknown or unbounded input and render only normalized numeric data", async () => {
  const { validSettings, doodleParameters } =
    await import("../src/doodles.mjs");
  assert(validSettings({ silk: { color: 1.4, saturation: 2 } }));
  assert(!validSettings({ silk: { color: 99 } }));
  assert(!validSettings({ unknown: { color: 1 } }));
  assert(!validSettings({ silk: { url: "https://invalid" } }));
  assert.equal(doodleParameters({ color: Infinity }).color, 0.8);
  assert.equal(doodleParameters({ color: 99 }).color, 2);
  assert(
    renderDoodle("silk", "2026-11-12", { color: 1.4 }).includes(
      "&quot;color&quot;:1.4",
    ),
  );
});
