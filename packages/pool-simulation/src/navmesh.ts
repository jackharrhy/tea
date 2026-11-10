import {
  addTile,
  buildTile,
  createNavMesh,
  polygonsToNavMeshTilePolys,
  polysToTileDetailMesh,
} from "navcat";
import type { Box3, ExternalPolygon } from "navcat";
import { HALL, HALL_MARGIN, HALL_OBSTACLES } from "./geometry";

// Leave room for waypoint arrival and prediction corrections near obstacles.
export const NAV_CLEARANCE = 0.12;
export const NAV_BOUNDS = {
  x: HALL.x - HALL_MARGIN - 1e-6,
  z: HALL.z - HALL_MARGIN - 1e-6,
};

/** Exact convex floor cells from shared collision rectangles, with shared vertices
 * so Navcat can build adjacency. No voxelization or separate route planner.
 */
export function buildHallNavMesh(clearance = NAV_CLEARANCE) {
  const obstacles = HALL_OBSTACLES.map((r) => ({
    minX: Math.max(-NAV_BOUNDS.x, r.minX - clearance),
    maxX: Math.min(NAV_BOUNDS.x, r.maxX + clearance),
    minZ: Math.max(-NAV_BOUNDS.z, r.minZ - clearance),
    maxZ: Math.min(NAV_BOUNDS.z, r.maxZ + clearance),
  }));
  const xs = [
    ...new Set([
      -NAV_BOUNDS.x,
      NAV_BOUNDS.x,
      ...obstacles.flatMap((r) => [r.minX, r.maxX]),
    ]),
  ].toSorted((a, b) => a - b);
  const zs = [
    ...new Set([
      -NAV_BOUNDS.z,
      NAV_BOUNDS.z,
      ...obstacles.flatMap((r) => [r.minZ, r.maxZ]),
    ]),
  ].toSorted((a, b) => a - b);
  const vertices = zs.flatMap((z) => xs.flatMap((x) => [x, 0, z]));
  const polygons: ExternalPolygon[] = [];
  for (let z = 0; z < zs.length - 1; z++) {
    for (let x = 0; x < xs.length - 1; x++) {
      const cx = (xs[x] + xs[x + 1]) / 2;
      const cz = (zs[z] + zs[z + 1]) / 2;
      if (
        obstacles.some(
          (r) => cx > r.minX && cx < r.maxX && cz > r.minZ && cz < r.maxZ,
        )
      )
        continue;
      const i = z * xs.length + x;
      polygons.push({
        vertices: [i, i + xs.length, i + xs.length + 1, i + 1],
        flags: 1,
        area: 0,
      });
    }
  }
  const bounds: Box3 = [
    -NAV_BOUNDS.x,
    0,
    -NAV_BOUNDS.z,
    NAV_BOUNDS.x,
    0,
    NAV_BOUNDS.z,
  ];
  const tilePolys = polygonsToNavMeshTilePolys(polygons, vertices, 0, bounds);
  const mesh = createNavMesh();
  mesh.origin = [bounds[0], 0, bounds[2]];
  mesh.tileWidth = NAV_BOUNDS.x * 2;
  mesh.tileHeight = NAV_BOUNDS.z * 2;
  addTile(
    mesh,
    buildTile({
      ...tilePolys,
      ...polysToTileDetailMesh(tilePolys.polys),
      bounds,
      tileX: 0,
      tileY: 0,
      tileLayer: 0,
      cellSize: 0.01,
      cellHeight: 0.01,
      walkableHeight: 2,
      walkableRadius: clearance,
      walkableClimb: 0,
    }),
  );
  return mesh;
}
