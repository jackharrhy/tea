import { expect, test } from "bun:test";
import { PHYSICS_DT } from "@harrhy/gurgur-engine";
import { WorldHost } from "../../server/src/game";
import { WorldStore } from "../../server/src/store";

test("keeps the 16-player/128-prop host tick budget", async () => {
  const store = new WorldStore(":memory:");
  const game = await WorldHost.create(
    store,
    () => {},
    () => {},
    {
      extraDynamicBodies: 122,
    },
  );
  try {
    for (let index = 0; index < 16; index += 1)
      game.connectPlayer(`budget-${index}`);
    for (let tick = 0; tick < 600; tick += 1) game.advance(PHYSICS_DT);
    expect(
      game.bootstrapStates().filter((state) => state.kind === "player"),
    ).toHaveLength(16);
    const metrics = game.metrics();
    expect(metrics.tickP95Ms).toBeLessThan(8);
    expect(metrics.tickP99Ms).toBeLessThan(12);
  } finally {
    game.stop();
    store.close();
  }
});
