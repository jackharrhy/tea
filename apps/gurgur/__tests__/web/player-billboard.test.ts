import { describe, expect, test } from "bun:test";
import {
  playerBillboardAtlasOffset,
  playerBillboardView,
} from "../../web/src/player-billboard";

const views = [
  { viewDirection: { x: 0, y: 0, z: -1 } },
  { viewDirection: { x: 1, y: 0, z: 0 } },
  { viewDirection: { x: 0, y: 0, z: 1 } },
  { viewDirection: { x: -1, y: 0, z: 0 } },
  { viewDirection: { x: 0, y: 1, z: 0 } },
  { viewDirection: { x: 0, y: -1, z: 0 } },
];

describe("player billboard direction", () => {
  test("selects clockwise views around an unrotated player", () => {
    expect(playerBillboardView(0, 0, 0, -4, 0, 0, 0, views)).toBe(0);
    expect(playerBillboardView(0, 4, 0, 0, 0, 0, 0, views)).toBe(1);
    expect(playerBillboardView(0, 0, 0, 4, 0, 0, 0, views)).toBe(2);
    expect(playerBillboardView(0, -4, 0, 0, 0, 0, 0, views)).toBe(3);
  });

  test("measures the view relative to player yaw", () => {
    expect(playerBillboardView(Math.PI / 2, -4, 0, 0, 0, 0, 0, views)).toBe(0);
    expect(playerBillboardView(Math.PI / 2, 0, 0, -4, 0, 0, 0, views)).toBe(1);
  });

  test("selects top and bottom captures from camera elevation", () => {
    expect(playerBillboardView(0, 0, 4, 0, 0, 0, 0, views)).toBe(4);
    expect(playerBillboardView(0, 0, -4, 0, 0, 0, 0, views)).toBe(5);
  });

  test("maps top-origin metadata rows onto Three.js texture offsets", () => {
    const layout = {
      columns: 4,
      rows: 4,
      views: Array.from({ length: 16 }, () => views[0]!),
    };
    expect(playerBillboardAtlasOffset(0, layout)).toEqual({ x: 0, y: 0.75 });
    expect(playerBillboardAtlasOffset(7, layout)).toEqual({ x: 0.75, y: 0.5 });
    expect(playerBillboardAtlasOffset(15, layout)).toEqual({ x: 0.75, y: 0 });
  });
});
