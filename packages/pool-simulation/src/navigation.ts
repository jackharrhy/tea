import {
  createFindNearestPolyResult,
  DEFAULT_QUERY_FILTER,
  findNearestPoly,
  moveAlongSurface,
  findNodePath,
  FindNodePathResultFlags,
  findStraightPath,
  FindStraightPathResultFlags,
} from "navcat";
import { HALL, TABLES, TABLE_CLEARANCE, WALK_SPEED } from "./geometry";
import { buildHallNavMesh, NAV_CLEARANCE, NAV_BOUNDS } from "./navmesh";

export type Point = { x: number; z: number };
const navMesh = buildHallNavMesh();
// Movement uses collision clearance only; routes retain extra corner clearance.
const movementMesh = buildHallNavMesh(1e-6);
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

function project(point: Point, mesh = navMesh) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) {
    throw new RangeError("Navigation coordinates must be finite");
  }
  // Bound the search even for distant finite input; the whole hall is one tile.
  const x = Math.max(-NAV_BOUNDS.x, Math.min(NAV_BOUNDS.x, point.x));
  const z = Math.max(-NAV_BOUNDS.z, Math.min(NAV_BOUNDS.z, point.z));
  const nearest = findNearestPoly(
    createFindNearestPolyResult(),
    mesh,
    [x, 0, z],
    [HALL.x * 2, 1, HALL.z * 2],
    DEFAULT_QUERY_FILTER,
  );
  if (!nearest.success) throw new Error("No walkable point in hall");
  return nearest;
}

/** Displacement in world units, already scaled by speed and dt by the caller.
 * Supports at most 100 ms of movement. Projects invalid starts; no hidden agent
 * state, so authoritative corrections and command replay use the same query.
 */
export function moveAvatar(from: Point, delta: Point): Point {
  const travel = Math.hypot(delta.x, delta.z);
  if (!Number.isFinite(travel) || travel > WALK_SPEED * 0.1 + 1e-9) {
    throw new RangeError(
      "Movement delta must be finite and at most 0.42 units",
    );
  }
  let current = project(from, movementMesh);
  // Keep surface searches local even for a caller's maximum 100 ms step.
  const steps = Math.max(1, Math.ceil(travel / (WALK_SPEED / 60)));
  for (let i = 0; i < steps; i++) {
    const moved = moveAlongSurface(
      movementMesh,
      current.nodeRef,
      current.position,
      [
        current.position[0] + delta.x / steps,
        0,
        current.position[2] + delta.z / steps,
      ],
      DEFAULT_QUERY_FILTER,
    );
    if (!moved.success) throw new Error("Could not move along hall surface");
    current = moved;
  }
  return { x: current.position[0], z: current.position[2] };
}

/** Navcat corridor and straight path, including endpoints projected onto the
 * clearance mesh. Non-finite coordinates throw RangeError; partial routes fail.
 */
export function findPath(start: Point, goal: Point): Point[] {
  const source = project(start);
  const target = project(goal);
  const corridor = findNodePath(
    navMesh,
    source.nodeRef,
    target.nodeRef,
    source.position,
    target.position,
    DEFAULT_QUERY_FILTER,
  );
  if (
    !corridor.success ||
    !(corridor.flags & FindNodePathResultFlags.COMPLETE_PATH)
  ) {
    throw new Error("No complete route through hall");
  }
  const straight = findStraightPath(
    navMesh,
    source.position,
    target.position,
    corridor.path,
  );
  if (
    !straight.success ||
    straight.flags & FindStraightPathResultFlags.PARTIAL_PATH
  ) {
    throw new Error("No complete straight path through hall");
  }
  return straight.path.map(({ position }) => ({
    x: position[0],
    z: position[2],
  }));
}

/** Reachable edge for watching a table; player seats use tableSeatPosition. */
export function tableApproach(tableId: string, from: Point): Point {
  const table = TABLES.find((t) => t.id === tableId);
  if (!table) throw new RangeError(`Unknown table: ${tableId}`);
  const x = Math.max(
    table.x - TABLE_CLEARANCE.x,
    Math.min(table.x + TABLE_CLEARANCE.x, from.x),
  );
  const z = Math.max(
    table.z - TABLE_CLEARANCE.z,
    Math.min(table.z + TABLE_CLEARANCE.z, from.z),
  );
  const candidates = [
    { x: table.x - TABLE_CLEARANCE.x - NAV_CLEARANCE, z },
    { x: table.x + TABLE_CLEARANCE.x + NAV_CLEARANCE, z },
    { x, z: table.z - TABLE_CLEARANCE.z - NAV_CLEARANCE },
    { x, z: table.z + TABLE_CLEARANCE.z + NAV_CLEARANCE },
  ];
  const routes = candidates.map((point) => ({
    point,
    path: findPath(from, point),
  }));
  const length = (path: Point[]) =>
    path.slice(1).reduce((sum, p, i) => sum + distance(path[i], p), 0);
  routes.sort((a, b) => length(a.path) - length(b.path));
  return routes[0].path.at(-1)!;
}
