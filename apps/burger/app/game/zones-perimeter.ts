import { Container, Graphics } from "pixi.js";
import { TILE_SIZE } from "@harrhy/burger-core";

export type PerimeterState = {
  cells: Set<string>;
  visible: boolean;
  overlay: Graphics;
};

export type Segment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

/**
 * Walks each cell's 4 cardinal neighbors. For each missing neighbor,
 * emits the edge segment between the cell and that neighbor. The result
 * is the perimeter of the cell set (no interior edges).
 *
 * Keys are "x,y" strings of tile-cell centers (TILE_SIZE/2 + n*TILE_SIZE).
 */
export const computePerimeterSegments = (cells: Set<string>): Segment[] => {
  const half = TILE_SIZE / 2;
  const segments: Segment[] = [];
  for (const key of cells) {
    const [xStr, yStr] = key.split(",");
    const x = Number(xStr);
    const y = Number(yStr);
    // North edge (above cell)
    if (!cells.has(`${x},${y - TILE_SIZE}`)) {
      segments.push({ x1: x - half, y1: y - half, x2: x + half, y2: y - half });
    }
    // South edge (below)
    if (!cells.has(`${x},${y + TILE_SIZE}`)) {
      segments.push({ x1: x - half, y1: y + half, x2: x + half, y2: y + half });
    }
    // West edge (left)
    if (!cells.has(`${x - TILE_SIZE},${y}`)) {
      segments.push({ x1: x - half, y1: y - half, x2: x - half, y2: y + half });
    }
    // East edge (right)
    if (!cells.has(`${x + TILE_SIZE},${y}`)) {
      segments.push({ x1: x + half, y1: y - half, x2: x + half, y2: y + half });
    }
  }
  return segments;
};

export const initPerimeter = (parent: Container): PerimeterState => {
  const overlay = new Graphics();
  parent.addChild(overlay);
  overlay.visible = false;
  return { cells: new Set(), visible: false, overlay };
};

export const setPerimeterCells = (
  state: PerimeterState,
  cells: Set<string>,
): void => {
  state.cells = cells;
  if (state.visible) redrawPerimeter(state);
};

export const setPerimeterVisible = (
  state: PerimeterState,
  visible: boolean,
): void => {
  state.visible = visible;
  state.overlay.visible = visible;
  if (visible) redrawPerimeter(state);
};

const redrawPerimeter = (state: PerimeterState): void => {
  const g = state.overlay;
  g.clear();
  const segments = computePerimeterSegments(state.cells);
  if (segments.length === 0) return;
  for (const seg of segments) {
    g.moveTo(seg.x1, seg.y1).lineTo(seg.x2, seg.y2);
  }
  g.stroke({ color: 0xffd966, width: 2, alpha: 0.7 });
};
