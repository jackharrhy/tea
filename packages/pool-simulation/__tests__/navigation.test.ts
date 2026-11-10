import { expect, test } from "vitest";
import {
  findPath,
  tableApproach,
  TABLES,
  walkable,
  WALK_SPEED,
} from "../src/index";
import type { Point } from "../src/index";
import { buildHallNavMesh, NAV_CLEARANCE } from "../src/navmesh";
import {
  BAR,
  BAR_OBSTACLE,
  HALL,
  HALL_MARGIN,
  HALL_SPAWN,
  TABLE_CLEARANCE,
  STOOLS,
  tableSeatPosition,
} from "../src/geometry";
import { moveAvatar } from "../src/navigation";

const left = -HALL.x + HALL_MARGIN + 0.5;
const right = HALL.x - HALL_MARGIN - 0.25;
const back = -HALL.z + HALL_MARGIN + 0.5;
const front = -back;
const first = TABLES[0]!;
const third = TABLES[2]!;
const fourth = TABLES[3]!;

function expectSafe(path: Point[]) {
  expect(path.length).toBeGreaterThan(0);
  for (const point of path) {
    if (!walkable(point.x, point.z)) {
      throw new Error(`Unwalkable waypoint: ${JSON.stringify(point)}`);
    }
  }
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i];
    for (let j = 0; j <= 1000; j++) {
      const t = j / 1000;
      const point = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      if (!walkable(point.x, point.z)) {
        throw new Error(
          `Unsafe segment ${i - 1} at t=${t}: ${JSON.stringify({ a, b, point })}`,
        );
      }
    }
  }
}

const length = (path: Point[]) =>
  path
    .slice(1)
    .reduce(
      (sum, p, i) => sum + Math.hypot(p.x - path[i].x, p.z - path[i].z),
      0,
    );

test("clear routes are direct and identical endpoints produce one point", () => {
  const start = { x: 0, z: front },
    goal = { x: 0, z: back };
  expect(findPath(start, goal)).toEqual([start, goal]);
  expect(findPath(start, start)).toEqual([start]);
});

test("shortest route wraps a table's two corners without cutting through it", () => {
  const start = { x: left, z: first.z },
    goal = { x: 0, z: first.z };
  const path = findPath(start, goal);
  expect(path).toHaveLength(4);
  expect(path[0]).toEqual(start);
  expect(path.at(-1)).toEqual(goal);
  expectSafe(path);
  const optimal =
    Math.hypot(
      -first.x - TABLE_CLEARANCE.x - NAV_CLEARANCE,
      TABLE_CLEARANCE.z + NAV_CLEARANCE,
    ) *
      2 +
    2 * (TABLE_CLEARANCE.x + NAV_CLEARANCE);
  expect(Math.abs(length(path) - optimal)).toBeLessThan(0.00001);
});

test("routes across multiple tables and narrow wall aisles remain safe", () => {
  for (const [start, goal] of [
    [
      { x: left, z: back },
      { x: right, z: STOOLS[0]!.z },
    ],
    [
      { x: first.x, z: back },
      { x: first.x, z: front },
    ],
    [
      { x: -HALL.x + HALL_MARGIN + 1e-7, z: first.z },
      { x: HALL.x - HALL_MARGIN - 1e-7, z: third.z },
    ],
    [
      { x: first.x - TABLE_CLEARANCE.x - 0.0000001, z: first.z },
      { x: first.x + TABLE_CLEARANCE.x + 0.0000001, z: first.z },
    ],
  ]) {
    const path = findPath(start, goal);
    expect(
      Math.hypot(path[0].x - start.x, path[0].z - start.z),
    ).toBeLessThanOrEqual(NAV_CLEARANCE);
    expect(
      Math.hypot(path.at(-1)!.x - goal.x, path.at(-1)!.z - goal.z),
    ).toBeLessThanOrEqual(NAV_CLEARANCE);
    expectSafe(path);
  }
});

test("invalid destinations project outside tables and clamp inside hall walls", () => {
  const start = { x: 0, z: 0 };
  for (const goal of [
    ...TABLES,
    { x: 100, z: -100 },
    { x: HALL.x, z: HALL.z },
  ]) {
    const path = findPath(start, goal);
    expectSafe(path);
    expect(path.at(-1)).not.toEqual(goal);
  }
  const projected = findPath(start, { x: first.x, z: first.z }).at(-1)!;
  expect(Math.abs(projected.x - first.x)).toBeCloseTo(
    TABLE_CLEARANCE.x + NAV_CLEARANCE,
    5,
  );
  expect(projected.z).toBe(first.z);
});

test("invalid starts are projected and do not introduce unsafe initial segments", () => {
  for (const start of [
    { x: third.x, z: third.z },
    { x: -HALL.x, z: -HALL.z },
    { x: 1e6, z: 0 },
  ]) {
    const path = findPath(start, { x: 0, z: front });
    expectSafe(path);
    expect(path[0]).not.toEqual(start);
  }
});

test("table approaches are reachable safe points inside the server join radius", () => {
  for (const table of TABLES) {
    for (const from of [
      { x: 0, z: front },
      { x: left, z: back },
    ]) {
      const point = tableApproach(table.id, from);
      expect(Math.hypot(point.x - table.x, point.z - table.z)).toBeLessThan(
        4.6,
      );
      expect(
        Math.max(
          Math.abs(point.x - table.x) - TABLE_CLEARANCE.x,
          Math.abs(point.z - table.z) - TABLE_CLEARANCE.z,
        ),
      ).toBeCloseTo(0.12, 6);
      expectSafe(findPath(from, point));
    }
  }
  expect(() => tableApproach("missing", { x: 0, z: 0 })).toThrow(RangeError);
});

test("both table seats are reachable from the opposite side without crossing the table", () => {
  for (const table of TABLES) {
    for (const seat of [0, 1] as const) {
      const goal = tableSeatPosition(table.id, seat);
      const start = tableSeatPosition(table.id, seat === 0 ? 1 : 0);
      expect(goal.z).toBe(table.z);
      expect(goal.x).toBeCloseTo(
        table.x + (seat === 0 ? -1 : 1) * (TABLE_CLEARANCE.x + NAV_CLEARANCE),
        12,
      );
      const path = findPath(start, goal);
      expect(path.length).toBeGreaterThan(2);
      expect(path.at(-1)!.x).toBeCloseTo(goal.x, 12);
      expect(path.at(-1)!.z).toBeCloseTo(goal.z, 12);
      expectSafe(path);
      follow(path, 1 / 60, false);
      expectSafe(findPath(HALL_SPAWN, goal));
    }
  }
  expect(() => tableSeatPosition("missing", 0)).toThrow(RangeError);
});

test("non-finite coordinates fail explicitly", () => {
  expect(() => findPath({ x: NaN, z: 0 }, { x: 0, z: 0 })).toThrow(RangeError);
  expect(() => findPath({ x: 0, z: 0 }, { x: 0, z: Infinity })).toThrow(
    RangeError,
  );
});

function follow(path: Point[], dt: number, corrections: boolean) {
  let position = path[0];
  let waypoint = 1;
  for (let tick = 0; tick < 5000 && waypoint < path.length; tick++) {
    const target = path[waypoint];
    const remaining = Math.hypot(target.x - position.x, target.z - position.z);
    if (remaining <= 0.02) {
      waypoint++;
      continue;
    }
    if (corrections && tick % 37 === 0) {
      const corrected = { x: position.x + 0.015, z: position.z - 0.015 };
      if (walkable(corrected.x, corrected.z)) {
        position = corrected;
      }
    }
    const dx = target.x - position.x,
      dz = target.z - position.z;
    const distance = Math.hypot(dx, dz);
    const travel = Math.min(distance, WALK_SPEED * dt);
    const expected = {
      x: position.x + (dx / distance) * travel,
      z: position.z + (dz / distance) * travel,
    };
    const before = position;
    position = moveAvatar(position, {
      x: (dx / distance) * travel,
      z: (dz / distance) * travel,
    });
    if (
      Math.abs(position.x - expected.x) >= 5e-11 ||
      Math.abs(position.z - expected.z) >= 5e-11 ||
      !walkable(position.x, position.z)
    ) {
      throw new Error(
        `Follower clipped or blocked: ${JSON.stringify({
          tick,
          waypoint,
          dt,
          corrections,
          before,
          target,
          expected,
          position,
        })}`,
      );
    }
  }
  expect(waypoint).toBe(path.length);
  expect(
    Math.hypot(position.x - path.at(-1)!.x, position.z - path.at(-1)!.z),
  ).toBeLessThanOrEqual(0.02);
}

test("moveAvatar follows corner routes with early consumption and small network corrections", () => {
  const routes = [
    [
      { x: left, z: first.z },
      { x: 0, z: first.z },
    ],
    [
      { x: 0, z: first.z },
      { x: left, z: first.z },
    ],
    [
      { x: first.x, z: back },
      { x: first.x, z: front },
    ],
    [
      { x: left, z: back },
      { x: right, z: STOOLS[0]!.z },
    ],
    [
      { x: first.x - TABLE_CLEARANCE.x - 0.0000001, z: first.z },
      { x: first.x + TABLE_CLEARANCE.x + 0.0000001, z: first.z },
    ],
  ];
  for (const [start, goal] of routes) {
    for (const dt of [1 / 60, 1 / 30]) {
      follow(findPath(start, goal), dt, false);
      follow(findPath(start, goal), dt, true);
    }
  }
  for (const table of TABLES) {
    const start = { x: 0, z: front };
    follow(findPath(start, tableApproach(table.id, start)), 1 / 60, true);
  }
});

test("table approaches use the closest reachable side instead of circling to a fixed seat", () => {
  expect(tableApproach("3", { x: 0, z: third.z })).toEqual({
    x: third.x + TABLE_CLEARANCE.x + NAV_CLEARANCE,
    z: third.z,
  });
  expect(tableApproach("3", { x: left, z: third.z })).toEqual({
    x: third.x - TABLE_CLEARANCE.x - NAV_CLEARANCE,
    z: third.z,
  });
  expect(tableApproach("3", { x: first.x, z: front })).toEqual({
    x: first.x,
    z: third.z + TABLE_CLEARANCE.z + NAV_CLEARANCE,
  });
});

test("clearance-strip endpoints project consistently and inputs remain unchanged", () => {
  const start = Object.freeze({
    x: first.x - TABLE_CLEARANCE.x - 0.0000001,
    z: first.z,
  });
  const goal = Object.freeze({
    x: first.x + TABLE_CLEARANCE.x + 0.0000001,
    z: first.z,
  });
  const path = findPath(start, goal);
  expect(path[0].x).toBeCloseTo(
    first.x - TABLE_CLEARANCE.x - NAV_CLEARANCE,
    12,
  );
  expect(path[0].z).toBe(first.z);
  expect(path.at(-1)!.x).toBeCloseTo(
    first.x + TABLE_CLEARANCE.x + NAV_CLEARANCE,
    12,
  );
  expect(path.at(-1)!.z).toBe(first.z);
  expect(findPath(start, start)).toEqual([path[0]]);
  expectSafe(path);
  path[0].x = 999;
  expect(findPath(start, goal)[0].x).toBeCloseTo(
    first.x - TABLE_CLEARANCE.x - NAV_CLEARANCE,
    12,
  );
});

test("hall mesh builds deterministically from shared table collision geometry", () => {
  const mesh = buildHallNavMesh();
  expect(buildHallNavMesh()).toEqual(mesh);
  const tile = Object.values(mesh.tiles)[0];
  const area = tile.polys.reduce((sum, poly) => {
    const points = poly.vertices.map((i) => [
      tile.vertices[i * 3],
      tile.vertices[i * 3 + 2],
    ]);
    return (
      sum +
      Math.abs(
        points.reduce((a, p, i) => {
          const next = points[(i + 1) % points.length];
          return a + p[0] * next[1] - next[0] * p[1];
        }, 0),
      ) /
        2
    );
  }, 0);
  const floorArea = mesh.tileWidth * mesh.tileHeight;
  const obstacleArea =
    TABLES.length *
    4 *
    (TABLE_CLEARANCE.x + NAV_CLEARANCE) *
    (TABLE_CLEARANCE.z + NAV_CLEARANCE);
  const barArea =
    (BAR_OBSTACLE.maxX - BAR_OBSTACLE.minX + 2 * NAV_CLEARANCE) *
    (mesh.tileHeight / 2 - (BAR_OBSTACLE.minZ - NAV_CLEARANCE));
  expect(area).toBeCloseTo(floorArea - obstacleArea - barArea, 9);
});

test("routes throughout the hall are repeatable, collision safe and followable both ways", () => {
  const points = [left, first.x, 0, fourth.x, right]
    .flatMap((x) => [back, first.z, 0, third.z, front].map((z) => ({ x, z })))
    .filter((p) => walkable(p.x, p.z));
  for (const start of points) {
    for (const goal of points) {
      const path = findPath(start, goal);
      expect(path[0]).toEqual(start);
      expect(path.at(-1)).toEqual(goal);
      expect(findPath(start, goal)).toEqual(path);
      expectSafe(path);
      follow(path, 1 / 30, true);
    }
  }
});

test("shared obstacles cover returns and bar while keeping the stools reachable", () => {
  expect(walkable(fourth.x + TABLE_CLEARANCE.x - 0.01, fourth.z)).toBe(false);
  expect(walkable(fourth.x, fourth.z - TABLE_CLEARANCE.z + 0.01)).toBe(false);
  for (const seat of STOOLS) {
    const path = findPath(HALL_SPAWN, seat);
    expectSafe(path);
    expect(
      Math.hypot(path.at(-1)!.x - seat.x, path.at(-1)!.z - seat.z),
    ).toBeLessThan(0.01);
  }
  expect(walkable(BAR.x, BAR.z)).toBe(false);
  for (const [start, goal] of [
    [HALL_SPAWN, { x: right, z: STOOLS[0]!.z }],
    [
      { x: right, z: STOOLS[0]!.z },
      { x: right, z: front },
    ],
    [
      { x: left, z: 0 },
      { x: right, z: 0 },
    ],
  ]) {
    const path = findPath(start, goal);
    expectSafe(path);
    expect(path[0]).toEqual(start);
    expect(path.at(-1)).toEqual(goal);
    follow(path, 1 / 60, true);
    follow(findPath(goal, start), 1 / 60, true);
  }
  const from = { x: right, z: front };
  const approach = tableApproach(fourth.id, from);
  expectSafe(findPath(from, approach));
  expect(Math.hypot(approach.x - fourth.x, approach.z - fourth.z)).toBeLessThan(
    4.6,
  );
});

test("surface movement slides along tables, bar and walls without penetrating", () => {
  for (const [start, delta, axis, boundary] of [
    [
      { x: first.x - TABLE_CLEARANCE.x - 0.08, z: first.z },
      { x: 0.05, z: 0.02 },
      "x",
      first.x - TABLE_CLEARANCE.x,
    ],
    [
      { x: BAR.x, z: BAR_OBSTACLE.minZ - 0.08 },
      { x: 0.02, z: 0.05 },
      "z",
      BAR_OBSTACLE.minZ,
    ],
    [{ x: right, z: 0 }, { x: 0.05, z: 0.02 }, "x", HALL.x - HALL_MARGIN],
  ] as const) {
    let position: Point = { ...start };
    const path = [position];
    for (let tick = 0; tick < 30; tick++) {
      position = moveAvatar(position, delta);
      path.push(position);
    }
    expectSafe(path);
    expect(position[axis]).toBeCloseTo(boundary, 5);
    const slidingAxis = axis === "x" ? "z" : "x";
    expect(position[slidingAxis] - start[slidingAxis]).toBeCloseTo(0.6, 8);
  }
});

function replayPath(interleave: boolean) {
  let position = { x: BAR.x, z: STOOLS[0]!.z };
  const path: Point[] = [];
  for (let tick = 0; tick < 90; tick++) {
    if (interleave) moveAvatar({ x: left, z: back }, { x: 0.03, z: 0.04 });
    position = moveAvatar(position, { x: 0.02, z: 0.04 });
    path.push(position);
  }
  return path;
}

test("movement replay is independent of other avatars and projects invalid corrections", () => {
  expect(replayPath(true)).toEqual(replayPath(false));
  expectSafe(replayPath(false));
  for (const from of [fourth, BAR, { x: 1e6, z: 0 }]) {
    const projected = moveAvatar(from, { x: 0, z: 0 });
    expect(walkable(projected.x, projected.z)).toBe(true);
  }
  expect(() => moveAvatar({ x: NaN, z: 0 }, { x: 0, z: 0 })).toThrow(
    RangeError,
  );
  expect(() => moveAvatar({ x: 0, z: 0 }, { x: Infinity, z: 0 })).toThrow(
    RangeError,
  );
  expect(() => moveAvatar({ x: 0, z: 0 }, { x: 1, z: 0 })).toThrow(RangeError);
});
