import { expect, test } from "bun:test";
import { addEntity, addComponent } from "bitecs";
import {
  createSharedWorld,
  moveAndSlide,
  TILE_SIZE,
  PLAYER_SIZE,
} from "@tea/burger-core";

const placeWall = (
  world: ReturnType<typeof createSharedWorld<{}>>,
  x: number,
  y: number,
) => {
  const { Position, Solid } = world.components;
  const eid = addEntity(world);
  addComponent(world, eid, Position);
  Position.x[eid] = x;
  Position.y[eid] = y;
  addComponent(world, eid, Solid);
  return eid;
};

test("player stops at wall instead of passing through", () => {
  const world = createSharedWorld({});
  placeWall(world, 100, 0);
  // Player at (50, 0) repeatedly stepping right at realistic per-tick distances.
  // moveAndSlide uses static AABB resolution per step, so we step many times.
  let x = 50;
  let y = 0;
  for (let i = 0; i < 200; i++) {
    const out = moveAndSlide(world, x, y, 1, 0, 16);
    x = out.x;
    y = out.y;
  }
  // Player's right edge should not exceed the wall's left edge.
  const expectedMaxX = 100 - TILE_SIZE / 2 - PLAYER_SIZE / 2;
  expect(x).toBeLessThanOrEqual(expectedMaxX + 0.001);
  expect(y).toBe(0);
});

test("player slides along a vertical wall", () => {
  const world = createSharedWorld({});
  // Build a tall vertical wall out of stacked tiles so the player can't
  // simply descend past its bottom edge during the test window.
  for (let ty = -TILE_SIZE * 20; ty <= TILE_SIZE * 20; ty += TILE_SIZE) {
    placeWall(world, 100, ty);
  }
  // Player pushing right into the wall while also moving down at realistic
  // per-tick distances.
  let x = 50;
  let y = 0;
  for (let i = 0; i < 20; i++) {
    const out = moveAndSlide(world, x, y, 1, 0.5, 16);
    x = out.x;
    y = out.y;
  }
  // Y advances despite X being blocked.
  expect(y).toBeGreaterThan(0);
  const expectedMaxX = 100 - TILE_SIZE / 2 - PLAYER_SIZE / 2;
  expect(x).toBeLessThanOrEqual(expectedMaxX + 0.001);
});

test("free movement with no obstacles advances normally", () => {
  const world = createSharedWorld({});
  // No walls.
  const out = moveAndSlide(world, 0, 0, 1, 1, 10);
  expect(out.x).toBe(10);
  expect(out.y).toBe(10);
});

test("moveAndSlide clamps player to right boundary", () => {
  const world = createSharedWorld({});
  world.bounds = { x: 0, y: 0, w: 320, h: 320 };
  const out = moveAndSlide(world, 300, 100, 1, 0, 100);
  expect(out.x).toBeLessThanOrEqual(320 - PLAYER_SIZE / 2);
});

test("moveAndSlide clamps player to left boundary", () => {
  const world = createSharedWorld({});
  world.bounds = { x: 0, y: 0, w: 320, h: 320 };
  const out = moveAndSlide(world, 5, 100, -1, 0, 100);
  expect(out.x).toBeGreaterThanOrEqual(PLAYER_SIZE / 2);
});

test("moveAndSlide clamps player to top boundary", () => {
  const world = createSharedWorld({});
  world.bounds = { x: 0, y: 0, w: 320, h: 320 };
  const out = moveAndSlide(world, 100, 5, 0, -1, 100);
  expect(out.y).toBeGreaterThanOrEqual(PLAYER_SIZE / 2);
});

test("moveAndSlide clamps player to bottom boundary", () => {
  const world = createSharedWorld({});
  world.bounds = { x: 0, y: 0, w: 320, h: 320 };
  const out = moveAndSlide(world, 100, 300, 0, 1, 100);
  expect(out.y).toBeLessThanOrEqual(320 - PLAYER_SIZE / 2);
});

test("moveAndSlide with zero bounds applies no clamp (degenerate)", () => {
  const world = createSharedWorld({});
  // Default bounds are 0,0,0,0 — clamp is a no-op.
  const out = moveAndSlide(world, 1000, 1000, 1, 1, 100);
  expect(out.x).toBe(1100);
  expect(out.y).toBe(1100);
});
