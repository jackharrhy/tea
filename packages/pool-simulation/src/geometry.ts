import { TABLE_BOUNDS } from "@harrhy/pool/table";

export const TABLES = [
  { id: "1", x: -2.5, z: -2.7 },
  { id: "2", x: 2.5, z: -2.7 },
  { id: "3", x: -2.5, z: 2.7 },
  { id: "4", x: 2.5, z: 2.7 },
];
export const BAR = { x: 2.8, z: 6.4, width: 3.6, depth: 0.8, height: 0.95 };
export const STOOLS = [
  { id: "bar-1", x: 1.6, z: 5.5, y: 0.68, yaw: 0 },
  { id: "bar-2", x: 2.8, z: 5.5, y: 0.68, yaw: 0 },
  { id: "bar-3", x: 4, z: 5.5, y: 0.68, yaw: 0 },
];
export const HALL_SPAWN = { x: 0, z: 6.1 };
export const WALK_SPEED = 3.4;
export const HALL = { x: 6, z: 7.4 };
export const AVATAR_SCALE = 0.85;
export const AVATAR_RADIUS = 0.34 * AVATAR_SCALE;
export const TABLE_CLEARANCE = {
  x: TABLE_BOUNDS.x + AVATAR_RADIUS + 0.01,
  z: TABLE_BOUNDS.z + AVATAR_RADIUS + 0.01,
};
export const HALL_MARGIN = 0.5;
export const TABLE_JOIN_DISTANCE = 0.25;

export function tableSeatPosition(tableId: string, seat: 0 | 1) {
  const table = TABLES.find((candidateTable) => candidateTable.id === tableId);
  if (!table) throw new RangeError(`Unknown table: ${tableId}`);
  return {
    x: table.x + (seat === 0 ? -1 : 1) * (TABLE_CLEARANCE.x + 0.12),
    z: table.z,
  };
}

// These rectangles already include avatar radius; do not inflate it again.
export const BAR_OBSTACLE = {
  minX: BAR.x - (BAR.width + 0.2) / 2 - AVATAR_RADIUS,
  maxX: BAR.x + (BAR.width + 0.2) / 2 + AVATAR_RADIUS,
  minZ: BAR.z - (BAR.depth + 0.2) / 2 - AVATAR_RADIUS,
  maxZ: BAR.z + (BAR.depth + 0.2) / 2 + AVATAR_RADIUS,
};
export const HALL_OBSTACLES = [
  ...TABLES.map((table) => ({
    minX: table.x - TABLE_CLEARANCE.x,
    maxX: table.x + TABLE_CLEARANCE.x,
    minZ: table.z - TABLE_CLEARANCE.z,
    maxZ: table.z + TABLE_CLEARANCE.z,
  })),
  BAR_OBSTACLE,
];

export function walkable(x: number, z: number) {
  return (
    Number.isFinite(x) &&
    Number.isFinite(z) &&
    Math.abs(x) < HALL.x - HALL_MARGIN &&
    Math.abs(z) < HALL.z - HALL_MARGIN &&
    !HALL_OBSTACLES.some(
      (r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ,
    )
  );
}
