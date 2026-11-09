import Delaunator from "delaunator";
import {
  BALL_RADIUS,
  TABLE_HALF_WIDTH as W,
  TABLE_HALF_LENGTH as L,
} from "./dimensions";

export const FELT_Y = 0.78;
// Box3D expands mesh contacts by this distance; the native felt body sits below the visible bed.
export const MESH_REST_OFFSET = 0.005;
export const RAIL_WIDTH = 0.16;
export const RAIL_TOP_Y = 0.83;
export const CUSHION_DEPTH = 0.05;
export const CUSHION_HEIGHT = BALL_RADIUS * 2 * 0.635;
export const CUSHION_NOSE_Y = FELT_Y + CUSHION_HEIGHT;
export const CORNER_MOUTH = 0.115;
export const SIDE_MOUTH = 0.129;
export const POCKET_OPENING = CORNER_MOUTH / Math.SQRT2;
export const SIDE_POCKET_RADIUS = 0.065;
export const FELT_LIP_WIDTH = 0.012;
export const FELT_LIP_DROP = 0.006;
export const POCKETS = [-1, 1].flatMap((side) =>
  [-1, 0, 1].map((end) => ({
    x: side * (W + (end === 0 ? 0.0675 : 0.04)),
    z: end === 0 ? 0 : end * (L + 0.04),
    radius: end === 0 ? SIDE_POCKET_RADIUS : 0.066,
  })),
);
export interface StaticBox {
  name?: string;
  center: [number, number, number];
  size: [number, number, number];
  rotation: [number, number, number, number];
  kind: "cushion" | "chute" | "tray" | "wall" | "guard" | "pocket";
}
function box(
  kind: StaticBox["kind"],
  center: StaticBox["center"],
  size: StaticBox["size"],
  angle: number | StaticBox["rotation"] = 0,
): StaticBox {
  return {
    kind,
    center,
    size,
    rotation:
      typeof angle === "number"
        ? [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)]
        : angle,
  };
}

export const CUSHIONS: StaticBox[] = [];
for (const side of [-1, 1]) {
  for (const end of [-1, 1]) {
    const start = SIDE_MOUTH / 2;
    const stop = L - POCKET_OPENING;
    CUSHIONS.push(
      box(
        "cushion",
        [
          side * (W + CUSHION_DEPTH / 2),
          FELT_Y + CUSHION_HEIGHT / 2,
          (end * (start + stop)) / 2,
        ],
        [CUSHION_DEPTH, CUSHION_HEIGHT, stop - start],
      ),
    );
  }
  CUSHIONS.push(
    box(
      "cushion",
      [0, FELT_Y + CUSHION_HEIGHT / 2, side * (L + CUSHION_DEPTH / 2)],
      [2 * (W - POCKET_OPENING), CUSHION_HEIGHT, CUSHION_DEPTH],
    ),
  );
}

// Bridge the square cushion ends to the wells without moving the WPA mouth endpoints.
for (const side of [-1, 1]) {
  for (const end of [-1, 1]) {
    const angle = Math.atan2(side, end);
    const length = 0.085;
    const halfDepth = CUSHION_DEPTH / 2;
    for (const alongSide of [false, true]) {
      const x = alongSide ? W : W - POCKET_OPENING;
      const z = alongSide ? L - POCKET_OPENING : L;
      const out = alongSide ? 1 : -1;
      CUSHIONS.push(
        box(
          "cushion",
          [
            side * (x + (length / 2 + out * halfDepth) / Math.SQRT2),
            (FELT_Y + RAIL_TOP_Y) / 2,
            end * (z + (length / 2 - out * halfDepth) / Math.SQRT2),
          ],
          [CUSHION_DEPTH, RAIL_TOP_Y - FELT_Y, length],
          [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)],
        ),
      );
    }
  }
}

export function feltHeight(x: number, z: number) {
  let y = FELT_Y;
  for (const p of POCKETS) {
    const t = Math.max(
      0,
      Math.min(
        1,
        (p.radius + FELT_LIP_WIDTH - Math.hypot(x - p.x, z - p.z)) /
          FELT_LIP_WIDTH,
      ),
    );
    y = Math.min(y, FELT_Y - FELT_LIP_DROP * t * t);
  }
  return y;
}

export const FELT_GEOMETRY: { positions: number[]; indices: number[] } = {
  positions: [],
  indices: [],
};
const bedW = W + CUSHION_DEPTH,
  bedL = L + CUSHION_DEPTH;
const points: number[] = [];
const pointKeys = new Set<string>();
function addPoint(x: number, z: number) {
  if (Math.abs(x) > bedW + 1e-8 || Math.abs(z) > bedL + 1e-8) return;
  x = Math.fround(Math.max(-bedW, Math.min(bedW, x)));
  z = Math.fround(Math.max(-bedL, Math.min(bedL, z)));
  const key = `${x}:${z}`;
  if (pointKeys.has(key)) return;
  pointKeys.add(key);
  points.push(x, z);
}
// Keep the flat bed coarse and well-shaped; long thin strips create false collision edges.
const nx = Math.ceil((2 * bedW) / 0.12),
  nz = Math.ceil((2 * bedL) / 0.12);
for (let zi = 0; zi <= nz; zi++)
  for (let xi = 0; xi <= nx; xi++) {
    const x = -bedW + (2 * bedW * xi) / nx,
      z = -bedL + (2 * bedL * zi) / nz;
    if (
      !POCKETS.some(
        (p) => Math.hypot(x - p.x, z - p.z) < p.radius + FELT_LIP_WIDTH + 0.008,
      )
    )
      addPoint(x, z);
  }
for (const p of POCKETS)
  for (let band = 0; band <= 4; band++) {
    const radius = p.radius + (FELT_LIP_WIDTH * band) / 4;
    for (let i = 0; i < 48; i++) {
      const angle = (i * Math.PI * 2) / 48;
      addPoint(p.x + radius * Math.cos(angle), p.z + radius * Math.sin(angle));
    }
    for (const x of [-bedW, bedW]) {
      const square = radius * radius - (x - p.x) ** 2;
      if (square >= 0) {
        const dz = Math.sqrt(square);
        addPoint(x, p.z - dz);
        addPoint(x, p.z + dz);
      }
    }
    for (const z of [-bedL, bedL]) {
      const square = radius * radius - (z - p.z) ** 2;
      if (square >= 0) {
        const dx = Math.sqrt(square);
        addPoint(p.x - dx, z);
        addPoint(p.x + dx, z);
      }
    }
  }
for (let i = 0; i < points.length; i += 2)
  FELT_GEOMETRY.positions.push(
    points[i]!,
    Math.fround(feltHeight(points[i]!, points[i + 1]!)),
    points[i + 1]!,
  );
const triangles = new Delaunator(points).triangles;
for (let i = 0; i < triangles.length; i += 3) {
  const a = triangles[i]!,
    b = triangles[i + 1]!,
    c = triangles[i + 2]!;
  const x = (points[2 * a]! + points[2 * b]! + points[2 * c]!) / 3;
  const z = (points[2 * a + 1]! + points[2 * b + 1]! + points[2 * c + 1]!) / 3;
  if (isOverPocket(x, z)) continue;
  const area =
    (points[2 * b]! - points[2 * a]!) *
      (points[2 * c + 1]! - points[2 * a + 1]!) -
    (points[2 * b + 1]! - points[2 * a + 1]!) *
      (points[2 * c]! - points[2 * a]!);
  if (Math.abs(area) < 1e-14) continue;
  FELT_GEOMETRY.indices.push(a, area > 0 ? c : b, area > 0 ? b : c);
}

export const TRAY_FLOOR_Y = 0.33;
export const CABINET_BOUNDS = { x: W + RAIL_WIDTH, z: L + RAIL_WIDTH };
export const TABLE_BOUNDS = CABINET_BOUNDS;
export const RETURN_TRAY = {
  x: 0.65,
  z: 0,
  width: 0.2,
  length: 0.6,
  minX: 0.55,
  maxX: 0.75,
  minZ: -0.3,
  maxZ: 0.3,
  floorY: TRAY_FLOOR_Y,
};
export const POCKET_WELL_BOTTOM_Y = 0.68;
export const RETURNS: StaticBox[] = [];

// The cabinet backs the open well-to-boot joins; leave the collector window clear.
for (const side of [-1, 1]) {
  RETURNS.push(
    box(
      "wall",
      [0, 0.5, side * (CABINET_BOUNDS.z - 0.01)],
      [CABINET_BOUNDS.x * 2, 0.4, 0.02],
    ),
  );
}
RETURNS.push(
  box(
    "wall",
    [-CABINET_BOUNDS.x + 0.01, 0.5, 0],
    [0.02, 0.4, CABINET_BOUNDS.z * 2],
  ),
);
for (const side of [-1, 1]) {
  const length = CABINET_BOUNDS.z - 0.34;
  RETURNS.push(
    box(
      "wall",
      [CABINET_BOUNDS.x - 0.01, 0.5, side * (0.34 + length / 2)],
      [0.02, 0.4, length],
    ),
  );
}

RETURNS.push(
  box("wall", [CABINET_BOUNDS.x - 0.01, 0.61, 0], [0.02, 0.18, 0.68]),
);

// Tangent boxes meet outside the opening: their inner faces never cut across the hole.
for (const p of POCKETS) {
  for (let i = 0; i < 32; i++) {
    const angle = ((i + 0.5) * Math.PI * 2) / 32;
    const nextX = Math.cos(angle),
      nextZ = Math.sin(angle);
    const back = nextX * Math.sign(p.x) + nextZ * Math.sign(p.z) > 0;
    const top = back ? RAIL_TOP_Y : FELT_Y - FELT_LIP_DROP;
    const thickness = 0.012;
    RETURNS.push(
      box(
        "pocket",
        [
          p.x + (p.radius + thickness / 2) * nextX,
          (top + POCKET_WELL_BOTTOM_Y) / 2,
          p.z + (p.radius + thickness / 2) * nextZ,
        ],
        [
          thickness,
          top - POCKET_WELL_BOTTOM_Y,
          2 * (p.radius + thickness) * Math.tan(Math.PI / 32),
        ],
        [0, Math.sin(-angle / 2), 0, Math.cos(-angle / 2)],
      ),
    );
  }
}

// Custom dimensions: OEM references establish boots and converging ramps, not these sizes.
export const RETURN_CHANNEL_WIDTH = 0.09;
export interface ReturnRoute {
  id: string;
  points: [number, number, number][];
  innerWidth: number;
}
export const RETURN_ROUTES: ReturnRoute[] = POCKETS.map((p, i) => {
  const distance = Math.hypot(p.x, p.z);
  return {
    id: `pocket-${i}`,
    points: [
      [p.x, 0.6, p.z],
      [(p.x / distance) * 0.21, 0.55, (p.z / distance) * 0.21],
    ],
    innerWidth: RETURN_CHANNEL_WIDTH,
  };
});
// A broad receiving floor avoids a two-ball bridge at a narrowing junction.
RETURN_ROUTES.push({
  id: "final",
  points: [
    [-0.3, 0.465, 0],
    [0.58, 0.395, 0],
  ],
  innerWidth: 0.5,
});

// A local box's Z axis follows the descending ramp; X spans the channel.
function ramp(route: ReturnRoute, walls: boolean) {
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1]!;
    const b = route.points[i]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const horizontal = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const pitch = -Math.atan2(dy, horizontal);
    const sy = Math.sin(yaw / 2);
    const cy = Math.cos(yaw / 2);
    const sp = Math.sin(pitch / 2);
    const cp = Math.cos(pitch / 2);
    const rotation: StaticBox["rotation"] = [
      cy * sp,
      sy * cp,
      -sy * sp,
      cy * cp,
    ];
    const midpoint: [number, number, number] = [
      (a[0] + b[0]) / 2,
      (a[1] + b[1]) / 2,
      (a[2] + b[2]) / 2,
    ];
    const width = route.innerWidth;
    RETURNS.push(
      box(
        "chute",
        [midpoint[0], midpoint[1] - 0.012, midpoint[2]],
        [width + 0.024, 0.024, Math.hypot(horizontal, dy) + 0.09],
        rotation,
      ),
    );
    if (walls) {
      const final = route.id === "final";
      for (const side of [-1, 1]) {
        const offset = side * (width / 2 + 0.006);
        RETURNS.push(
          box(
            "wall",
            [
              midpoint[0] + offset * Math.cos(yaw),
              midpoint[1] + (final ? 0.005 : 0.065),
              midpoint[2] - offset * Math.sin(yaw),
            ],
            [0.012, final ? 0.09 : 0.15, horizontal + 0.09],
            [0, sy, 0, cy],
          ),
        );
      }
    }
  }
}
for (const route of RETURN_ROUTES) ramp(route, true);
// Wide rubber landing pads catch the complete well opening and pitch into each arm.
for (const [i, p] of POCKETS.entries()) {
  const target = RETURN_ROUTES[i]!.points[1]!;
  const dx = target[0] - p.x;
  const dz = target[2] - p.z;
  const distance = Math.hypot(dx, dz);
  ramp(
    {
      id: `boot-${i}`,
      innerWidth: p.radius * 2,
      points: [
        [p.x - (dx / distance) * 0.025, 0.605, p.z - (dz / distance) * 0.025],
        [p.x + (dx / distance) * 0.12, 0.59, p.z + (dz / distance) * 0.12],
      ],
    },
    false,
  );
}
// The roof is below the inbound middle arm: falling pocket balls must hit its boot first.
RETURNS.push(
  box("guard", [0.46, 0.515, 0], [0.39, 0.018, 0.52]),
  box("wall", [-0.34, 0.45, 0], [0.02, 0.1, 0.52]),
  box("tray", [RETURN_TRAY.x, TRAY_FLOOR_Y - 0.02, 0], [0.24, 0.04, 0.64]),
  box("wall", [0.54, 0.36, 0], [0.02, 0.06, 0.64]),
  {
    ...box("wall", [0.76, 0.425, 0], [0.02, 0.19, 0.64]),
    name: "collector-window",
  },
  box("wall", [0.65, 0.425, -0.31], [0.2, 0.19, 0.02]),
  box("wall", [0.65, 0.425, 0.31], [0.2, 0.19, 0.02]),
);

export function isInReturnTray(x: number, y: number, z: number) {
  return (
    x >= RETURN_TRAY.minX &&
    x <= RETURN_TRAY.maxX &&
    z >= RETURN_TRAY.minZ &&
    z <= RETURN_TRAY.maxZ &&
    y >= TRAY_FLOOR_Y &&
    y < TRAY_FLOOR_Y + BALL_RADIUS * 2.5
  );
}

export function storedBallPosition(slot: number): [number, number, number] {
  return [
    RETURN_TRAY.x + ((slot % 3) - 1) * 0.064,
    TRAY_FLOOR_Y + BALL_RADIUS,
    (Math.floor(slot / 3) - 2.5) * 0.09,
  ];
}

export function isOverPocket(x: number, z: number, margin = 0) {
  return POCKETS.some(
    (p) => (x - p.x) ** 2 + (z - p.z) ** 2 < (p.radius + margin) ** 2,
  );
}
