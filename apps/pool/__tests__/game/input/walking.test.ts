import { expect, test } from "bun:test";
import { INPUT_DT } from "@harrhy/pool-protocol";
import {
  addAvatar,
  createMovementWorld,
  findPath,
  stepAvatar,
  walkable,
  WALK_SPEED,
} from "@harrhy/pool-simulation";
import { HALL, HALL_MARGIN, TABLES } from "@harrhy/pool-simulation/geometry";
import { walkDirection } from "../../../app/game/input/walking";

test("intermediate steering reaches a nearby corner without overshooting", () => {
  const world = createMovementWorld();
  const avatar = addAvatar(world, 0, 0);
  const target = { x: 0.03, z: 0.04 };
  const direction = walkDirection({ x: 0, z: 0 }, target, "intermediate");
  const position = stepAvatar(
    world,
    avatar,
    direction.x,
    direction.z,
    INPUT_DT,
  );
  expect(position.x).toBeCloseTo(target.x, 10);
  expect(position.z).toBeCloseTo(target.z, 10);
  expect(walkDirection(target, target, "intermediate")).toEqual({ x: 0, z: 0 });
});

test("final arrival eases briefly and converges without overshooting", () => {
  const world = createMovementWorld();
  const avatar = addAvatar(world, 0, 0);
  const target = { x: 1, z: 0 };
  let position = { x: 0, z: 0 };
  let ticks = 0;
  let eased = false;
  while (target.x - position.x > 0.02 && ticks < 60) {
    const direction = walkDirection(position, target, "final");
    if (target.x - position.x > WALK_SPEED * 0.05)
      expect(direction.x).toBeCloseTo(1, 10);
    else eased ||= direction.x < 1;
    const next = stepAvatar(world, avatar, direction.x, direction.z, INPUT_DT);
    expect(next.x).toBeGreaterThan(position.x);
    expect(next.x).toBeLessThanOrEqual(target.x);
    position = next;
    ticks++;
  }
  expect(eased).toBe(true);
  expect(target.x - position.x).toBeLessThanOrEqual(0.02);
  expect(ticks * INPUT_DT).toBeLessThan(target.x / WALK_SPEED + 0.12);
  expect(walkDirection(target, target, "final")).toEqual({ x: 0, z: 0 });
});

test("the actual route around a table stays walkable without near-stops at corners", () => {
  const start = { x: -HALL.x + HALL_MARGIN + 0.5, z: TABLES[0]!.z };
  const goal = { x: 0, z: TABLES[0]!.z };
  const path = findPath(start, goal);
  expect(path.length).toBeGreaterThan(2);
  const route = path.slice(1);
  const world = createMovementWorld();
  const avatar = addAvatar(world, start.x, start.z);
  let position = start;
  let ticks = 0;
  while (route.length && ticks < 300) {
    while (
      route.length &&
      Math.hypot(route[0].x - position.x, route[0].z - position.z) <= 0.02
    )
      route.shift();
    if (!route.length) break;
    const direction = walkDirection(
      position,
      route[0],
      route.length === 1 ? "final" : "intermediate",
    );
    const next = stepAvatar(world, avatar, direction.x, direction.z, INPUT_DT);
    expect(walkable(next.x, next.z)).toBe(true);
    const speed =
      Math.hypot(next.x - position.x, next.z - position.z) / INPUT_DT;
    if (Math.hypot(goal.x - position.x, goal.z - position.z) > 0.21)
      expect(speed).toBeGreaterThan(1);
    expect(speed).toBeLessThanOrEqual(WALK_SPEED + 1e-9);
    position = next;
    ticks++;
  }
  expect(route).toHaveLength(0);
  expect(
    Math.hypot(goal.x - position.x, goal.z - position.z),
  ).toBeLessThanOrEqual(0.02);
  expect(ticks * INPUT_DT).toBeLessThan(
    path
      .slice(1)
      .reduce(
        (sum, p, i) => sum + Math.hypot(p.x - path[i].x, p.z - path[i].z),
        0,
      ) /
      WALK_SPEED +
      0.2,
  );
});
