import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../server/db";
import { initWorld } from "../../server/world";
import { spawnAiPlayers, resetAiPlayers, getAiEntities } from "../../server/ai";

const setupWorld = () => {
  const db = new Database(":memory:");
  runMigrations(db);
  const world = initWorld(db);
  return { db, world };
};

test("resetAiPlayers teleports bots back inside the spawn zone", () => {
  const { world } = setupWorld();
  // Reset module-level state by re-spawning fresh; this test file owns ai.ts.
  // Note: aiEntities accumulates across test files; not ideal but tolerable
  // for this single test of behaviour after spawn.
  const aiCountBefore = getAiEntities().length;
  spawnAiPlayers(world);
  const aiCountAfter = getAiEntities().length;
  const newlySpawned = aiCountAfter - aiCountBefore;
  expect(newlySpawned).toBeGreaterThan(0);

  // Move bots far outside the spawn zone.
  const { Position, Velocity } = world.components;
  const all = getAiEntities();
  const justSpawned = all.slice(aiCountBefore);
  for (const ai of justSpawned) {
    Position.x[ai.eid] = world.spawnZone.x + world.spawnZone.w + 500;
    Position.y[ai.eid] = world.spawnZone.y + world.spawnZone.h + 500;
    Velocity.x[ai.eid] = 5;
    Velocity.y[ai.eid] = 5;
  }

  const reset = resetAiPlayers(world);
  expect(reset).toBe(aiCountAfter);

  for (const ai of justSpawned) {
    const x = Position.x[ai.eid]!;
    const y = Position.y[ai.eid]!;
    expect(x).toBeGreaterThanOrEqual(world.spawnZone.x);
    expect(x).toBeLessThanOrEqual(world.spawnZone.x + world.spawnZone.w);
    expect(y).toBeGreaterThanOrEqual(world.spawnZone.y);
    expect(y).toBeLessThanOrEqual(world.spawnZone.y + world.spawnZone.h);
    expect(Velocity.x[ai.eid]).toBe(0);
    expect(Velocity.y[ai.eid]).toBe(0);
  }
});
